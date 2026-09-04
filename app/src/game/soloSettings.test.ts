import test, { type TestContext } from 'node:test';
import assert from 'node:assert';

import {
  ARENA_CHOICES,
  clampSettings,
  DEFAULT_SOLO_SETTINGS,
  derive,
  describe as describeSettings,
  FOOD_CHOICES,
  POPULATION_CHOICES,
  SPEED_CHOICES,
  type SoloSettings,
} from './soloSettings';
import { SoloGame, SOLO_RULES } from './soloGame';
import { GameSimulation } from './prediction';
import type { Leaderboard, ViewUpdate } from './protocol';
import { LOCAL_SKINS } from './skins.catalog';

const R = SOLO_RULES;

function run(t: TestContext, settings: SoloSettings, ticks: number) {
  let clock = 1_000_000;
  const views: ViewUpdate[] = [];
  const boards: Leaderboard[] = [];
  const game = new SoloGame(
    { name: 'Tester', colorIndex: 0, skinIndex: 0, skins: LOCAL_SKINS, settings },
    { onView: (v) => views.push(v), onLeaderboard: (b) => boards.push(b), onDeath: () => {} },
    () => clock
  );
  t.after(() => game.stop());
  game.start();
  for (let i = 0; i < ticks; i++) {
    clock += R.TICK_MS;
    game.tick();
  }
  return { game, views, boards };
}

test('the defaults are the multiplayer rules', () => {
  const d = derive(DEFAULT_SOLO_SETTINGS, {
    speed: R.BASE_SPEED,
    boost: R.BOOST_SPEED,
    turn: R.MAX_TURN_RATE,
  });
  assert.strictEqual(d.baseSpeed, R.BASE_SPEED);
  assert.strictEqual(d.boostSpeed, R.BOOST_SPEED);
  assert.strictEqual(d.maxTurnRate, R.MAX_TURN_RATE);
  assert.strictEqual(d.worldRadius, R.WORLD_RADIUS);
});

test('speed scales turn rate with it, so turn radius is unchanged', () => {
  const base = { speed: R.BASE_SPEED, boost: R.BOOST_SPEED, turn: R.MAX_TURN_RATE };
  const radius = (m: number) => {
    const d = derive({ ...DEFAULT_SOLO_SETTINGS, speed: m }, base);
    return d.baseSpeed / d.maxTurnRate;
  };
  const normal = radius(1);
  for (const c of SPEED_CHOICES) {
    assert.ok(
      Math.abs(radius(c.value) - normal) < 1e-9,
      `${c.label} corners at radius ${radius(c.value)}, not ${normal}`
    );
  }
});

test('a faster setting really does move the snakes faster', (t) => {
  const travelled = (speed: number) => {
    const r = run(t, { ...DEFAULT_SOLO_SETTINGS, speed, population: 1 }, 20);
    const start = r.views[0].enter.find((e) => e.me === 1);
    const last = r.views[r.views.length - 1];
    const now = last.move.find(([id]) => id === last.me);
    assert.ok(start && now, 'the player is alive and moving');
    return Math.hypot(now[1] - start.x, now[2] - start.y);
  };

  const chill = travelled(0.7);
  const insane = travelled(2);
  assert.ok(insane > chill * 2, `insane covered ${insane}, chill ${chill}`);
});

test('the tuned numbers reach the meta the client predicts from', (t) => {
  const settings: SoloSettings = { speed: 2, population: 5, arena: 700, food: 140 };
  const { game } = run(t, settings, 1);

  // If these disagreed with the tick loop, the player's own snake would be
  // predicted at one speed and corrected to another, all run long.
  assert.strictEqual(game.meta.baseSpeed, R.BASE_SPEED * 2);
  assert.strictEqual(game.meta.boostSpeed, R.BOOST_SPEED * 2);
  assert.strictEqual(game.meta.maxTurnRate, R.MAX_TURN_RATE * 2);
  assert.strictEqual(game.meta.worldRadius, 700);
});

