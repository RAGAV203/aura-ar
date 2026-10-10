import { AppError, logDiagnostic } from "@/lib/errors/appErrors";
import type { AudioConfig, AudioNoteEvent, AudioTargets, VoiceCommand } from "@/types/instruments";
import { AUDIO_LIMITS, clampAudioTargets, clampNote, clampVoiceCommand, NoteRateLimiter, volumeToGain } from "./audioMath";
import { createSustainedVoice, type SustainedVoice } from "./sustainedVoices";
import { createContinuousLayer, createNoiseBuffer, playNote, type ContinuousLayer } from "./voices";

export type AudioEngineState = "locked" | "running" | "suspended" | "failed";

type StateListener = (state: AudioEngineState) => void;

type AudioContextConstructor = typeof AudioContext;

/**
 * Owns the single AudioContext and the master graph:
 *
 *   layer / notes → bus → master gain → limiter → destination
 *                                            └──→ recording tap (on demand)
 *
 * The context is only created inside an explicit user gesture (activate()).
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private recordTap: MediaStreamAudioDestinationNode | null = null;
  private noise: AudioBuffer | null = null;
  private layer: ContinuousLayer | null = null;
  private config: AudioConfig | null = null;
  private activeNotes = 0;
  private voices = new Map<string, SustainedVoice>();
  private readonly rateLimiter = new NoteRateLimiter();
  private volume = 0.7;
  private muted = false;
  private state: AudioEngineState = "locked";
  private listeners = new Set<StateListener>();

  getState(): AudioEngineState {
    return this.state;
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Must be called from a user gesture handler (tap / click / key press). */
  async activate(): Promise<void> {
    try {
      if (!this.context) {
        const Ctor: AudioContextConstructor | undefined =
          typeof AudioContext !== "undefined" ? AudioContext : (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
        if (!Ctor) throw new AppError("unsupported-browser");
        const context = new Ctor({ latencyHint: "interactive" });
        this.context = context;
        this.noise = createNoiseBuffer(context);
        this.bus = context.createGain();
        this.master = context.createGain();
        this.master.gain.value = 0;
        this.limiter = context.createDynamicsCompressor();
        this.limiter.threshold.value = -12;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.25;
        this.bus.connect(this.master).connect(this.limiter).connect(context.destination);
        context.addEventListener("statechange", () => this.syncState());
        if (this.config) this.buildLayer(this.config);
      }
      await this.context.resume();
      this.applyMasterGain();
      this.syncState();
      if (this.context.state !== "running") throw new AppError("audio-activation-failed");
    } catch (error) {
      logDiagnostic("audio", "activation failed", error);
      this.setState("failed");
      throw error instanceof AppError ? error : new AppError("audio-activation-failed", { cause: error });
    }
  }

  isRunning(): boolean {
    return this.context?.state === "running";
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  /** Swap the instrument voice. Old nodes fade out and are released. */
  setInstrument(config: AudioConfig | null): void {
    this.allVoicesOff();
    this.config = config;
    if (!this.context) return;
    this.layer?.stop(this.context.currentTime);
    this.layer = null;
    if (config) this.buildLayer(config);
  }

  update(targets: AudioTargets): void {
    if (!this.context || !this.layer || this.context.state !== "running") return;
    this.layer.update(clampAudioTargets(targets), this.context.currentTime);
  }

  play(note: AudioNoteEvent): void {
    const context = this.context;
    if (!context || !this.bus || !this.noise || !this.config || context.state !== "running" || this.muted) return;
    if (this.activeNotes >= AUDIO_LIMITS.maxPolyphony) return;
    if (!this.rateLimiter.allow(performance.now())) return;
    this.activeNotes++;
    playNote(context, this.bus, this.config, clampNote(note), this.noise, () => {
      this.activeNotes = Math.max(0, this.activeNotes - 1);
    });
  }

  /** Applies a sustained-voice command (note on / update / off). */
  voice(raw: VoiceCommand): void {
    const command = clampVoiceCommand(raw);
    const context = this.context;
    if (command.type === "all-off") return this.allVoicesOff();
    if (command.type === "off") {
      this.voices.get(command.id)?.release(command.releaseSeconds);
      this.voices.delete(command.id);
      return;
    }
    if (command.type === "update") {
      const voice = this.voices.get(command.id);
      if (!voice) return;
      if (command.midi !== undefined) voice.setPitch(command.midi, (command.glideMs ?? 0) / 1000);
      if (command.expression !== undefined) voice.setExpression(command.expression);
      if (command.pan !== undefined) voice.setPan(command.pan);
      return;
    }
    if (!context || !this.bus || !this.noise || context.state !== "running") return;
    this.voices.get(command.id)?.release();
    // Voice stealing: release the oldest held note when the limit is reached.
    while (this.voices.size >= AUDIO_LIMITS.maxSustainedVoices) {
      const [oldestId, oldest] = [...this.voices.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0] ?? [];
      if (!oldestId || !oldest) break;
      oldest.release(0.05);
      this.voices.delete(oldestId);
    }
    const voice = createSustainedVoice(context, this.bus, this.noise, command.kind, command.midi, command.velocity, command.pan, () => undefined);
    this.voices.set(command.id, voice);
  }

  /** Releases every held note (pause, instrument switch, cut-off). */
  allVoicesOff(): void {
    this.voices.forEach((voice) => voice.release(0.15));
    this.voices.clear();
  }

  /** Immediately silences output without tearing down the graph. */
  async suspend(): Promise<void> {
    this.allVoicesOff();
    if (!this.context || this.context.state !== "running") return;
    this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await this.context.suspend();
    this.syncState();
  }

  async resume(): Promise<void> {
    if (!this.context) return;
    await this.context.resume();
    this.applyMasterGain();
    this.syncState();
  }

  /** Audio stream for video recording; created lazily. */
  getRecordingStream(): MediaStream | null {
    if (!this.context || !this.limiter) return null;
    if (!this.recordTap) {
      this.recordTap = this.context.createMediaStreamDestination();
      this.limiter.connect(this.recordTap);
    }
    return this.recordTap.stream;
  }

  async dispose(): Promise<void> {
    this.allVoicesOff();
    const context = this.context;
    this.layer?.stop(context?.currentTime ?? 0);
    this.layer = null;
    this.context = null;
    this.bus = this.master = this.limiter = null;
    this.recordTap = null;
    if (context) await context.close().catch(() => undefined);
    this.setState("locked");
  }

  private buildLayer(config: AudioConfig): void {
    if (!this.context || !this.bus || !this.noise) return;
    this.layer = createContinuousLayer(this.context, this.bus, config, this.noise);
  }

  private applyMasterGain(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(volumeToGain(this.volume, this.muted), this.context.currentTime, 0.05);
  }

  private syncState(): void {
    // Safari reports "interrupted" (e.g. phone call), which isn't in the TS lib type yet.
    const s = this.context?.state as string | undefined;
    if (s === "running") this.setState("running");
    else if (s === "suspended" || s === "interrupted") this.setState("suspended");
    else if (!this.context) this.setState("locked");
  }

  private setState(state: AudioEngineState): void {
    if (state === this.state) return;
    this.state = state;
    this.listeners.forEach((l) => l(state));
  }
}

let shared: AudioEngine | null = null;

/** App-wide audio engine (one AudioContext for the whole session). */
export function getAudioEngine(): AudioEngine {
  shared ??= new AudioEngine();
  return shared;
}
