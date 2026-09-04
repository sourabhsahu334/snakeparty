/**
 * The body curve for a snake that is going nowhere.
 *
 * The picker needs a snake that moves without a simulation behind it, so
 * instead of integrating a heading it samples a travelling sine wave: the
 * shape is a pure function of `phase`, and advancing the phase every frame
 * makes the body slither on the spot. No state, so nothing can drift.
 *
 * Points come back head-first in a local space with the head at (0, 0) and the
 * body running along +y. Callers place and orient it; keeping this file free of
 * screen units (and of Skia) is what lets it be tested in plain node.
 */

export type Pt = { x: number; y: number };

export type SlitherOpts = {
  /** How many beads to sample, head first. Two or more. */
  beads: number;
  /** Distance from head to tail along the body's axis. */
  length: number;
  /** Peak side-to-side swing, either side of the axis. */
  amplitude: number;
  /** Full sine waves fitted along the body. */
  waves: number;
  /** Where the wave sits, in radians. Advance it over time to animate. */
  phase: number;
};

/**
 * The head is damped over the first fraction of the body.
 *
 * A snake steers with its head, so the head is the part that swings *least* —
 * let the wave run at full amplitude all the way to the nose and the preview
 * reads as a fish shaking its face at you rather than a snake swimming.
 */
const HEAD_DAMP = 0.22;

export function slither({ beads, length, amplitude, waves, phase }: SlitherOpts): Pt[] {
  const n = Math.max(2, Math.floor(beads));
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); // 0 at the head, 1 at the tail
    const damp = u >= HEAD_DAMP ? 1 : smoothstep(u / HEAD_DAMP);
    out[i] = {
      x: Math.sin(phase + u * waves * Math.PI * 2) * amplitude * damp,
      y: u * length,
    };
  }
  return out;
}

/** Smooth 0→1 ramp, so the damping has no visible corner where it ends. */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Unit heading at a bead, pointing toward the head.
 *
 * The head itself has no bead ahead of it, so it borrows the direction of the
 * one behind — which is also what keeps the head from spinning when the body
 * momentarily doubles back on itself.
 */
export function headingAt(pts: Pt[], i: number): Pt {
  const ahead = pts[Math.max(0, i - 1)];
  const behind = pts[Math.min(pts.length - 1, i === 0 ? 1 : i)];
  const dx = ahead.x - behind.x;
  const dy = ahead.y - behind.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: -1 };
  return { x: dx / len, y: dy / len };
}
