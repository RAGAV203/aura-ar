"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Slider, Toggle } from "@/components/ui/controls";
import type { InstrumentDefinition, InstrumentParameters } from "@/types/instruments";
import styles from "../studio.module.css";

interface ControlsSheetProps {
  open: boolean;
  onClose: () => void;
  definition: InstrumentDefinition;
  parameters: InstrumentParameters;
  presetId: string | null;
  onParameterChange: (key: string, value: number) => void;
  onPreset: (presetId: string) => void;
  volume: number;
  muted: boolean;
  onVolume: (value: number) => void;
  onMuted: (muted: boolean) => void;
  intensity: number;
  onIntensity: (value: number) => void;
}

export function ControlsSheet(props: ControlsSheetProps) {
  const { definition, parameters, presetId } = props;
  return (
    <Dialog open={props.open} onClose={props.onClose} variant="sheet" title={`${definition.name} controls`}>
      <section aria-labelledby="presets-heading" className={styles.sheetSection}>
        <h3 id="presets-heading" className={styles.sheetHeading}>
          Presets
        </h3>
        <div className={styles.presetRow} role="group" aria-label="Presets">
          {definition.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.presetChip} ${presetId === preset.id ? styles.presetActive : ""}`}
              aria-pressed={presetId === preset.id}
              onClick={() => props.onPreset(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="shape-heading" className={styles.sheetSection}>
        <h3 id="shape-heading" className={styles.sheetHeading}>
          Shape
        </h3>
        {definition.parameters.filter((spec) => !spec.panel).map((spec) => (
          <Slider
            key={spec.key}
            label={spec.label}
            description={spec.description}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={parameters[spec.key] ?? spec.defaultValue}
            format={spec.key === "hue" ? (v) => `${Math.round(v)}°` : spec.max <= 2 ? (v) => v.toFixed(2) : (v) => String(Math.round(v))}
            onChange={(value) => props.onParameterChange(spec.key, value)}
          />
        ))}
        <Slider
          label="Visual intensity"
          description="Dims and desaturates the artwork without changing how it behaves."
          min={0.2}
          max={1}
          step={0.05}
          value={props.intensity}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={props.onIntensity}
        />
      </section>

      <section aria-labelledby="sound-heading" className={styles.sheetSection}>
        <h3 id="sound-heading" className={styles.sheetHeading}>
          Sound
        </h3>
        <Toggle label="Mute" checked={props.muted} onChange={props.onMuted} description="Silent mode keeps every visual behaviour." />
        <Slider label="Volume" min={0} max={1} step={0.05} value={props.volume} format={(v) => `${Math.round(v * 100)}%`} onChange={props.onVolume} disabled={props.muted} />
      </section>
    </Dialog>
  );
}
