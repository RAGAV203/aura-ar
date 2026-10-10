import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, DrumKind, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument } from "./canvasInstrument";
import { haptic } from "./sticks";
import { StrikeDetector } from "./strikes";

type Bol = "Na" | "Tin" | "Te" | "Ge" | "Ka";

interface Drum {
  id: "bayan" | "dayan";
  x: number;
  y: number;
  /** Radius as a fraction of the shorter view side. */
  r: number;
  flash: number;
}

/** Combined strokes: bayan + dayan together make new bols. */
export function combineBols(a: Bol, b: Bol): string | null {
  const pair = new Set([a, b]);
  if (pair.has("Ge") && pair.has("Na")) return "Dha";
  if (pair.has("Ge") && pair.has("Tin")) return "Dhin";
  if (pair.has("Ka") && pair.has("Na")) return "Ta";
  return null;
}

/** Stroke for a hit at a normalised radius (0 centre … 1 rim) on a drum. */
export function strokeAt(drum: "bayan" | "dayan", radius: number, flatHand: boolean): Bol {
  if (drum === "bayan") return flatHand || radius > 0.75 ? "Ka" : "Ge";
  if (radius > 0.8) return "Na";
  if (radius > 0.42) return "Tin";
  return "Te";
}

const BOL_SOUND: Record<Exclude<Bol, "Ge">, DrumKind> = { Na: "tabla-na", Tin: "tabla-tin", Te: "tabla-te", Ka: "tabla-ka" };

/**
 * Tabla — bayan (bass, left) and dayan (treble, right). Where you strike
 * picks the bol: dayan rim = Na, middle = Tin, centre = Te; bayan open = Ge,
 * flat / edge = Ka. Strike both together for Dha or Dhin. Hold after a Ge
 * and push upward to glide the bayan's pitch, like pressing the wrist.
 */
