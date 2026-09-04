import test, { type TestContext } from 'node:test';
import assert from 'node:assert';

import { SoloGame, SOLO_RULES } from './soloGame';
import { GameSimulation } from './prediction';
import { LOCAL_SKINS } from './skins.catalog';
import { DEFAULT_SOLO_SETTINGS, type SoloSettings } from './soloSettings';
import type { DeathInfo, Leaderboard, ViewUpdate } from './protocol';

const R = SOLO_RULES;

/**
 * Drive an arena by hand on a fake clock, collecting everything it reports.
 *
 * The point of most of these is that solo output is interchangeable with the
 * server's: the same `GameSimulation` has to be able to eat it.
 *
 * `start()` leaves a real 20Hz interval behind, which would hold the test
 * runner open, so teardown is registered on the test context rather than left
 * to each test to remember.
 */
function arena(
  t: TestContext,
  opts: { skinIndex?: number; steer?: boolean; settings?: SoloSettings } = {}
) {
  let clock = 1_000_000;
  const views: ViewUpdate[] = [];
  const boards: Leaderboard[] = [];
  const deaths: DeathInfo[] = [];

  const game = new SoloGame(
    {
      name: 'Tester',
      colorIndex: 2,
      skinIndex: opts.skinIndex ?? 0,
      skins: LOCAL_SKINS,
      settings: opts.settings,
    },
    {
      onView: (v) => views.push(v),
      onLeaderboard: (b) => boards.push(b),
      onDeath: (d) => deaths.push(d),
    },
    () => clock
  );

  t.after(() => game.stop());

  // Unless a test is steering itself, hold a gentle constant turn — a wide
  // circle, roughly what a player's thumb does. Left straight, the snake ploughs
  // through the middle of the arena and dies to a bot, which is realistic but
  // makes every assertion past it a coin flip.
  const autoSteer = opts.steer !== false;
  let heading = 0;

  return {
    game,
    views,
    boards,
    deaths,
    last: () => views[views.length - 1],
    /** Move the clock on without ticking, for anything on a timer. */
    skip(ms: number) {
      clock += ms;
    },
    /** Run `ticks` steps of the real tick length. */
    run(ticks: number) {
      for (let i = 0; i < ticks; i++) {
        if (autoSteer) {
          heading += 0.02;
          game.setInput(heading, false);
        }
        clock += R.TICK_MS;
        game.tick();
      }
    },
  };
}

test('a run starts without a server, a room, or a socket', (t) => {
  const a = arena(t);
  a.game.start();

  const v = a.last();
  assert.ok(v, 'seeding the world already produced a view');
  assert.strictEqual(v.alive, 1);
  assert.ok(v.me !== null, 'the player has a snake');
  // The view is culled to the viewport exactly as the server's is, so the bots
  // scattered across a radius-1100 arena mostly aren't in it yet — only the
  // player is guaranteed.
  assert.ok(
    v.enter.some((e) => e.me === 1),
    'the player is in view'
  );
  assert.ok(v.fa.length > 0, 'food is on the ground');
  assert.strictEqual(a.game.meta.code, 'SOLO');
});

test('the arena fills itself with bots and keeps itself full', (t) => {
  const a = arena(t);
  a.game.start();

  // The seeding board, before anyone can have died.
  const first = a.boards[0];
  assert.strictEqual(first.total, DEFAULT_SOLO_SETTINGS.population, 'seeded to target population');
  assert.ok(first.top.some((r) => r.bot === 1), 'bots are on the board');
  assert.ok(first.top.some((r) => r.bot === 0), 'and so is the player');

  // Bots die to each other constantly; the population has to hold anyway.
  a.run(400);
  const last = a.boards[a.boards.length - 1];
  assert.strictEqual(last.total, DEFAULT_SOLO_SETTINGS.population, 'still at target 20s later');
});

test('its views drive the same GameSimulation the server feeds', (t) => {
  const a = arena(t, { skinIndex: 17 });
  const sim = new GameSimulation();
  a.game.start();
  sim.setMeta(a.game.meta);

  // Five ticks is 54 world units of travel against 130 of spawn clearance, so
  // the player is still alive here whatever the bots do. Anything longer and
  // this is asserting that you survived, which is not what it is testing.
  a.run(5);
  for (const v of a.views) sim.applyView(v);

  const mine = sim.getRenderSnakes(Date.now()).find((s) => s.isLocal);
  assert.ok(mine, 'the canvas has my snake to draw');
  assert.ok(mine.points.length > 5, 'with a body, not just a head');
  assert.strictEqual(mine.name, 'Tester');
  assert.strictEqual(mine.skin?.id, LOCAL_SKINS[17].id, 'wearing the skin I picked');
  assert.ok(sim.getFood().length > 0, 'and food to eat');

  // And it keeps producing them, dead or alive, for the rest of the run. (Not
  // that the arena stays populated: a dead player watches from where they fell,
  // and the view is culled around that spot, so it does empty out as the bots
  // wander off — exactly as it does on the server.)
  const seen = a.views.length;
  a.run(200);
  for (const v of a.views.slice(seen)) sim.applyView(v);
  assert.strictEqual(a.views.length - seen, 200, 'one view per tick');
});

test('steering turns the snake, capped at the same rate the server uses', (t) => {
  const a = arena(t, { steer: false });
  a.game.start();
  a.run(1);
  const before = a.last().move.find(([id]) => id === a.last().me);
  a.game.setInput(Math.PI, false); // hard about-turn

  a.run(1);
  const after = a.last().move.find(([id]) => id === a.last().me);
  assert.ok(before && after);
  const turned = Math.abs(after[3] - before[3]);
  assert.ok(turned > 0.001, 'it actually turned');
  assert.ok(
    turned <= R.MAX_TURN_RATE * (R.TICK_MS / 1000) + 1e-6,
    `turned ${turned} in one tick; cap is ${R.MAX_TURN_RATE * (R.TICK_MS / 1000)}`
  );
});

