import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, DrumKind, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument } from "./canvasInstrument";
import { drawStick, haptic, StickRig, strikeVelocity, sweptHit, type Stick } from "./sticks";

type PieceType = "drum" | "cymbal" | "kick";

interface Piece {
  id: string;
  label: string;
  type: PieceType;
  /** Centre and radii in kit units (0..1 of the kit width). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Shell depth for drums, in kit units. */
  shell: number;
  /** Lane in the groove strip. */
  lane: number;
  hue: number;
  flash: number;
  wobble: number;
}

interface Ring {
  piece: Piece;
  born: number;
  velocity: number;
}

const HISTORY_S = 4;

/** Back-to-front draw order; hit testing walks it in reverse (front pieces win). */
const LAYOUT: Array<Omit<Piece, "flash" | "wobble">> = [
  { id: "crash", label: "Crash", type: "cymbal", cx: 0.2, cy: 0.12, rx: 0.19, ry: 0.05, shell: 0, lane: 0, hue: 45 },
  { id: "ride", label: "Ride", type: "cymbal", cx: 0.84, cy: 0.2, rx: 0.2, ry: 0.055, shell: 0, lane: 1, hue: 38 },
  { id: "kick", label: "Kick", type: "kick", cx: 0.52, cy: 0.66, rx: 0.2, ry: 0.2, shell: 0, lane: 8, hue: 330 },
  { id: "tom1", label: "Tom 1", type: "drum", cx: 0.4, cy: 0.3, rx: 0.095, ry: 0.04, shell: 0.075, lane: 4, hue: 285 },
  { id: "tom2", label: "Tom 2", type: "drum", cx: 0.62, cy: 0.3, rx: 0.1, ry: 0.042, shell: 0.08, lane: 5, hue: 265 },
  { id: "hihat", label: "Hi-hat", type: "cymbal", cx: 0.11, cy: 0.42, rx: 0.12, ry: 0.034, shell: 0, lane: 2, hue: 55 },
  { id: "snare", label: "Snare", type: "drum", cx: 0.3, cy: 0.55, rx: 0.14, ry: 0.058, shell: 0.065, lane: 7, hue: 200 },
  { id: "floor", label: "Floor tom", type: "drum", cx: 0.8, cy: 0.56, rx: 0.14, ry: 0.06, shell: 0.17, lane: 6, hue: 245 },
];

/**
 * Drum Kit — a realistic kit seen from the throne, played with two simulated
 * drumsticks (one per hand). A hit lands where the stick tip passes through a
 * drum head moving downward; the stick rebounds like real sticking. Cymbal
 * edges and bows sound different, the snare has rimshots, and the hi-hat
 * opens when struck near its edge. Touch taps hit exactly where you tap.
 */
