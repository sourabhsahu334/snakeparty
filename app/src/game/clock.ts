/**
 * One monotonic clock for everything that moves.
 *
 * `Date.now()` is quantised to whole milliseconds and can step backwards when
 * the system clock is adjusted. A whole millisecond is 6% of a frame at 60fps,
 * and prediction multiplies its frame delta by a speed — so that quantisation
 * lands in the arena as position noise, which reads as the whole screen
 * shaking. `performance.now()` is sub-millisecond and monotonic.
 *
 * Everything sharing a time axis with the simulation has to read the same
 * source: the two clocks have different epochs, so mixing them yields a frame
 * delta measured in decades.
 */
const perf =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance
    : null;

export const nowMs: () => number = perf ? () => perf.now() : () => Date.now();

/**
 * The timestamp `requestAnimationFrame` passed us — the frame's own time,
 * rather than whenever the callback happened to get around to asking.
 *
 * React Native's rAF is `performance.now()`-based, so it only shares an epoch
 * with `nowMs` when we have `performance`. Without it the argument is
 * unusable and we fall back to reading the clock ourselves.
 */
export const frameTime = (rafTimestamp: number): number =>
  perf ? rafTimestamp : nowMs();
