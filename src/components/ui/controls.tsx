"use client";

import { useId, type ReactNode } from "react";
import styles from "./ui.module.css";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  description?: string;
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step, onChange, description, format, disabled }: SliderProps) {
  const id = useId();
  const display = format ? format(value) : String(Math.round(value * 100) / 100);
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={styles.field}>
      <div className={styles.fieldHeader}>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className={styles.fieldValue}>
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={display}
        aria-describedby={description ? `${id}-desc` : undefined}
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {description && (
        <p id={`${id}-desc`} className={styles.fieldHint}>
          {description}
        </p>
      )}
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
}

/** Accessible switch: a button with role="switch" and visible on/off text. */
export function Toggle({ label, checked, onChange, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <span id={`${id}-label`} className={styles.toggleLabel}>
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className={styles.fieldHint}>
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} />
        <span className={styles.switchText}>{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  description?: string;
}

export function Segmented<T extends string>({ label, value, options, onChange, description }: SegmentedProps<T>) {
  const id = useId();
  return (
    <fieldset className={styles.segmentedField}>
      <legend className={styles.toggleLabel}>{label}</legend>
      {description && <p className={styles.fieldHint}>{description}</p>}
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label key={option.value} className={`${styles.segment} ${value === option.value ? styles.segmentActive : ""}`}>
            <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="visually-hidden" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
