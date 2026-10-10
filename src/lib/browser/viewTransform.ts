import type { Point2 } from "@/types/gestures";

/**
 * Maps normalised camera-frame coordinates (0..1 of the video) to normalised
 * coordinates of the view that shows the video with `object-fit: cover`.
 * screen = frame * scale + offset (per axis). Points outside the visible crop
 * map outside 0..1.
 */
export interface ViewTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_TRANSFORM: ViewTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

export function coverTransform(videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number): ViewTransform {
  if (videoWidth <= 0 || videoHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return IDENTITY_TRANSFORM;
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  const scaleX = (videoWidth * scale) / viewWidth;
  const scaleY = (videoHeight * scale) / viewHeight;
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 };
}

export function applyTransform(point: Point2, t: ViewTransform): Point2 {
  return { x: point.x * t.scaleX + t.offsetX, y: point.y * t.scaleY + t.offsetY };
}
