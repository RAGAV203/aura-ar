"use client";

import { useEffect, useRef } from "react";
import { applyTransform, type ViewTransform } from "@/lib/browser/viewTransform";
import type { TrackingFrame } from "@/types/gestures";
import styles from "../studio.module.css";

/** MediaPipe hand topology. */
const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const STALE_MS = 400;

interface HandOverlayProps {
  getFrame: () => { frame: TrackingFrame; receivedAt: number } | null;
  getView: () => ViewTransform;
  /** Accent colour of the current instrument. */
  color: string;
}

/**
 * Draws a luminous skeleton over each tracked hand, aligned with the camera
 * backdrop. Purely visual: it reads the latest frame each animation frame and
 * keeps nothing.
 */
export function HandOverlay({ getFrame, getView, color }: HandOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ getFrame, getView, color });
  useEffect(() => {
    live.current = { getFrame, getView, color };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let handle = 0;
    const draw = () => {
      handle = requestAnimationFrame(draw);
      const { getFrame: frameOf, getView: viewOf, color: accent } = live.current;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const latest = frameOf();
      if (!latest) return;
      const age = performance.now() - latest.receivedAt;
      if (age > STALE_MS) return;
      const fade = 1 - age / STALE_MS;
      const view = viewOf();
      const dpr = W / Math.max(1, canvas.clientWidth);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const hand of latest.frame.hands) {
        const pts = hand.landmarks.map((l) => {
          const p = applyTransform(l, view);
          return [p.x * W, p.y * H] as const;
        });
        ctx.beginPath();
        for (const [a, b] of BONES) {
          const pa = pts[a];
          const pb = pts[b];
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
        ctx.globalAlpha = 0.28 * fade;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 7 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
        ctx.fillStyle = accent;
        pts.forEach(([x, y], i) => {
          const tip = TIPS.includes(i);
          ctx.globalAlpha = (tip ? 0.95 : 0.6) * fade;
          ctx.beginPath();
          ctx.arc(x, y, (tip ? 4.5 : 2.5) * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.restore();
    };
    handle = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(handle);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.handOverlay} aria-hidden="true" />;
}