export class TablaInstrument extends CanvasInstrument {
  readonly id = "tabla" as const;
  private drums: Drum[] = [
    { id: "bayan", x: 0.27, y: 0.56, r: 0.25, flash: 0 },
    { id: "dayan", x: 0.76, y: 0.56, r: 0.19, flash: 0 },
  ];
  private readonly strikes = new StrikeDetector(0.7);
  private touches = new Set<string>();
  private lastStroke: { bol: Bol; at: number } | null = null;
  private display: { text: string; at: number; x: number } | null = null;
  private ge: { voiceId: string; pointId: string; startY: number } | null = null;
  private voiceCounter = 0;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  private geometry(drum: Drum) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const side = Math.min(W, H);
    return { cx: drum.x * W, cy: drum.y * H, r: drum.r * side };
  }

  private hitTest(x: number, y: number): { drum: Drum; radius: number } | null {
    const X = x * this.canvas.width;
    const Y = y * this.canvas.height;
    for (const drum of this.drums) {
      const g = this.geometry(drum);
      const radius = Math.hypot(X - g.cx, Y - g.cy) / g.r;
      if (radius <= 1.05) return { drum, radius: Math.min(1, radius) };
    }
    return null;
  }

  private play(drum: Drum, radius: number, velocity: number, flatHand: boolean, pointId: string | null, y: number): void {
    const bol = strokeAt(drum.id, radius, flatHand);
    drum.flash = 1;
    const v = clamp01(velocity) * this.param("volume", 0.9);
    if (bol === "Ge") {
      const voiceId = `ge-${this.voiceCounter++}`;
      if (this.ge) this.voiceOff(this.ge.voiceId, 0.25);
      const baseMidi = 36 + Math.round(this.param("tuning", 1));
      this.voiceOn(voiceId, "bayan", baseMidi, v, 0.3);
      this.ge = pointId ? { voiceId, pointId, startY: y } : null;
    } else {
      this.emit({ kind: BOL_SOUND[bol], degree: 0, velocity: v, pan: drum.x });
    }
    // Two strokes close together on different drums become a combined bol.
    const previous = this.lastStroke;
    const combined = previous && this.time - previous.at < 0.07 ? combineBols(previous.bol, bol) : null;
    this.display = { text: combined ?? bol, at: this.time, x: combined ? 0.5 : drum.x };
    this.lastStroke = { bol, at: this.time };
  }

  protected step(dt: number, input: ControlInput): void {
    const now = new Set<string>();
    for (const point of input.points) {
      if (point.source === "hand" || point.lifted) continue;
      now.add(point.id);
      if (this.touches.has(point.id)) continue;
      const hit = this.hitTest(point.position.x, point.position.y);
      if (hit) {
        this.play(hit.drum, hit.radius, 0.6 + point.amount * 0.35, false, point.id, point.position.y);
        haptic(6);
      }
    }
    this.touches = now;
    for (const strike of this.strikes.update(input.points, this.time, this.param("sensitivity", 1))) {
      const hit = this.hitTest(strike.x, strike.y);
      const hand = input.points.find((p) => p.id === strike.id);
      // A hand that is pinching strikes flat (Ka on the bayan).
      if (hit) this.play(hit.drum, hit.radius, strike.velocity, !!hand?.engaged, strike.id, strike.y);
    }
    for (const event of input.events) {
      if (event.source !== "hand" || event.type === "accent") continue;
      const hit = this.hitTest(event.position.x, event.position.y);
      if (hit) this.play(hit.drum, hit.radius, 0.65, false, null, event.position.y);
    }

    // Bayan pitch glide: keep pressing after a Ge and push upward.
    const ge = this.ge;
    if (ge) {
      const point = input.points.find((p) => p.id === ge.pointId);
      if (point && !point.lifted) {
        const bend = clamp((ge.startY - point.position.y) * 22, 0, 5);
        this.voiceUpdate(ge.voiceId, { midi: 36 + Math.round(this.param("tuning", 1)) + bend, glideMs: 40 });
      } else {
        this.ge = null;
      }
    }
    for (const drum of this.drums) drum.flash *= Math.exp(-6 * dt);
    this.targets = { level: this.param("drone", 0.35) * 0.5, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0.2 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (const drum of this.drums) {
      const g = this.geometry(drum);
      const bayan = drum.id === "bayan";
      // Shell rim.
      const shell = ctx.createRadialGradient(g.cx, g.cy, g.r * 0.9, g.cx, g.cy, g.r * 1.12);
      shell.addColorStop(0, bayan ? "#b8733a" : "#6b3b1c");
      shell.addColorStop(1, bayan ? "#5a3015" : "#2e170a");
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r * 1.12, 0, Math.PI * 2);
      ctx.fill();
      // Braces (straps) around the rim.
      ctx.strokeStyle = "rgba(240, 225, 200, 0.35)";
      ctx.lineWidth = 1.5 * dpr;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(g.cx + Math.cos(a) * g.r * 1.0, g.cy + Math.sin(a) * g.r * 1.0);
        ctx.lineTo(g.cx + Math.cos(a) * g.r * 1.12, g.cy + Math.sin(a) * g.r * 1.12);
        ctx.stroke();
      }
      // Goat-skin head with kinar ring.
      const head = ctx.createRadialGradient(g.cx - g.r * 0.3, g.cy - g.r * 0.3, g.r * 0.1, g.cx, g.cy, g.r);
      head.addColorStop(0, `hsl(38, 45%, ${80 + drum.flash * 12}%)`);
      head.addColorStop(1, `hsl(34, 40%, ${62 + drum.flash * 12}%)`);
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(120, 80, 40, 0.55)";
      ctx.lineWidth = g.r * 0.08;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      // Syahi: centred on the dayan, offset on the bayan.
      const sx = bayan ? g.cx + g.r * 0.18 : g.cx;
      const sy = bayan ? g.cy - g.r * 0.12 : g.cy;
      const syahi = ctx.createRadialGradient(sx - g.r * 0.08, sy - g.r * 0.08, 0, sx, sy, g.r * (bayan ? 0.36 : 0.42));
      syahi.addColorStop(0, "#3a3a44");
      syahi.addColorStop(1, "#0b0b10");
      ctx.fillStyle = syahi;
      ctx.beginPath();
      ctx.arc(sx, sy, g.r * (bayan ? 0.36 : 0.42), 0, Math.PI * 2);
      ctx.fill();
      if (drum.flash > 0.05) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(255, 210, 150, ${drum.flash * 0.7})`;
        ctx.lineWidth = 4 * dpr;
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r * (1 + (1 - drum.flash) * 0.3), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
      // Zone hints.
      ctx.fillStyle = "rgba(40, 25, 10, 0.55)";
      ctx.font = `600 ${clamp(g.r * 0.12, 9 * dpr, 13 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (bayan) {
        ctx.fillText("Ge", g.cx - g.r * 0.35, g.cy + g.r * 0.35);
        ctx.fillText("Ka (edge)", g.cx, g.cy + g.r * 0.82);
      } else {
        ctx.fillText("Na (rim)", g.cx, g.cy + g.r * 0.85);
        ctx.fillText("Tin", g.cx, g.cy + g.r * 0.6);
        ctx.fillStyle = "rgba(230, 230, 240, 0.6)";
        ctx.fillText("Te", g.cx, g.cy);
      }
    }

    // The bol you just played.
    const display = this.display;
    if (display && this.time - display.at < 0.9) {
      const age = this.time - display.at;
      ctx.globalAlpha = 1 - age / 0.9;
      ctx.fillStyle = "#fff4e0";
      ctx.font = `700 ${clamp(W * 0.08, 26 * dpr, 52 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(display.text, display.x * W, H * 0.22 - age * 20 * dpr);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
