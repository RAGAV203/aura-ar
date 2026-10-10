import type { ControlEvent, ControlInput, ControlPoint } from "@/types/instruments";
import type { Point2 } from "@/types/gestures";

/** 1 = off, 2 = left/right mirror, 4 = quad mirror, 6 / 8 = rotational kaleidoscope. */
export type SymmetryMode = 1 | 2 | 4 | 6 | 8;

export const SYMMETRY_MODES: SymmetryMode[] = [1, 2, 4, 6, 8];

type Mapper = (p: Point2) => Point2;

/**
 * Builds the copies for a symmetry mode. Rotations happen in aspect-correct
 * space (around the view centre) so kaleidoscopes stay round on any screen.
 */
export function symmetryMappers(mode: SymmetryMode, aspect: number): Mapper[] {
  const a = aspect > 0 ? aspect : 1;
  if (mode === 1) return [(p) => p];
  if (mode === 2) return [(p) => p, (p) => ({ x: 1 - p.x, y: p.y })];
  if (mode === 4) return [(p) => p, (p) => ({ x: 1 - p.x, y: p.y }), (p) => ({ x: p.x, y: 1 - p.y }), (p) => ({ x: 1 - p.x, y: 1 - p.y })];
  return Array.from({ length: mode }, (_, k) => {
    const angle = (k / mode) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return (p: Point2) => {
      const dx = (p.x - 0.5) * a;
      const dy = p.y - 0.5;
      return { x: (dx * cos - dy * sin) / a + 0.5, y: dx * sin + dy * cos + 0.5 };
    };
  });
}

/** Maps a velocity by transforming a small step from the origin point. */
function mapVelocity(mapper: Mapper, origin: Point2, velocity: Point2): Point2 {
  const a = mapper(origin);
  const b = mapper({ x: origin.x + velocity.x * 0.01, y: origin.y + velocity.y * 0.01 });
  return { x: (b.x - a.x) * 100, y: (b.y - a.y) * 100 };
}

/** Returns a new input with every point and event replicated by the symmetry mode. */
export function applySymmetry(input: ControlInput, mode: SymmetryMode, aspect: number): ControlInput {
  if (mode === 1) return input;
  const mappers = symmetryMappers(mode, aspect);
  const points: ControlPoint[] = [];
  const events: ControlEvent[] = [];
  mappers.forEach((map, k) => {
    for (const point of input.points) {
      points.push(k === 0 ? point : { ...point, id: `${point.id}#${k}`, position: map(point.position), velocity: mapVelocity(map, point.position, point.velocity) });
    }
    for (const event of input.events) events.push(k === 0 ? event : { ...event, position: map(event.position) });
  });
  return { ...input, points, events };
}
