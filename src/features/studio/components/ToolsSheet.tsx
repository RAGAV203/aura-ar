"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Segmented, Slider, Toggle } from "@/components/ui/controls";
import type { SymmetryMode } from "../input/symmetry";
import styles from "../studio.module.css";

interface ToolsSheetProps {
  open: boolean;
  onClose: () => void;
  // Drawing tools (persistent-canvas instruments only)
  supportsDrawingTools: boolean;
  canUndo: boolean;
  onUndo: () => void;
  eraser: boolean;
  onEraser: (on: boolean) => void;
  eraserSize: number;
  onEraserSize: (size: number) => void;
  // Symmetry (every instrument)
  symmetry: SymmetryMode;
  onSymmetry: (mode: SymmetryMode) => void;
  // Camera view
  cameraActive: boolean;
  backdrop: boolean;
  onBackdrop: (on: boolean) => void;
  backdropOpacity: number;
  onBackdropOpacity: (value: number) => void;
  skeleton: boolean;
  onSkeleton: (on: boolean) => void;
  canFlipCamera: boolean;
  facing: "user" | "environment";
  onFlipCamera: () => void;
  // Display
  onHideInterface: () => void;
}

export function ToolsSheet(props: ToolsSheetProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} variant="sheet" title="Tools">
      <section className={styles.sheetSection} aria-labelledby="tools-draw">
        <h3 id="tools-draw" className={styles.sheetHeading}>
          Drawing
        </h3>
        {props.supportsDrawingTools ? (
          <>
            <div className={styles.toolRow}>
              <Button icon="reset" onClick={props.onUndo} disabled={!props.canUndo}>
                Undo
              </Button>
              <Segmented
                label="Brush"
                value={props.eraser ? "erase" : "draw"}
                onChange={(value) => props.onEraser(value === "erase")}
                options={[
                  { value: "draw", label: "Draw" },
                  { value: "erase", label: "Erase" },
                ]}
              />
            </div>
            {props.eraser && (
              <Slider label="Eraser size" min={8} max={120} step={2} value={props.eraserSize} format={(v) => `${Math.round(v)} px`} onChange={props.onEraserSize} />
            )}
          </>
        ) : (
          <p className={styles.actionDetail}>Undo and the eraser work on instruments that build up a picture: InkFlow and Light Trails.</p>
        )}
        <Segmented
          label="Symmetry"
          description="Every touch and gesture is mirrored or repeated around the centre."
          value={String(props.symmetry) as "1" | "2" | "4" | "6" | "8"}
          onChange={(value) => props.onSymmetry(Number(value) as SymmetryMode)}
          options={[
            { value: "1", label: "Off" },
            { value: "2", label: "Mirror" },
            { value: "4", label: "Quad" },
            { value: "6", label: "6×" },
            { value: "8", label: "8×" },
          ]}
        />
      </section>

      <section className={styles.sheetSection} aria-labelledby="tools-camera">
        <h3 id="tools-camera" className={styles.sheetHeading}>
          Camera view
        </h3>
        {!props.cameraActive && <p className={styles.actionDetail}>Turn the camera on to see yourself behind the artwork. Video stays on this device.</p>}
        <Toggle label="Show camera behind artwork" checked={props.backdrop} onChange={props.onBackdrop} description="Your graphics are drawn over the live view and line up with your hands." />
        <Slider
          label="Camera brightness"
          min={0.15}
          max={1}
          step={0.05}
          value={props.backdropOpacity}
          disabled={!props.backdrop}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={props.onBackdropOpacity}
        />
        <Toggle label="Hand skeleton" checked={props.skeleton} onChange={props.onSkeleton} description="Glowing outline of the hands the camera is tracking." />
        {props.canFlipCamera && (
          <Button icon="refresh" onClick={props.onFlipCamera}>
            Switch to {props.facing === "user" ? "back" : "front"} camera
          </Button>
        )}
      </section>

      <section className={styles.sheetSection} aria-labelledby="tools-display">
        <h3 id="tools-display" className={styles.sheetHeading}>
          Display
        </h3>
        <Button icon="sparkle" onClick={props.onHideInterface}>
          Hide interface
        </Button>
        <p className={styles.actionDetail}>Shows only the artwork for performing or recording. Tap “Show controls” or press Escape to bring the tools back.</p>
      </section>
    </Dialog>
  );
}