export class DrumKitInstrument extends CanvasInstrument {
  readonly id = "drum-kit" as const;
  private pieces: Piece[] = LAYOUT.map((p) => ({ ...p, flash: 0, wobble: 0 }));
  private readonly rig = new StickRig({ length: 0.2, swing: 0.34 });
  private touchPiece = new Map<string, string | null>();
  private history: Array<{ lane: number; at: number; velocity: number; hue: number }> = [];
  private rings: Ring[] = [];
  private kit = { x: 0, y: 0, w: 1 };
  /** Resolved display font for the kick-drum logo (CSS variables don't work in canvas fonts). */
  private readonly logoFont: string;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-serif").trim();
    this.logoFont = family || "Georgia, serif";
  }

  protected override onReset(): void {
    this.history = [];
    this.rings = [];
  }

  protected override onResize(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.rig.setAspect(W / Math.max(1, H));
    // The kit fills the width on phones; on wide screens it is limited by the height available
    // above the dock (the kick's bottom edge sits 0.86 kit-widths below the kit's top).
    const top = H * 0.17;
    const w = Math.min(W * 0.98, (H * 0.87 - top) / 0.88) * this.param("size", 1);
    this.kit = { x: (W - w) / 2, y: top, w };
  }

  /** Piece geometry in device pixels. */
  private px(piece: Piece) {
    const { x, y, w } = this.kit;
    return { cx: x + piece.cx * w, cy: y + piece.cy * w, rx: piece.rx * w, ry: piece.ry * w, shell: piece.shell * w };
  }

  /** Front-most piece under a normalised point, with where on it (0 centre … 1 edge). */
  private pieceAt(nx: number, ny: number): { piece: Piece; radius: number } | null {
    const X = nx * this.canvas.width;
    const Y = ny * this.canvas.height;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i]!;
      const g = this.px(piece);
      // Heads are thin ellipses in perspective; give them generous vertical reach.
      const reach = piece.type === "cymbal" ? 2.6 : piece.type === "kick" ? 1 : 1.9;
      const dx = (X - g.cx) / g.rx;
      const dy = (Y - g.cy) / (g.ry * reach);
      const r = Math.hypot(dx, dy);
      if (r <= 1) return { piece, radius: r };
    }
    return null;
  }

  private sound(piece: Piece, radius: number): { kind: DrumKind; degree: number; boost: number } {
    switch (piece.id) {
      case "crash":
        return { kind: "crash", degree: 0, boost: 1 };
      case "ride":
        return radius < 0.25 ? { kind: "ride", degree: 1, boost: 1.1 } : { kind: "ride", degree: 0, boost: 1 };
      case "hihat":
        return radius > 0.62 ? { kind: "hat-open", degree: 0, boost: 1 } : { kind: "hat", degree: 0, boost: 1 };
      case "snare":
        return { kind: "snare", degree: radius > 0.85 ? 1 : 0, boost: radius > 0.85 ? 1.2 : 1 };
      case "tom1":
        return { kind: "tom", degree: 0, boost: 1 };
      case "tom2":
        return { kind: "tom", degree: 1, boost: 1 };
      case "floor":
        return { kind: "tom", degree: 2, boost: 1 };
      default:
        return { kind: "kick", degree: 0, boost: 1 };
    }
  }

  private hit(piece: Piece, radius: number, velocity: number, stick: Stick | null): void {
    const { kind, degree, boost } = this.sound(piece, radius);
    const v = clamp01(velocity * boost) * this.param("volume", 0.85);
    this.emit({ kind, degree, velocity: v, pan: clamp01((this.px(piece).cx - this.kit.x) / this.kit.w) });
    piece.flash = 1;
    if (piece.type === "cymbal") piece.wobble = Math.min(1, piece.wobble + 0.6 + v * 0.4);
    this.rings.push({ piece, born: this.time, velocity: v });
    if (this.rings.length > 24) this.rings.shift();
    this.history.push({ lane: piece.lane, at: this.time, velocity: v, hue: piece.hue });
    if (stick) this.rig.rebound(stick, v);
  }

  protected step(dt: number, input: ControlInput): void {
    const sticks = this.rig.update(input.points, dt);

    // Touch: the stick tip is the finger; hit on press and when sliding onto another piece.
    const seen = new Set<string>();
    for (const point of input.points) {
      if (point.source === "hand" || point.lifted) continue;
      seen.add(point.id);
      const found = this.pieceAt(point.position.x, point.position.y);
      const previous = this.touchPiece.get(point.id);
      if (found && (previous === undefined || previous !== found.piece.id)) {
        const stick = sticks.find((s) => s.source !== "hand" && Math.abs(s.tipX - point.position.x) < 1e-3) ?? null;
        this.hit(found.piece, found.radius, 0.6 + point.amount * 0.4, stick);
        haptic();
      }
      this.touchPiece.set(point.id, found?.piece.id ?? null);
    }
    for (const id of this.touchPiece.keys()) if (!seen.has(id)) this.touchPiece.delete(id);

    // Hands: the swept stick tip must enter a piece moving downward.
    const minSpeed = 0.55 * this.param("sensitivity", 1);
    for (const stick of sticks) {
      if (!stick.active || stick.source !== "hand" || stick.sinceHit < 0.06) continue;
      let struck: { piece: Piece; radius: number } | null = null;
      const inside = (x: number, y: number) => {
        const found = this.pieceAt(x, y);
        if (found) struck = found;
        return !!found;
      };
      if (sweptHit(stick, inside, minSpeed) && struck) {
        const { piece, radius } = struck as { piece: Piece; radius: number };
        this.hit(piece, radius, strikeVelocity(stick), stick);
      }
    }

    for (const event of input.events) {
      if (event.type === "accent") {
        const kick = this.pieces.find((p) => p.id === "kick");
        const crash = this.pieces.find((p) => p.id === "crash");
        if (kick) this.hit(kick, 0.5, 0.95, null);
        if (crash) this.hit(crash, 0.8, 0.9, null);
      } else if (event.source === "hand") {
        const found = this.pieceAt(event.position.x, event.position.y);
        if (found) this.hit(found.piece, found.radius, 0.7, null);
      }
    }

    for (const piece of this.pieces) {
      piece.flash *= Math.exp(-7 * dt);
      piece.wobble *= Math.exp(-2.2 * dt);
    }
    this.history = this.history.filter((h) => this.time - h.at < HISTORY_S);
    const recent = this.history.filter((h) => this.time - h.at < 1).length;
    this.targets = { level: 0.04, brightness: 0.3, pitch: 0, pan: 0.5, texture: clamp01(recent / 12) * 0.2 };
  }

  /* ---------- Drawing ---------- */

  private drawStand(ctx: CanvasRenderingContext2D, x: number, top: number, floor: number, dpr: number): void {
    ctx.strokeStyle = "rgba(200, 205, 225, 0.55)";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, floor);
    ctx.moveTo(x, floor - 4 * dpr);
    ctx.lineTo(x - 26 * dpr, floor + 10 * dpr);
    ctx.moveTo(x, floor - 4 * dpr);
    ctx.lineTo(x + 26 * dpr, floor + 10 * dpr);
    ctx.stroke();
  }

  private drawCymbal(ctx: CanvasRenderingContext2D, piece: Piece, dpr: number): void {
    const g = this.px(piece);
    const tilt = Math.sin(this.time * 26 + piece.lane) * piece.wobble * 0.18;
    const ry = g.ry * (1 + Math.sin(this.time * 22 + piece.lane) * piece.wobble * 0.6);
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(tilt);
    const bronze = ctx.createRadialGradient(-g.rx * 0.2, -ry * 0.4, g.rx * 0.05, 0, 0, g.rx);
    bronze.addColorStop(0, `hsla(${piece.hue}, 85%, ${78 + piece.flash * 15}%, 0.96)`);
    bronze.addColorStop(0.55, `hsla(${piece.hue - 6}, 70%, ${52 + piece.flash * 20}%, 0.94)`);
    bronze.addColorStop(1, `hsla(${piece.hue - 12}, 65%, ${30 + piece.flash * 20}%, 0.92)`);
    ctx.fillStyle = bronze;
    ctx.beginPath();
    ctx.ellipse(0, 0, g.rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Lathe grooves.
    ctx.strokeStyle = "rgba(60, 35, 5, 0.18)";
    ctx.lineWidth = 1 * dpr;
    for (let k = 1; k <= 6; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, (g.rx * k) / 7, (ry * k) / 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Bell and highlight.
    ctx.fillStyle = `hsla(${piece.hue}, 90%, ${82 + piece.flash * 10}%, 0.95)`;
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.1, g.rx * 0.16, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 250, 230, 0.55)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.ellipse(0, 0, g.rx * 0.82, ry * 0.82, 0, Math.PI * 1.1, Math.PI * 1.45);
    ctx.stroke();
    ctx.restore();
    if (piece.id === "hihat") {
      // Bottom plate peeking out underneath.
      ctx.fillStyle = `hsla(${piece.hue - 10}, 60%, 38%, 0.9)`;
      ctx.beginPath();
      ctx.ellipse(g.cx, g.cy + 6 * dpr, g.rx * 0.98, g.ry * 0.9, 0, 0, Math.PI);
      ctx.fill();
    }
  }

  private drawDrum(ctx: CanvasRenderingContext2D, piece: Piece, dpr: number): void {
    const g = this.px(piece);
    const wrap = this.param("finish", 0) >= 0.5 ? 210 : 278; // sparkle purple or ocean blue
    // Shell: shaded cylinder.
    const shell = ctx.createLinearGradient(g.cx - g.rx, 0, g.cx + g.rx, 0);
    shell.addColorStop(0, `hsl(${wrap}, 45%, 12%)`);
    shell.addColorStop(0.35, `hsl(${wrap}, 55%, 34%)`);
    shell.addColorStop(0.5, `hsl(${wrap}, 60%, 46%)`);
    shell.addColorStop(0.7, `hsl(${wrap}, 55%, 28%)`);
    shell.addColorStop(1, `hsl(${wrap}, 45%, 10%)`);
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.moveTo(g.cx - g.rx, g.cy);
    ctx.lineTo(g.cx - g.rx, g.cy + g.shell);
    ctx.ellipse(g.cx, g.cy + g.shell, g.rx, g.ry, 0, Math.PI, 0, true);
    ctx.lineTo(g.cx + g.rx, g.cy);
    ctx.closePath();
    ctx.fill();
    // Lugs.
    ctx.fillStyle = "rgba(225, 230, 245, 0.85)";
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * (0.12 + (k / 4) * 0.76);
      const lx = g.cx - Math.cos(a) * g.rx * 0.96;
      ctx.fillRect(lx - 2.5 * dpr, g.cy + g.shell * 0.25, 5 * dpr, Math.max(6 * dpr, g.shell * 0.5));
    }
    // Bottom hoop.
    ctx.strokeStyle = "rgba(210, 215, 235, 0.75)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy + g.shell, g.rx, g.ry, 0, 0, Math.PI);
    ctx.stroke();
    // Head: coated white, lights up on hit.
    const head = ctx.createRadialGradient(g.cx - g.rx * 0.25, g.cy - g.ry * 0.3, g.rx * 0.05, g.cx, g.cy, g.rx);
    head.addColorStop(0, `rgba(250, 248, 240, ${0.92})`);
    head.addColorStop(1, `rgba(205, 200, 190, ${0.9})`);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (piece.flash > 0.02) {
      ctx.fillStyle = `hsla(${piece.hue}, 95%, 65%, ${piece.flash * 0.55})`;
      ctx.fill();
    }
    // Top hoop (chrome).
    ctx.strokeStyle = "rgba(235, 238, 250, 0.95)";
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();
    if (piece.id === "snare") {
      // Snare throw-off and wires hint.
      ctx.fillStyle = "rgba(235, 238, 250, 0.9)";
      ctx.fillRect(g.cx + g.rx * 0.98 - 3 * dpr, g.cy + g.shell * 0.2, 6 * dpr, g.shell * 0.5);
    }
  }

  private drawKick(ctx: CanvasRenderingContext2D, piece: Piece, dpr: number): void {
    const g = this.px(piece);
    const r = g.rx;
    // Spurs.
    ctx.strokeStyle = "rgba(210, 215, 235, 0.6)";
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(g.cx - r * 0.8, g.cy + r * 0.5);
    ctx.lineTo(g.cx - r * 1.05, g.cy + r * 1.05);
    ctx.moveTo(g.cx + r * 0.8, g.cy + r * 0.5);
    ctx.lineTo(g.cx + r * 1.05, g.cy + r * 1.05);
    ctx.stroke();
    // Resonant head.
    const face = ctx.createRadialGradient(g.cx - r * 0.3, g.cy - r * 0.3, r * 0.1, g.cx, g.cy, r);
    face.addColorStop(0, `hsl(${piece.hue}, 35%, ${22 + piece.flash * 25}%)`);
    face.addColorStop(1, `hsl(${piece.hue}, 40%, ${8 + piece.flash * 12}%)`);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Hoop with claws.
    ctx.strokeStyle = "rgba(235, 238, 250, 0.9)";
    ctx.lineWidth = 6 * dpr;
    ctx.stroke();
    ctx.fillStyle = "rgba(225, 230, 245, 0.85)";
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Logo + port.
    ctx.fillStyle = `rgba(246, 244, 255, ${0.75 + piece.flash * 0.25})`;
    ctx.font = `400 ${r * 0.34}px ${this.logoFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Aura", g.cx, g.cy - r * 0.1);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(g.cx + r * 0.42, g.cy + r * 0.45, r * 0.13, 0, Math.PI * 2);
    ctx.stroke();
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Stands first, then pieces back to front.
    const floor = Math.min(H * 0.98, this.kit.y + this.kit.w * 0.95);
    for (const piece of this.pieces) {
      if (piece.type === "cymbal") this.drawStand(ctx, this.px(piece).cx, this.px(piece).cy, floor, dpr);
    }
    for (const piece of this.pieces) {
      if (piece.type === "cymbal") this.drawCymbal(ctx, piece, dpr);
      else if (piece.type === "kick") this.drawKick(ctx, piece, dpr);
      else this.drawDrum(ctx, piece, dpr);
    }

    // Impact ripples.
    ctx.globalCompositeOperation = "lighter";
    this.rings = this.rings.filter((ring) => this.time - ring.born < 0.5);
    for (const ring of this.rings) {
      const g = this.px(ring.piece);
      const age = this.time - ring.born;
      const scale = 0.3 + age * 2.2;
      ctx.globalAlpha = (1 - age / 0.5) * (0.35 + ring.velocity * 0.6);
      ctx.strokeStyle = `hsla(${ring.piece.hue}, 95%, 72%, 1)`;
      ctx.lineWidth = (1.5 + ring.velocity * 3) * dpr;
      ctx.beginPath();
      if (ring.piece.type === "kick") ctx.arc(g.cx, g.cy, g.rx * Math.min(1, scale), 0, Math.PI * 2);
      else ctx.ellipse(g.cx, g.cy, g.rx * Math.min(1.25, scale), g.ry * Math.min(1.25, scale), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Labels, small and quiet.
    ctx.font = `600 ${clamp(this.kit.w * 0.028, 9 * dpr, 13 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const piece of this.pieces) {
      if (piece.type === "kick") continue;
      const g = this.px(piece);
      ctx.fillStyle = piece.type === "cymbal" ? "rgba(40, 25, 5, 0.75)" : "rgba(40, 40, 60, 0.7)";
      ctx.fillText(piece.label, g.cx, g.cy + (piece.type === "cymbal" ? g.ry * 0.55 : 0));
    }

    // Sticks on top of everything.
    drawStick(ctx, this.rig.sticks.left, W, H, dpr);
    drawStick(ctx, this.rig.sticks.right, W, H, dpr);

    // Groove strip.
    const top = H * 0.12;
    const height = H * 0.05;
    for (const h of this.history) {
      const age = this.time - h.at;
      ctx.globalAlpha = (1 - age / HISTORY_S) * (0.4 + h.velocity * 0.6);
      ctx.fillStyle = `hsla(${h.hue}, 90%, 65%, 1)`;
      ctx.beginPath();
      ctx.arc(W * (0.95 - (age / HISTORY_S) * 0.9), top + (h.lane / 8) * height, (2 + h.velocity * 3) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
