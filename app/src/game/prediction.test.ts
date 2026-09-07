import test from 'node:test';
import assert from 'node:assert';

import { CORRECTION_MS, GameSimulation, SNAP_DISTANCE } from './prediction';
import type { GameMeta, ViewUpdate } from './protocol';

function makeClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** The cadence `step()`'s frame filter is seeded at, so a warm run is exact. */
const FRAME_MS = 1000 / 60;

/**
 * Drive the sim the way the render loop does — a run of frames, not one jump.
 *
 * `step()` integrates a *smoothed* frame delta rather than the raw one, so a
 * single enormous step is deliberately under-integrated (see prediction.ts).
 * Advancing at the cadence the filter is seeded with makes it a no-op, so
 * these assertions still pin the real speed exactly.
 */
function advanceFrames(
  sim: GameSimulation,
  clock: { advance: (ms: number) => number },
  ms: number
) {
  const frames = Math.round(ms / FRAME_MS);
  for (let i = 0; i < frames; i++) {
    clock.advance(FRAME_MS);
    sim.step();
  }
}

const PALETTE = ['#FF9E2C', '#FF4FA3', '#7ED321', '#3FA9F5', '#B06AB3'];

const SKINS = [
  { id: 'classic', name: 'Classic', desc: '', mode: 'bands' as const, pattern: null, band: 1 },
  { id: 'bumble', name: 'Bumble', desc: '', mode: 'bands' as const, pattern: ['#FFC300', '#2B2B2B'], band: 3 },
  { id: 'ember', name: 'Ember', desc: '', mode: 'gradient' as const, pattern: ['#FFE066', '#C81D11'] },
];

const META: GameMeta = {
  code: 'ABCDE',
  colors: PALETTE,
  skins: SKINS,
  worldRadius: 1800,
  tickMs: 50,
  borderWarn: 250,
  viewWidth: 900,
  viewHeight: 900,
  segmentSpacing: 9,
  baseSpeed: 215,
  boostSpeed: 410,
  maxTurnRate: 5.4,
  boostMinScore: 15,
};

/** A body of `n` points trailing behind (x, y) along -x. */
const bodyAt = (x: number, y: number, n = 14): [number, number][] =>
  Array.from({ length: n }, (_, i) => [x - i * META.segmentSpacing, y] as [number, number]);

function enterView(overrides: Partial<ViewUpdate> = {}): ViewUpdate {
  return {
    t: 1,
    me: 1,
    alive: 1,
    enter: [
      { id: 1, n: 'Me', ci: 0, si: 0, b: 0, me: 1, p: bodyAt(0, 0), x: 0, y: 0, a: 0, r: 10, s: 10 },
      { id: 2, n: 'Bot', ci: 1, si: 1, b: 1, me: 0, p: bodyAt(300, 0), x: 300, y: 0, a: 0, r: 12, s: 40 },
    ],
    move: [],
    leave: [],
    fa: [[7, 60, 0, 5, 1, 2]],
    fd: [],
    full: 0,
    ...overrides,
  };
}

function setup() {
  const clock = makeClock();
  const sim = new GameSimulation(clock.now);
  sim.setMeta(META);
  sim.applyView(enterView());
  return { sim, clock };
}

test('entering view seeds snakes, food and the local id', () => {
  const { sim } = setup();
  assert.strictEqual(sim.snakes.size, 2);
  assert.strictEqual(sim.localId, 1);
  assert.strictEqual(sim.localAlive, true);
  assert.strictEqual(sim.food.size, 1);
  assert.strictEqual(sim.localSnake!.name, 'Me');
  assert.strictEqual(sim.snakes.get(2)!.isBot, true);
});

test('a move update pushes a new head onto the body', () => {
  const { sim } = setup();
  const before = sim.snakes.get(2)!.path.length;
  const newHead = 300 + META.segmentSpacing * 2;
  sim.applyView({ ...enterView(), enter: [], move: [[2, newHead, 0, 0, 12, 40, 0]] });
  const s = sim.snakes.get(2)!;
  // Points are laid down at fixed spacing, so path[0] tracks the head to
  // within one segment rather than landing exactly on it.
  assert.ok(s.path[0].x > 300, 'the front of the body advanced');
  assert.ok(
    newHead - s.path[0].x <= META.segmentSpacing,
    `path[0] at ${s.path[0].x} trails head ${newHead} by more than one segment`
  );
  assert.ok(s.path.length > before, 'the body grew');
  assert.ok(s.path.length <= Math.floor(12 + 40 * 0.42), 'never longer than the score allows');
});

