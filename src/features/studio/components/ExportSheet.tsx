"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Toggle } from "@/components/ui/controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "../studio.module.css";

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  onPng: () => void;
  onProject: () => void;
  onVideo: (() => void) | null;
  onClear: () => void;
  onHelp: () => void;
  /** Offered only while the camera is shown behind the artwork. */
  cameraAvailable: boolean;
  includeCamera: boolean;
  onIncludeCamera: (include: boolean) => void;
}

function Action({ icon, title, detail, onClick }: { icon: IconName; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.actionRow} onClick={onClick}>
      <Icon name={icon} />
      <span className={styles.actionText}>
        <span className={styles.actionTitle}>{title}</span>
        <span className={styles.actionDetail}>{detail}</span>
      </span>
    </button>
  );
}

export function ExportSheet({ open, onClose, onPng, onProject, onVideo, onClear, onHelp, cameraAvailable, includeCamera, onIncludeCamera }: ExportSheetProps) {
  return (
    <Dialog open={open} onClose={onClose} variant="sheet" title="More">
      <div className={styles.actionList}>
        {cameraAvailable && (
          <Toggle
            label="Include camera in image and clip"
            checked={includeCamera}
            onChange={onIncludeCamera}
            description="Off by default. Saved creations and thumbnails never contain camera images."
          />
        )}
        <Action icon="image" title="Export image" detail="Save the current artwork as a PNG." onClick={onPng} />
        <Action icon="file" title="Export project file" detail="A portable .aura.json you can import on any device." onClick={onProject} />
        {onVideo ? (
          <Action icon="record" title="Record a clip" detail="Up to 15 seconds of video with sound." onClick={onVideo} />
        ) : (
          <p className={styles.actionDetail}>
            <Icon name="info" size={16} /> Video recording isn&apos;t supported in this browser — export an image instead.
          </p>
        )}
        <Action icon="reset" title="Clear canvas" detail="Start fresh with the same instrument." onClick={onClear} />
        <Action icon="info" title="How to play" detail="Gestures, touch and keyboard controls." onClick={onHelp} />
      </div>
    </Dialog>
  );
}
