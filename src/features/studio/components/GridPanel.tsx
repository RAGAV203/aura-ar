"use client";

import type { Ref } from "react";
import { Icon } from "@/components/ui/Icon";
import { Knob, ToggleButton, VerticalSlider, XYPad } from "@/components/ui/performanceControls";
import { GRID_SOUNDS } from "@/features/instruments/engines/pitchGrid";
import type { InstrumentDefinition, InstrumentParameters } from "@/types/instruments";
import styles from "./GridPanel.module.css";

interface GridPanelProps {
  definition: InstrumentDefinition;
  parameters: InstrumentParameters;
  presetId: string | null;
  onParameterChange: (key: string, value: number) => void;
  onPreset: (presetId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  ref?: Ref<HTMLDivElement>;
}

const TRANSITIONS = ["Piano", "Guitar", "Slide"] as const;

/**
 * Control panel for the Pitch Grid: octave, expression pad, whammy / vibrato
 * / filter faders, harmonic and transition switches, backing track, knobs and
 * the preset browser. Every control is a real, keyboard-accessible element
 * bound to the instrument's (saved) parameters.
 */
export function GridPanel({ definition, parameters, presetId, onParameterChange, onPreset, collapsed, onToggleCollapsed, ref }: GridPanelProps) {
  const p = (key: string) => parameters[key] ?? definition.parameters.find((s) => s.key === key)?.defaultValue ?? 0;
  const on = (key: string) => p(key) >= 0.5;
  const toggle = (key: string) => onParameterChange(key, on(key) ? 0 : 1);
  const presets = definition.presets;
  const presetIndex = Math.max(0, presets.findIndex((preset) => preset.id === presetId));
  const preset = presets.find((x) => x.id === presetId);
  const stepPreset = (delta: number) => {
    const next = presets[(presetIndex + delta + presets.length) % presets.length];
    if (next) onPreset(next.id);
  };
  const sound = GRID_SOUNDS[Math.round(p("sound"))] ?? GRID_SOUNDS[0]!;

  if (collapsed) {
    return (
      <div ref={ref} className={`${styles.panel} ${styles.collapsed}`} role="region" aria-label="Pitch Grid controls (collapsed)">
        <span className={styles.collapsedText}>
          {preset?.name ?? "Custom"} · {sound.label} · Octave {Math.round(p("octave"))}
        </span>
        <button type="button" className={styles.chevron} onClick={onToggleCollapsed} aria-label="Show controls" aria-expanded="false">
          <Icon name="back" size={20} style={{ transform: "rotate(-90deg)" }} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className={styles.panel} role="region" aria-label="Pitch Grid controls">
      <div className={styles.scroller}>
        {/* Octave */}
        <section className={styles.block} aria-label="Octave">
          <span className={styles.heading}>Octave</span>
          <div className={styles.stepper}>
            <button type="button" className={styles.arrow} aria-label="Octave down" onClick={() => onParameterChange("octave", Math.max(0, Math.round(p("octave")) - 1))}>
              ◀
            </button>
            <output className={styles.value} aria-live="polite">
              {Math.round(p("octave"))}
            </output>
            <button type="button" className={styles.arrow} aria-label="Octave up" onClick={() => onParameterChange("octave", Math.min(4, Math.round(p("octave")) + 1))}>
              ▶
            </button>
          </div>
          <ToggleButton pressed={on("auto")} onClick={() => toggle("auto")} className={styles.small}>
            Auto
          </ToggleButton>
        </section>

        <XYPad label="Expression" xLabel="Tone" yLabel="Sustain" x={p("tone")} y={p("sustain")} onChange={(x, y) => (onParameterChange("tone", x), onParameterChange("sustain", y))} />

        <section className={styles.faders} aria-label="Faders">
          <VerticalSlider label="Whammy" value={p("whammy")} onChange={(v) => onParameterChange("whammy", v)} />
          <VerticalSlider label="Vibrato Depth" value={p("vibrato")} onChange={(v) => onParameterChange("vibrato", v)} />
          <VerticalSlider label="Filter" value={p("filter")} onChange={(v) => onParameterChange("filter", v)} />
        </section>

        {/* Switch bank */}
        <section className={styles.switches} aria-label="Switches">
          <div className={styles.column}>
            <ToggleButton pressed={on("harmonic")} onClick={() => toggle("harmonic")}>
              2nd Harmonic
            </ToggleButton>
            <ToggleButton pressed={on("pinch")} onClick={() => toggle("pinch")}>
              Pinch Harmonic On Release
            </ToggleButton>
          </div>
          <div className={styles.column} role="radiogroup" aria-label="Note transition">
            {TRANSITIONS.map((name, i) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={Math.round(p("transition")) === i}
                className={`${styles.radio} ${Math.round(p("transition")) === i ? styles.radioOn : ""}`}
                onClick={() => onParameterChange("transition", i)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className={styles.column}>
            <ToggleButton pressed={on("track")} onClick={() => toggle("track")}>
              Play Track
            </ToggleButton>
            <ToggleButton pressed={on("diatonic")} onClick={() => toggle("diatonic")}>
              {on("diatonic") ? "Diatonic" : "Chromatic"}
            </ToggleButton>
          </div>
        </section>

        <section className={styles.knobs} aria-label="Levels">
          <Knob label="Track Vol" value={p("trackVol")} onChange={(v) => onParameterChange("trackVol", v)} />
          <Knob label="Amp Vol" value={p("ampVol")} onChange={(v) => onParameterChange("ampVol", v)} />
        </section>

        {/* Preset browser */}
        <section className={styles.presets} aria-label="Presets">
          <span className={styles.heading}>All Presets Play</span>
          <div className={styles.stepper}>
            <button type="button" className={styles.arrow} aria-label="Previous preset" onClick={() => stepPreset(-1)}>
              ◀
            </button>
            <output className={styles.value} aria-live="polite">
              {presetIndex + 1}/{presets.length}
            </output>
            <button type="button" className={styles.arrow} aria-label="Next preset" onClick={() => stepPreset(1)}>
              ▶
            </button>
          </div>
          <span className={styles.presetName}>{preset?.name ?? "Custom"}</span>
          <label className={styles.selectRow}>
            <span className="visually-hidden">Sound</span>
            <select className={styles.select} value={Math.round(p("sound"))} onChange={(e) => onParameterChange("sound", Number(e.target.value))}>
              {GRID_SOUNDS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.playMode} onClick={() => onParameterChange("playMode", on("playMode") ? 0 : 1)} aria-label={`Play mode: ${on("playMode") ? "Poly" : "String"}. Switch`}>
            Play Mode: {on("playMode") ? "Poly" : "String"}
          </button>
        </section>
      </div>
      <button type="button" className={styles.chevron} onClick={onToggleCollapsed} aria-label="Hide controls" aria-expanded="true">
        <Icon name="back" size={20} style={{ transform: "rotate(90deg)" }} />
      </button>
    </div>
  );
}