test('a shrinking score trims the body (this is what boosting costs you)', () => {
  const clock = makeClock();
  const sim = new GameSimulation(clock.now);
  sim.setMeta(META);
  // Enter with a long body, then report a much smaller score.
  sim.applyView({
    ...enterView(),
    enter: [
      { id: 2, n: 'Bot', ci: 1, si: 1, b: 1, me: 0, p: bodyAt(300, 0, 120), x: 300, y: 0, a: 0, r: 12, s: 200 },
    ],
  });
  assert.strictEqual(sim.snakes.get(2)!.path.length, 120);
  sim.applyView({ ...enterView(), enter: [], move: [[2, 307, 0, 0, 12, 20, 0]] });
  assert.strictEqual(sim.snakes.get(2)!.path.length, Math.floor(12 + 20 * 0.42));
});

test('leaving view drops the snake', () => {
  const { sim } = setup();
  sim.applyView({ ...enterView(), enter: [], leave: [2] });
  assert.strictEqual(sim.snakes.has(2), false);
  assert.strictEqual(sim.snakes.size, 1);
});

test('a full resync discards anything not re-sent', () => {
  const { sim } = setup();
  sim.applyView({
    ...enterView(),
    full: 1,
    enter: [
      { id: 1, n: 'Me', ci: 0, si: 0, b: 0, me: 1, p: bodyAt(500, 500), x: 500, y: 500, a: 1, r: 14, s: 90 },
    ],
    fa: [],
    fd: [],
  });
  assert.strictEqual(sim.snakes.size, 1, 'the stale bot is gone');
  assert.strictEqual(sim.food.size, 0);
  assert.strictEqual(sim.localSnake!.score, 90);
});

test('the local snake moves before the server confirms it', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  advanceFrames(sim, clock, 50);
  const cam = sim.cameraTarget();
  const expected = META.baseSpeed * 0.05;
  assert.ok(Math.abs(cam.x - expected) < 1, `predicted to ${cam.x.toFixed(1)}, expected ~${expected}`);
});

test('local turning obeys the same rate limit as the server', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(Math.PI); // demand a full 180
  clock.advance(50);
  sim.step();
  const render = sim.getRenderSnakes();
  const me = render.find((s) => s.isLocal)!;
  const maxTurn = META.maxTurnRate * 0.05;
  assert.ok(Math.abs(me.angle) <= maxTurn + 1e-6, `turned ${me.angle} in one tick`);
});

test('boost predicts the faster speed', () => {
  const { sim, clock } = setup();
  sim.applyView({ ...enterView(), enter: [], move: [[1, 0, 0, 0, 10, 300, 1]] });
  sim.setDesiredAngle(0);
  sim.setBoosting(true);
  advanceFrames(sim, clock, 50);
  const cam = sim.cameraTarget();
  assert.ok(Math.abs(cam.x - META.boostSpeed * 0.05) < 1, `moved ${cam.x.toFixed(1)}`);
});

test('boost is not predicted when the score is too low to allow it', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  sim.setBoosting(true); // local score is 10, below boostMinScore of 15
  advanceFrames(sim, clock, 50);
  const cam = sim.cameraTarget();
  assert.ok(Math.abs(cam.x - META.baseSpeed * 0.05) < 1, 'fell back to base speed');
});

test('a correct prediction produces no visible correction', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  clock.advance(50);
  sim.step();
  const predicted = sim.cameraTarget();

  sim.applyView({ ...enterView(), enter: [], move: [[1, predicted.x, predicted.y, 0, 10, 10, 0]] });
  const after = sim.cameraTarget();
  assert.ok(Math.abs(after.x - predicted.x) < 1.5, 'camera did not jump');
});

test('a small divergence is smoothed away rather than snapped', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  advanceFrames(sim, clock, 50);

  // Server says we are 20 units short of where we predicted.
  sim.applyView({ ...enterView(), enter: [], move: [[1, 0, 0, 0, 10, 10, 0]] });
  const justAfter = sim.cameraTarget();
  assert.ok(justAfter.x > 2, `still drawn near the predicted spot, got ${justAfter.x.toFixed(1)}`);

  // step() clamps dt and smooths it, so advance in frame-sized slices like the
  // real render loop does rather than one big jump.
  let elapsed = 0;
  while (elapsed < CORRECTION_MS + 20) {
    clock.advance(FRAME_MS);
    elapsed += FRAME_MS;
    sim.cameraTarget();
  }
  const settled = sim.cameraTarget();
  const truthful = META.baseSpeed * (elapsed / 1000);
  assert.ok(
    Math.abs(settled.x - truthful) < 4,
    `correction finished: ${settled.x.toFixed(1)} vs ${truthful.toFixed(1)}`
  );
});