test('snakes eat, and eating makes them bigger', (t) => {
  const a = arena(t);
  a.game.start();

  const spawned = a.last().enter.find((e) => e.me === 1);
  assert.ok(spawned, 'the player entered the world');
  assert.strictEqual(spawned.s, R.START_SCORE);
  assert.strictEqual(spawned.r, R.BASE_RADIUS + Math.sqrt(R.START_SCORE) * R.RADIUS_GROWTH);

  const before = a.boards[0].top[0].score;
  a.run(600); // 30 seconds

  const after = a.boards[a.boards.length - 1].top[0].score;
  assert.ok(after > before, `top score went ${before} -> ${after}; nobody ate`);
  assert.ok(
    a.views.some((v) => v.fd.length > 0),
    'pellets left the world'
  );
});

test('the rim kills you, and says so', (t) => {
  const a = arena(t, { steer: false });
  a.game.start();
  // Drive flat out at the wall until something gives.
  for (let i = 0; i < 900 && a.deaths.length === 0; i++) {
    const v = a.last();
    const me = v.move.find(([id]) => id === v.me) ?? null;
    if (me) a.game.setInput(Math.atan2(me[2], me[1]), false); // straight outward
    a.run(1);
  }

  assert.strictEqual(a.deaths.length > 0, true, 'never died heading for the wall');
  const death = a.deaths[0];
  assert.ok(death.score >= 0);
  assert.ok(death.rank >= 1, 'a rank to show on the death card');
  assert.strictEqual(a.last().alive, 0, 'and the view agrees you are dead');
});

test('respawning puts you back in with a fresh snake', (t) => {
  const a = arena(t, { steer: false });
  a.game.start();
  for (let i = 0; i < 900 && a.deaths.length === 0; i++) {
    const v = a.last();
    const me = v.move.find(([id]) => id === v.me) ?? null;
    if (me) a.game.setInput(Math.atan2(me[2], me[1]), false);
    a.run(1);
  }
  const deadId = a.last().me;

  a.game.respawn();
  a.run(2);

  const v = a.last();
  assert.strictEqual(v.alive, 1, 'alive again');
  assert.notStrictEqual(v.me, deadId, 'as a new snake');
});

test('a fresh snake is flagged protected, and solid again once it lapses', (t) => {
  const a = arena(t);
  a.game.start();

  const spawn = a.last().enter.find((e) => e.me === 1);
  assert.ok(spawn, 'the player entered the world');
  assert.strictEqual(spawn.iv, 1, 'spawned without protection');

  // Jump the clock instead of ticking it out: 4 seconds of play is 80 ticks of
  // arena the assertion does not care about, and one tick after the jump is
  // enough to see the flag flip.
  a.skip(R.SPAWN_SAFE_MS);
  a.run(1);
  const v = a.last();
  const me = v.move.find(([id]) => id === v.me);
  assert.ok(me, 'still being reported');
  assert.strictEqual(me[7], 0, 'still protected after the grace ran out');
});

test('nothing can kill you by body while the grace period is running', (t) => {
  // A small arena packed with snakes: without protection, driving into the
  // middle of this is death within a second or two.
  const a = arena(t, {
    steer: false,
    settings: { ...DEFAULT_SOLO_SETTINGS, population: 16, arena: 700 },
  });
  a.game.start();

  // Steer at the centre the whole way. Snakes spawn pointed inward, so this
  // takes the rim — the one thing protection does not cover — out of it, and
  // leaves the pile-up in the middle as the only thing that could kill us.
  const ticks = Math.floor(R.SPAWN_SAFE_MS / R.TICK_MS);
  for (let i = 0; i < ticks; i++) {
    const v = a.last();
    const me = v.move.find(([id]) => id === v.me) ?? null;
    if (me) a.game.setInput(Math.atan2(-me[2], -me[1]), false);
    a.run(1);
    assert.strictEqual(a.last().alive, 1, `died ${i} ticks in, with protection running`);
  }
  assert.strictEqual(a.deaths.length, 0, 'the death card fired anyway');
});

test('finishing a run produces a scoreboard the results screen can show', (t) => {
  const a = arena(t);
  a.game.start();
  a.run(100);
  const summary = a.game.summary();
  assert.strictEqual(summary.roomCode, 'SOLO');
  assert.ok(summary.durationMs > 0);
  assert.ok(summary.results.length > 1, 'you and the bots you were racing');
  const places = summary.results.map((r) => r.placement);
  assert.deepStrictEqual(
    places,
    [...places].sort((x, y) => x - y),
    'placements ascend down the board'
  );
  assert.strictEqual(places[0], 1, 'and start at the winner');

  // Bots get a head start, so the player is often outside the top eight —
  // they must still appear, which is the whole point of the extra row.
  const mine = summary.results.find((r) => r.clientId === 'solo');
  assert.ok(mine, 'the player is on their own scoreboard');
  assert.strictEqual(mine.username, 'Tester');
  // ResultsScreen highlights the local row by index; solo pins the player to 0.
  assert.strictEqual(mine.index, 0);
});

test('stopping clears the timer that would otherwise tick forever', (t) => {
  const a = arena(t);
  a.game.start();
  a.run(5);
  const seen = a.views.length;

  a.game.stop();
  a.game.stop(); // idempotent
  a.run(5); // hand-driven ticks still work; it is the interval that stopped
  assert.ok(a.views.length > seen);
});