test('population and arena size are obeyed', (t) => {
  const quiet = run(t, { ...DEFAULT_SOLO_SETTINGS, population: 5 }, 10);
  assert.strictEqual(quiet.boards[0].total, 5);

  const swarm = run(t, { ...DEFAULT_SOLO_SETTINGS, population: 16 }, 10);
  assert.strictEqual(swarm.boards[0].total, 16);

  const tight = run(t, { ...DEFAULT_SOLO_SETTINGS, arena: 700 }, 10);
  assert.strictEqual(tight.game.worldRadius, 700);
  for (const f of tight.views[0].fa) {
    assert.ok(Math.hypot(f[1], f[2]) <= 700, 'no pellet outside the rim');
  }
});

test('"just you" really is an empty arena', (t) => {
  const alone = run(t, { ...DEFAULT_SOLO_SETTINGS, population: 1 }, 40);
  const last = alone.boards[alone.boards.length - 1];
  assert.strictEqual(last.total, 1);
  assert.strictEqual(last.top.length, 1);
  assert.strictEqual(last.top[0].bot, 0, 'and the one snake is you');
});

test('food density is obeyed, and kept topped up', (t) => {
  const sparse = run(t, { ...DEFAULT_SOLO_SETTINGS, food: 140, population: 1 }, 60);
  const feast = run(t, { ...DEFAULT_SOLO_SETTINGS, food: 550, population: 1 }, 60);
  // Views are culled to the viewport, so compare what actually reached the
  // player rather than the world totals.
  const seen = (r: { views: ViewUpdate[] }) =>
    new Set(r.views.flatMap((v) => v.fa.map(([id]) => id))).size;
  assert.ok(seen(feast) > seen(sparse), `feast ${seen(feast)} vs sparse ${seen(sparse)}`);
});

test('stored settings are validated, not trusted', () => {
  assert.deepStrictEqual(clampSettings(null), DEFAULT_SOLO_SETTINGS);
  assert.deepStrictEqual(clampSettings({}), DEFAULT_SOLO_SETTINGS);
  // A value that was never on the menu — a hand-edited store, or an old build.
  assert.strictEqual(clampSettings({ speed: 99 }).speed, DEFAULT_SOLO_SETTINGS.speed);
  assert.strictEqual(clampSettings({ arena: -1 }).arena, DEFAULT_SOLO_SETTINGS.arena);
  assert.strictEqual(
    clampSettings({ population: 16 }).population,
    16,
    'but a real one survives'
  );
});

test('every choice on the menu round-trips through storage', () => {
  for (const c of SPEED_CHOICES) assert.strictEqual(clampSettings({ speed: c.value }).speed, c.value);
  for (const c of POPULATION_CHOICES) {
    assert.strictEqual(clampSettings({ population: c.value }).population, c.value);
  }
  for (const c of ARENA_CHOICES) assert.strictEqual(clampSettings({ arena: c.value }).arena, c.value);
  for (const c of FOOD_CHOICES) assert.strictEqual(clampSettings({ food: c.value }).food, c.value);
});

test('the summary line names the settings rather than printing numbers', () => {
  const line = describeSettings({ speed: 2, population: 16, arena: 1700, food: 300 });
  assert.strictEqual(line, 'Insane · Swarm · Wide arena');
  assert.ok(!/\d/.test(line), 'no raw numbers leak into the menu');
});

// ---------------------------------------------------------------- pausing

/** An arena plus a simulation fed from it, both on the same fake clock. */
function paired(t: TestContext, settings = DEFAULT_SOLO_SETTINGS) {
  let clock = 1_000_000;
  const sim = new GameSimulation(() => clock);
  const game = new SoloGame(
    { name: 'Tester', colorIndex: 0, skinIndex: 0, skins: LOCAL_SKINS, settings },
    { onView: (v) => sim.applyView(v), onLeaderboard: () => {}, onDeath: () => {} },
    () => clock
  );
  t.after(() => game.stop());
  sim.setMeta(game.meta);
  game.start();

  return {
    game,
    sim,
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        clock += R.TICK_MS;
        game.tick();
      }
    },
    /** Wall time passing with no arena ticks — what a pause actually is. */
    idle(ms: number) {
      clock += ms;
    },
    head() {
      const h = sim.cameraTarget(clock);
      return { ...h };
    },
    now: () => clock,
  };
}

