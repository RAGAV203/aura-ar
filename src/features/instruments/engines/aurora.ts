import { clamp01, createNoise1D, damp, mapRange } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument } from "./canvasInstrument";

const PITCH_STEPS = [-5, -3, 0, 2, 4, 7];

/**
 * Aurora — layered luminous curtains. Hand x steers the drift, hand height
 * sets brightness, two-hand separation widens the curtain.
 */
export class AuroraInstrument extends CanvasInstrument {
  readonly id = "aurora" as const;
  private steerX = 0.5;
  private brightness = 0.55;
  private spread = 0.45;
  private hueShift = 0;
  private hueShiftTarget = 0;
  private phase = 0;
  private stars: Float32Array;
  private readonly noise: (x: number) => number;
  private ys: Float32Array = new Float32Array(0);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.noise = createNoise1D(seed);
    this.stars = new Float32Array(0);
    this.onReset();
  }

  protected override onReset(): void {
    const count = 90;
    this.stars = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.stars[i * 3] = this.random();
      this.stars[i * 3 + 1] = this.random() * 0.7;
      this.stars[i * 3 + 2] = this.random();
    }
    this.hueShift = this.hueShiftTarget = 0;
    this.phase = 0;
  }

  private get ribbonCount(): number {
    return this.quality === "high" ? 6 : this.quality === "balanced" ? 5 : 3;
  }

  private get segments(): number {
    return this.quality === "battery" ? 28 : 56;
  }

  protected step(dt: number, input: ControlInput): void {
    const primary = input.points[0];
    let interacting = false;
    if (primary && !primary.lifted) {
      interacting = true;
      this.steerX = damp(this.steerX, primary.position.x, 4, dt);
      this.brightness = damp(this.brightness, mapRange(primary.position.y, 0.9, 0.1, 0.2, 1), 3, dt);
    } else {
      this.steerX = damp(this.steerX, 0.5 + 0.18 * Math.sin(this.time * 0.11), 0.6, dt);
      this.brightness = damp(this.brightness, 0.55, 0.8, dt);
    }

    let spreadTarget = this.param("spread", 0.45);
    if (input.spread !== null) spreadTarget = mapRange(input.spread, 0.08, 0.8, 0.15, 1);
    if (input.bodySpread !== null) spreadTarget = Math.max(spreadTarget, input.bodySpread);
    this.spread = damp(this.spread, spreadTarget, 3, dt);

    for (const event of input.events) {
      if (event.type === "accent") {
        this.hueShiftTarget += 55;
        this.emit({ kind: "swell", degree: 4, velocity: 0.7, pan: event.position.x });
      } else {
        this.emit({ kind: "swell", degree: Math.floor(event.position.x * 5), velocity: 0.5, pan: event.position.x });
      }
    }
    this.hueShift = damp(this.hueShift, this.hueShiftTarget, 1.5, dt);

    const flow = this.param("flow", 0.7);
    this.phase += dt * flow * (0.4 + (this.steerX - 0.5) * 2.6);

    const stepIndex = Math.min(PITCH_STEPS.length - 1, Math.floor(this.steerX * PITCH_STEPS.length));
    this.targets = {
      level: interacting ? 0.4 + this.brightness * 0.5 : 0.35,
      brightness: this.brightness,
      pitch: PITCH_STEPS[stepIndex] ?? 0,
      pan: this.steerX,
      texture: this.spread * 0.35,
    };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    this.fade(this.reducedMotion ? 0.35 : 0.2);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Distant stars twinkle slowly behind the curtains.
    ctx.fillStyle = "#cfd6ff";
    const stars = this.stars;
    for (let i = 0; i < stars.length; i += 3) {
      const twinkle = 0.25 + 0.25 * Math.sin(this.time * 0.8 + (stars[i + 2] ?? 0) * 40);
      ctx.globalAlpha = twinkle * 0.5;
      ctx.fillRect((stars[i] ?? 0) * W, (stars[i + 1] ?? 0) * H, dpr, dpr);
    }

    const count = this.ribbonCount;
    const segments = this.segments;
    if (this.ys.length !== segments + 1) this.ys = new Float32Array(segments + 1);
    const baseHue = this.param("hue", 165) + this.hueShift;
    const glow = this.param("glow", 0.7) * (0.35 + this.brightness * 0.75);

    for (let r = 0; r < count; r++) {
      const t = count === 1 ? 0.5 : r / (count - 1);
      const baseY = H * (0.45 + (t - 0.5) * this.spread * 0.75);
      const amp = H * (0.06 + 0.03 * Math.sin(this.time * 0.27 + r * 1.3));
      const curtain = H * (0.18 + 0.12 * this.brightness) * (0.7 + 0.3 * Math.sin(r * 2.1));
      const hue = baseHue + r * 16;

      for (let j = 0; j <= segments; j++) {
        const u = j / segments;
        this.ys[j] =
          baseY +
          amp * Math.sin(u * 4.4 + this.phase * 1.4 + r * 1.7 + (u - this.steerX) * 2.2) +
          amp * 0.7 * this.noise(u * 3.1 + this.phase * 0.6 + r * 17);
      }

      const gradient = ctx.createLinearGradient(0, baseY + amp, 0, baseY - curtain - amp);
      gradient.addColorStop(0, `hsla(${hue}, 95%, 62%, ${0.32 * glow})`);
      gradient.addColorStop(0.35, `hsla(${hue + 25}, 90%, 55%, ${0.14 * glow})`);
      gradient.addColorStop(1, `hsla(${hue + 50}, 90%, 50%, 0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      for (let j = 0; j <= segments; j++) {
        const x = (j / segments) * W;
        if (j === 0) ctx.moveTo(x, this.ys[j] ?? baseY);
        else ctx.lineTo(x, this.ys[j] ?? baseY);
      }
      for (let j = segments; j >= 0; j--) {
        const u = j / segments;
        const lift = curtain * (0.75 + 0.25 * Math.sin(u * 9 + this.time * 0.5 + r));
        ctx.lineTo(u * W, (this.ys[j] ?? baseY) - lift);
      }
      ctx.closePath();
      ctx.fill();

      // Bright lower edge.
      ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${clamp01(0.35 * glow)})`;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let j = 0; j <= segments; j++) {
        const x = (j / segments) * W;
        if (j === 0) ctx.moveTo(x, this.ys[j] ?? baseY);
        else ctx.lineTo(x, this.ys[j] ?? baseY);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
