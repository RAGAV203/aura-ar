import { Icon } from "@/components/ui/Icon";
import type { VisionPhase } from "@/features/vision/visionEngine";
import type { TrackingStatus } from "@/types/gestures";
import styles from "../studio.module.css";

interface TrackingPillProps {
  phase: VisionPhase;
  tracking: TrackingStatus;
  progress: number;
}

/** Discreet camera/tracking status. Uses text and icon shape, not colour alone. */
export function TrackingPill({ phase, tracking, progress }: TrackingPillProps) {
  let text: string | null = null;
  let tone = styles.pillNeutral;
  switch (phase) {
    case "requesting-camera":
      text = "Waiting for camera…";
      break;
    case "downloading":
      text = `Downloading tracking ${Math.round(progress * 100)}%`;
      break;
    case "initializing":
      text = "Starting tracking…";
      break;
    case "paused":
      text = "Tracking paused";
      break;
    case "running":
      if (tracking === "tracking") {
        text = "Hands tracked";
        tone = styles.pillGood;
      } else if (tracking === "lost") {
        text = "Looking for your hands";
        tone = styles.pillWarn;
      } else {
        text = "Show your hands";
      }
      break;
    default:
      return null;
  }
  return (
    <p className={`${styles.pill} ${tone}`} role="status" aria-live="polite">
      <Icon name={tracking === "tracking" && phase === "running" ? "hand" : "camera"} size={16} />
      <span>{text}</span>
    </p>
  );
}