test('a jittery render clock does not shake the arena', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  // Warm the filter at a steady 60fps, the way a real run starts.
  advanceFrames(sim, clock, 500);

  // Frame deltas that swing hard around roughly the same average — what a busy
  // JS thread actually delivers once the arena fills up with big snakes.
  const deltas = [8, 26, 11, 22, 9, 31, 14, 19, 12, 24, 7, 28, 15, 18, 10, 23];
  let last = sim.cameraTarget().x;
  const steps: number[] = [];
  for (const d of deltas) {
    clock.advance(d);
    const x = sim.cameraTarget().x;
    steps.push(x - last);
    last = x;
  }

  const min = Math.min(...steps);
  const max = Math.max(...steps);
  const rawSpread = Math.max(...deltas) / Math.min(...deltas);
  assert.ok(rawSpread > 3, 'the deltas really are jittery');
  // Integrating those deltas raw would move the camera in steps that far apart
  // too, which is the shake. Smoothed, it advances at a near-constant rate.
  assert.ok(
    max / min < 1.6,
    `camera stepped unevenly: ${min.toFixed(2)}..${max.toFixed(2)} (raw spread ${rawSpread.toFixed(1)}x)`
  );
});

test('a large divergence snaps instead of sliding across the arena', () => {
  const { sim, clock } = setup();
  clock.advance(50);
  sim.step();
  const far = SNAP_DISTANCE + 400;
  sim.applyView({ ...enterView(), enter: [], move: [[1, far, 0, 0, 10, 10, 0]] });
  const cam = sim.cameraTarget();
  assert.ok(Math.abs(cam.x - far) < 3, `snapped to ${cam.x.toFixed(1)}, expected ~${far}`);
});

test('other snakes are extrapolated along their heading between ticks', () => {
  const { sim, clock } = setup();
  const at0 = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  assert.ok(Math.abs(at0 - 300) < 0.01, 'sits on its reported spot at alpha 0');

  clock.advance(25);
  const half = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  const step = META.baseSpeed * (META.tickMs / 1000);
  assert.ok(Math.abs(half - (300 + step * 0.5)) < 0.5, `half a tick on: ${half.toFixed(2)}`);
});

test('extrapolation is capped when updates stop arriving', () => {
  const { sim, clock } = setup();
  clock.advance(5000);
  const head = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  const step = META.baseSpeed * (META.tickMs / 1000);
  assert.ok(head <= 300 + step * 1.5 + 0.01, `ran away to ${head.toFixed(1)}`);
});

test('render points start at the head and follow the body', () => {
  const { sim, clock } = setup();
  clock.advance(25); // let extrapolation move the head off path[0]
  const bot = sim.getRenderSnakes().find((s) => s.id === 2)!;
  assert.ok(bot.points.length > 10);
  assert.ok(Math.abs(bot.points[0].x - bot.head.x) < 0.01, 'first point is the head');
  assert.ok(bot.points[1].x < bot.points[0].x, 'the stored body trails behind it');
  assert.ok(bot.points[2].x < bot.points[1].x, 'and keeps going back');
});

test('death is reported by the server, never predicted locally', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  clock.advance(500);
  sim.step();
  assert.strictEqual(sim.localAlive, true, 'still alive until the server says otherwise');

  sim.applyView({ ...enterView(), enter: [], alive: 0 });
  assert.strictEqual(sim.localAlive, false);
});

test('the camera follows your snake, and holds still once you die', () => {
  const { sim, clock } = setup();
  sim.setDesiredAngle(0);
  clock.advance(100);
  const moving = sim.cameraTarget();
  assert.ok(moving.x > 5, 'camera tracked the snake');

  sim.applyView({ ...enterView(), enter: [], alive: 0, move: [[1, 999, 111, 0, 10, 10, 0]] });
  const dead = sim.cameraTarget();
  assert.strictEqual(dead.x, 999, 'parked on the last known position');
  assert.strictEqual(dead.y, 111);
});

test('food arrives and leaves as a delta', () => {
  const { sim } = setup();
  assert.strictEqual(sim.food.size, 1, 'seeded from the first view');

  sim.applyView({ ...enterView(), enter: [], fa: [[99, 10, 10, 8, 5, 3]], fd: [] });
  assert.strictEqual(sim.food.size, 2, 'a new pellet appeared');
  assert.strictEqual(sim.food.get(99)!.value, 5);

  sim.applyView({ ...enterView(), enter: [], fa: [], fd: [7] });
  assert.strictEqual(sim.food.size, 1, 'the eaten pellet went away');
  assert.strictEqual(sim.food.has(99), true);
});