test('pausing stops the arena', (t) => {
  const p = paired(t);
  p.tick(5);
  assert.strictEqual(p.game.isRunning, true);
  p.game.pause();
  assert.strictEqual(p.game.isRunning, false);
  p.game.resume();
  assert.strictEqual(p.game.isRunning, true);
});

test('a paused screen does not keep gliding', (t) => {
  const p = paired(t);
  p.tick(5);

  p.sim.setPaused(true);
  const before = p.head();
  // A whole second of wall clock with no ticks: the render loop is still
  // running and would otherwise predict the snake a whole second forward.
  p.idle(1000);
  const after = p.head();

  assert.strictEqual(after.x, before.x, 'the camera held still');
  assert.strictEqual(after.y, before.y);
});

test('and coming back does not apply the pause as one lurch', (t) => {
  const p = paired(t);
  p.tick(5);

  p.sim.setPaused(true);
  const held = p.head();
  p.idle(4000); // four seconds staring at the settings sheet
  p.sim.setPaused(false);

  // One frame later it should have moved one frame's worth, not four seconds'.
  p.idle(16);
  const back = p.head();
  const moved = Math.hypot(back.x - held.x, back.y - held.y);
  const oneFrame = (R.BASE_SPEED * 16) / 1000;
  assert.ok(moved < oneFrame * 3, `lurched ${moved} units; a frame is ${oneFrame}`);
});

test('re-tuning mid-run keeps the meta and the arena in step', (t) => {
  const p = paired(t);
  p.tick(5);

  p.game.pause();
  p.game.applySettings({ speed: 2, population: 5, arena: 700, food: 140 });
  p.sim.setMeta(p.game.meta);
  p.game.resume();
  p.game.pause();

  assert.strictEqual(p.game.meta.baseSpeed, R.BASE_SPEED * 2);
  assert.strictEqual(p.sim.meta.baseSpeed, R.BASE_SPEED * 2, 'prediction agrees');
  assert.strictEqual(p.sim.meta.maxTurnRate, R.MAX_TURN_RATE * 2);
  assert.strictEqual(p.game.worldRadius, 700);
  assert.deepStrictEqual(p.game.currentSettings.arena, 700);
});

test('shrinking the arena carries snakes in instead of killing them', (t) => {
  const p = paired(t, { ...DEFAULT_SOLO_SETTINGS, arena: 1700, population: 16 });
  p.tick(30);

  const deaths: number[] = [];
  const before = p.sim.getRenderSnakes(p.now()).length;
  assert.ok(before > 0);

  p.game.pause();
  p.game.applySettings({ ...DEFAULT_SOLO_SETTINGS, arena: 700, population: 16 });
  p.sim.setMeta(p.game.meta);
  p.game.resume();
  p.game.pause();
  // One tick is enough for the rim check to have run on everyone.
  p.tick(1);

  for (const s of p.sim.getRenderSnakes(p.now())) {
    assert.ok(
      Math.hypot(s.head.x, s.head.y) <= 700,
      `a snake is at ${Math.hypot(s.head.x, s.head.y)}, outside the new rim`
    );
  }
  assert.strictEqual(deaths.length, 0);
});

test('lowering the population clears the surplus out', (t) => {
  let clock = 1_000_000;
  const boards: Leaderboard[] = [];
  const game = new SoloGame(
    {
      name: 'Tester',
      colorIndex: 0,
      skinIndex: 0,
      skins: LOCAL_SKINS,
      settings: { ...DEFAULT_SOLO_SETTINGS, population: 16 },
    },
    { onView: () => {}, onLeaderboard: (b) => boards.push(b), onDeath: () => {} },
    () => clock
  );
  t.after(() => game.stop());
  game.start();
  assert.strictEqual(boards[0].total, 16);

  game.pause();
  game.applySettings({ ...DEFAULT_SOLO_SETTINGS, population: 5 });
  // The board only goes out every LEADERBOARD_EVERY_TICKS, so run to the next.
  for (let i = 0; i < R.LEADERBOARD_EVERY_TICKS; i++) {
    clock += R.TICK_MS;
    game.tick();
  }

  const last = boards[boards.length - 1];
  assert.strictEqual(last.total, 5, 'the surplus went, rather than lingering until it died');
});
