"use client";

import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { clamp } from "@/lib/math";
import styles from "./performanceControls.module.css";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Keyboard step handling shared by the controls: arrows, Page Up/Down, Home/End. */
function stepFromKey(event: KeyboardEvent, value: number, axis: "x" | "y" = "y"): number | null {
  const fine = 0.02;
  const coarse = 0.1;
  switch (event.key) {
    case "ArrowUp":
      return axis === "y" ? value + fine : null;
    case "ArrowDown":
      return axis === "y" ? value - fine : null;
    case "ArrowRight":
      return axis === "x" ? value + fine : axis === "y" ? value + fine : null;
    case "ArrowLeft":
      return axis === "x" ? value - fine : axis === "y" ? value - fine : null;
    case "PageUp":
      return value + coarse;
    case "PageDown":
      return value - coarse;
    case "Home":
      return 0;
    case "End":
      return 1;
    default:
      return null;
  }
}

interface VerticalSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Springs back to 0 on release (like a whammy bar). */
  springBack?: boolean;
}

/** Tall fader with the label written along it, as on hardware controllers. */
export function VerticalSlider({ label, value, onChange, springBack }: VerticalSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const setFromPointer = (event: PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1));
  };
  return (
    <div className={styles.vslider}>
      <div
        ref={track}
        className={styles.vtrack}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={pct(value)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromPointer(e);
        }}
        onPointerUp={() => springBack && onChange(0)}
        onKeyDown={(e) => {
          const next = stepFromKey(e, value);
          if (next === null) return;
          e.preventDefault();
          onChange(clamp(next, 0, 1));
        }}
      >
        <span className={styles.vfill} style={{ height: pct(value) }} />
        <span className={styles.vlabel}>{label}</span>
      </div>
    </div>
  );
}

interface KnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/** Rotary knob: drag up/down or use the arrow keys. */
export function Knob({ label, value, onChange }: KnobProps) {
  const start = useRef<{ y: number; value: number } | null>(null);
  const angle = -135 + value * 270;
  return (
    <div className={styles.knobWrap}>
      <div
        className={styles.knob}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={pct(value)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, value };
        }}
        onPointerMove={(e) => {
          if (!start.current || !e.buttons) return;
          onChange(clamp(start.current.value + (start.current.y - e.clientY) / 150, 0, 1));
        }}
        onPointerUp={() => (start.current = null)}
        onKeyDown={(e) => {
          const next = stepFromKey(e, value);
          if (next === null) return;
          e.preventDefault();
          onChange(clamp(next, 0, 1));
        }}
      >
        <span className={styles.knobPointer} style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className={styles.knobLabel}>{label}</span>
    </div>
  );
}

interface XYPadProps {
  label: string;
  xLabel: string;
  yLabel: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}

/** Two-dimensional expression pad. Arrow keys move the target; values are announced. */
export function XYPad({ label, xLabel, yLabel, x, y, onChange }: XYPadProps) {
  const pad = useRef<HTMLDivElement>(null);
  const setFromPointer = (event: PointerEvent) => {
    const rect = pad.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1));
  };
  return (
    <div className={styles.xyWrap}>
      <span className={styles.xyTitle}>{label}</span>
      <div className={styles.xyBody}>
        <span className={styles.xyAxisY}>{yLabel}</span>
        <div
          ref={pad}
          className={styles.xy}
          role="group"
          tabIndex={0}
          aria-label={`${label}: ${xLabel} ${pct(x)}, ${yLabel} ${pct(y)}. Use arrow keys to adjust.`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) setFromPointer(e);
          }}
          onKeyDown={(e) => {
            const dx = e.key === "ArrowRight" ? 0.05 : e.key === "ArrowLeft" ? -0.05 : 0;
            const dy = e.key === "ArrowUp" ? 0.05 : e.key === "ArrowDown" ? -0.05 : 0;
            if (!dx && !dy) return;
            e.preventDefault();
            onChange(clamp(x + dx, 0, 1), clamp(y + dy, 0, 1));
          }}
        >
          <span className={styles.xyTarget} style={{ left: pct(x), top: pct(1 - y) }} />
        </div>
      </div>
      <span className={styles.xyAxisX}>{xLabel}</span>
    </div>
  );
}

interface ToggleButtonProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/** Hardware-style latching button. */
export function ToggleButton({ pressed, onClick, children, className }: ToggleButtonProps) {
  return (
    <button type="button" aria-pressed={pressed} className={`${styles.toggle} ${pressed ? styles.toggleOn : ""} ${className ?? ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