test('palette indices resolve to colours', () => {
  const { sim } = setup();
  assert.strictEqual(sim.localSnake!.color, PALETTE[0], 'snake colour came from the palette');
  assert.strictEqual(sim.snakes.get(2)!.color, PALETTE[1]);
  assert.strictEqual(sim.getFood()[0].ci, 2, 'food carries its palette index');
  assert.strictEqual(sim.colorAt(2), PALETTE[2]);
});

test('an out-of-range colour index falls back instead of crashing', () => {
  const { sim } = setup();
  assert.strictEqual(sim.colorAt(999), PALETTE[0]);
  assert.strictEqual(sim.colorAt(-1), PALETTE[0]);
});

test('reset clears the arena', () => {
  const { sim } = setup();
  sim.reset();
  assert.strictEqual(sim.snakes.size, 0);
  assert.strictEqual(sim.food.size, 0);
  assert.strictEqual(sim.localId, null);
  assert.strictEqual(sim.localAlive, false);
});

test('skins resolve from the catalogue', () => {
  const { sim } = setup();
  assert.strictEqual(sim.localSnake!.skinIndex, 0);
  assert.strictEqual(sim.skinAt(1)!.id, 'bumble');
  assert.strictEqual(sim.skinAt(99), undefined, 'unknown index degrades to plain colour');

  const rendered = sim.getRenderSnakes();
  assert.strictEqual(rendered.find((s) => s.id === 2)!.skin!.id, 'bumble');
});

// ---------------------------------------------------------------------------
// Adapting to a slow link.
//
// The complaint these cover: the game is smooth on fast internet and lurches
// on slow. The latency is not the bug — the bug is a client tuned for updates
// every tick giving up 75ms in when they arrive every 200ms, so snakes freeze
// and then teleport. These pin the adaptation, and the "unchanged on a fast
// link" case that guards against fixing slow by degrading fast.
// ---------------------------------------------------------------------------

/** Feed `n` server updates `gapMs` apart, so the sim can measure the cadence. */
function driveAtCadence(
  sim: GameSimulation,
  clock: { advance: (ms: number) => number },
  gapMs: number,
  n: number
) {
  let x = 300;
  const step = META.baseSpeed * (gapMs / 1000);
  for (let i = 0; i < n; i++) {
    clock.advance(gapMs);
    x += step;
    sim.applyView({ ...enterView(), enter: [], move: [[2, x, 0, 0, 12, 40, 0]] });
  }
  return x;
}

test('a slow link keeps other snakes gliding instead of freezing mid-arena', () => {
  const { sim, clock } = setup();
  const last = driveAtCadence(sim, clock, 200, 4);

  // 200ms after the last update, the old fixed 1.5-tick cap (75ms) would have
  // stopped this snake dead 125ms ago and then teleported it on the next one.
  clock.advance(200);
  const head = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  const perTick = META.baseSpeed * (META.tickMs / 1000);
  assert.ok(
    head > last + perTick * 1.5,
    `stalled at the old cap: ${head.toFixed(1)} vs last update ${last.toFixed(1)}`
  );
});

test('extrapolation still has a ceiling — a dead link does not launch snakes', () => {
  const { sim, clock } = setup();
  const last = driveAtCadence(sim, clock, 200, 4);

  clock.advance(30_000);
  const head = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  const perTick = META.baseSpeed * (META.tickMs / 1000);
  assert.ok(
    head <= last + perTick * 6 + 0.01,
    `ran past the ceiling to ${head.toFixed(1)}`
  );
});

test('a fast link is left exactly as it was', () => {
  const { sim, clock } = setup();
  const last = driveAtCadence(sim, clock, META.tickMs, 6);

  clock.advance(5000);
  const head = sim.getRenderSnakes().find((s) => s.id === 2)!.head.x;
  const perTick = META.baseSpeed * (META.tickMs / 1000);
  assert.ok(
    head <= last + perTick * 1.5 + 0.01,
    `a good connection should still cap at 1.5 ticks, got ${head.toFixed(1)}`
  );
});

test('a slow link corrects smoothly where a fast one would snap', () => {
  const { sim, clock } = setup();
  driveAtCadence(sim, clock, 200, 4);

  // Divergence past the fixed threshold, but well inside what a 4x-slow link
  // earns. It should be carried as a blended offset, not snapped to.
  sim.setDesiredAngle(0);
  advanceFrames(sim, clock, 50);
  const far = SNAP_DISTANCE + 60;
  sim.applyView({ ...enterView(), enter: [], move: [[1, far, 0, 0, 10, 10, 0]] });

  const cam = sim.cameraTarget();
  assert.ok(
    Math.abs(cam.x - far) > 3,
    `snapped to the server position instead of blending: ${cam.x.toFixed(1)}`
  );
});
