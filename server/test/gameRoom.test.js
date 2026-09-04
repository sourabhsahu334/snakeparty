'use strict';

const test = require('node:test');
const assert = require('node:assert');

const GameRoom = require('../src/GameRoom');
const C = require('../src/config');
const { SKINS } = require('../src/skins');

function makeRoom(humans = 1, { bots = true } = {}) {
  const events = [];
  const direct = [];
  const room = new GameRoom('TEST1', {
    hostClientId: 'c0',
    emit: (r, event, payload) => events.push({ event, payload }),
    emitTo: (socketId, event, payload) => direct.push({ socketId, event, payload }),
  });
  for (let i = 0; i < humans; i++) {
    room.addPlayer(`s${i}`, { clientId: `c${i}`, username: `P${i}` });
  }
  if (!bots) C.BOT_TARGET_POPULATION = 0;
  room.start();
  room.stop(); // drive ticks by hand
  // Bots spawn at random points, and one landing on a test snake would kill it
  // and make collision assertions flaky. Park them out of the way by default;
  // the bot-specific tests reposition them explicitly.
  parkBotsFarAway(room);
  return { room, events, direct, snakeOf: (i) => room.snakes.get(room.players.get(`s${i}`).snakeId) };
}

/**
 * Put a snake somewhere specific with a straight body behind it.
 *
 * Spawn protection is cleared too: a snake straight out of `start()` is still
 * inside its SPAWN_SAFE_MS, and a test that positions two snakes to collide is
 * asking about the collision rule, not about the grace period. The tests that
 * do care about the grace period leave `safeUntil` alone.
 */
function place(s, x, y, angle, score) {
  s.safeUntil = 0;
  s.x = x;
  s.y = y;
  s.angle = angle;
  s.targetAngle = angle;
  if (score !== undefined) s.score = score;
  s.path = [];
  const back = angle + Math.PI;
  const n = Math.floor(C.SEGMENTS_BASE + s.score * C.SEGMENTS_PER_SCORE);
  for (let i = 0; i < n; i++) {
    s.path.push({ x: x + Math.cos(back) * i * C.SEGMENT_SPACING, y: y + Math.sin(back) * i * C.SEGMENT_SPACING });
  }
}

const botsOf = (room) => [...room.snakes.values()].filter((s) => s.isBot);

/**
 * Park every bot far from the origin but still inside the arena and spread out,
 * so they neither show up in the viewport nor die (which would respawn them
 * somewhere random, possibly right next to the player).
 */
function parkBotsFarAway(room) {
  const bots = botsOf(room);
  // Derived from the arena size, not hardcoded: park them well outside the
  // culling box but comfortably inside the rim, or they die and respawn
  // somewhere random — possibly right next to the player.
  const ring = Math.min(C.WORLD_RADIUS * 0.8, C.WORLD_RADIUS - 120);
  bots.forEach((b, i) => {
    const a = (i / bots.length) * Math.PI * 2;
    place(b, Math.cos(a) * ring, Math.sin(a) * ring, a + Math.PI);
    b.targetAngle = b.angle;
  });
}

test('a snake advances along its heading at the base speed', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0); // pointing +x
  room.tick();
  const expected = C.BASE_SPEED * (C.TICK_MS / 1000);
  assert.ok(Math.abs(s.x - expected) < 0.01, `moved ${s.x}, expected ${expected}`);
  assert.ok(Math.abs(s.y) < 0.01, 'no drift off-axis');
});

test('turning is rate limited — you cannot spin instantly', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0);
  room.setInput('s0', Math.PI, false); // ask for a full 180
  room.tick();
  const maxTurn = C.MAX_TURN_RATE * (C.TICK_MS / 1000);
  assert.ok(Math.abs(s.angle) <= maxTurn + 1e-6, `turned ${s.angle} in one tick`);
  assert.ok(s.angle > 0, 'but it did start turning');
});

test('a full turn takes the expected number of ticks', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0);
  const target = Math.PI / 2;
  let ticks = 0;
  while (Math.abs(s.angle - target) > 0.02 && ticks < 200) {
    room.setInput('s0', target, false);
    room.tick();
    ticks++;
  }
  const expected = (Math.PI / 2) / (C.MAX_TURN_RATE * (C.TICK_MS / 1000));
  assert.ok(Math.abs(ticks - expected) <= 2, `took ${ticks} ticks, expected ~${expected.toFixed(1)}`);
});

test('eating a pellet raises the score and lengthens the body', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0);
  const before = s.path.length;
  room.food.clear();
  room._spawnFood({ x: 5, y: 0 }, 20);
  room.tick();
  assert.strictEqual(Math.floor(s.score), C.START_SCORE + 20);
  room.tick();
  assert.ok(s.path.length > before, `body grew from ${before} to ${s.path.length}`);
});

test('your own body never kills you', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0, 200);
  // Coil the body tightly right on top of the head.
  s.path = [];
  for (let i = 0; i < 60; i++) {
    const a = i * 0.4;
    s.path.push({ x: Math.cos(a) * 6, y: Math.sin(a) * 6 });
  }
  room.tick();
  assert.strictEqual(s.alive, true, 'self-collision must be harmless (snake.io rule)');
});

test("running into another snake's body kills only the one that hit it", () => {
  const { room, snakeOf } = makeRoom(2);
  const a = snakeOf(0);
  const b = snakeOf(1);
  place(a, 0, 0, 0);
  // Lay B's body as a wall directly in front of A.
  place(b, 400, 400, 0);
  b.path = [];
  for (let i = 0; i < 30; i++) b.path.push({ x: 12, y: -100 + i * C.SEGMENT_SPACING });
  room.tick();
  assert.strictEqual(a.alive, false, 'A drove into B');
  assert.strictEqual(b.alive, true, 'B is unharmed — it gets the kill');
  assert.strictEqual(b.kills, 1);
});

test('a snake just out of the gate cannot be killed by a body', () => {
  const { room, snakeOf } = makeRoom(2);
  const a = snakeOf(0);
  const b = snakeOf(1);
  place(a, 0, 0, 0);
  place(b, 400, 400, 0);
  b.path = [];
  for (let i = 0; i < 30; i++) b.path.push({ x: 12, y: -100 + i * C.SEGMENT_SPACING });
  // A is fresh; B has been around long enough to be solid.
  a.safeUntil = Date.now() + C.SPAWN_SAFE_MS;
  room.tick();
  assert.strictEqual(a.alive, true, 'spawn protection did not hold');
  assert.strictEqual(b.kills, 0, 'and nobody was credited');
});

test('a protected snake cannot kill either — the shield cuts both ways', () => {
  const { room, snakeOf } = makeRoom(2);
  const a = snakeOf(0);
  const b = snakeOf(1);
  place(a, 0, 0, 0);
  place(b, 400, 400, 0);
  b.path = [];
  for (let i = 0; i < 30; i++) b.path.push({ x: 12, y: -100 + i * C.SEGMENT_SPACING });
  // This time it is the wall of body that is fresh, and A that drives into it.
  b.safeUntil = Date.now() + C.SPAWN_SAFE_MS;
  room.tick();
  assert.strictEqual(a.alive, true, 'died on a body that is not solid yet');
});

test('protection expires, and then bodies kill again', () => {
  const { room, snakeOf } = makeRoom(2);
  const a = snakeOf(0);
  const b = snakeOf(1);
  place(a, 0, 0, 0);
  place(b, 400, 400, 0);
  b.path = [];
  for (let i = 0; i < 30; i++) b.path.push({ x: 12, y: -100 + i * C.SEGMENT_SPACING });
  a.safeUntil = Date.now() - 1; // the four seconds are up
  room.tick();
  assert.strictEqual(a.alive, false, 'A drove into B with no shield left');
});

test('a fresh snake spawns protected, and a respawned one gets it again', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  assert.ok(s.safeUntil > Date.now(), 'spawned without protection');
  assert.ok(s.safeUntil <= Date.now() + C.SPAWN_SAFE_MS, 'protected for longer than the grace');

  room._killSnake(s, null);
  assert.strictEqual(room.respawn('s0'), true);
  assert.ok(snakeOf(0).safeUntil > Date.now(), 'respawned without protection');
});

test('the view tells clients who is still protected', () => {
  const { room, snakeOf, direct } = makeRoom(1);
  const s = snakeOf(0);
  s.safeUntil = Date.now() + C.SPAWN_SAFE_MS;
  room.tick();
  const first = direct.filter((d) => d.event === 'view').pop();
  const mine = first.payload.enter.find((e) => e.id === s.id) ??
    first.payload.move.find((m) => m[0] === s.id);
  assert.ok(mine, 'the player is in their own view');
  assert.strictEqual(Array.isArray(mine) ? mine[7] : mine.iv, 1, 'flagged protected');

  s.safeUntil = 0;
  room.tick();
  const later = direct.filter((d) => d.event === 'view').pop();
  const move = later.payload.move.find((m) => m[0] === s.id);
  assert.strictEqual(move[7], 0, 'and solid once the grace is up');
});

test('touching the arena rim kills you', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, C.WORLD_RADIUS - 1, 0, 0);
  room.tick();
  assert.strictEqual(s.alive, false);
});

test('a dead snake turns into food', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0, 300);
  room.food.clear();
  room._killSnake(s, null);
  assert.ok(room.food.size > 0, 'corpse dropped pellets');
  const total = [...room.food.values()].reduce((n, f) => n + f.value, 0);
  const expected = 300 * C.CORPSE_VALUE_RATIO;
  // A corpse must never be worth more than the snake was, or dying is a way to
  // mint food out of nothing.
  assert.ok(total <= 300, `dropped ${total.toFixed(1)} from a 300-point snake`);
  assert.ok(
    Math.abs(total - expected) < expected * 0.15,
    `payout ${total.toFixed(1)} should be near ${expected.toFixed(1)}`
  );
});

test('the killer is credited and the victim is told who got them', () => {
  const { room, snakeOf, direct } = makeRoom(2);
  const a = snakeOf(0);
  const b = snakeOf(1);
  b.name = 'Hunter';
  direct.length = 0;
  room._killSnake(a, b);
  assert.strictEqual(b.kills, 1);
  const died = direct.find((d) => d.event === 'you_died');
  assert.ok(died, 'the dead player was notified');
  assert.strictEqual(died.payload.killer, 'Hunter');
  assert.strictEqual(died.socketId, 's0');
});

test('boosting costs score and drops a trail of pellets', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0, 200);
  room.food.clear();
  const before = s.score;
  for (let i = 0; i < 20; i++) {
    room.setInput('s0', 0, true);
    room.tick();
  }
  assert.ok(s.score < before, `score fell from ${before} to ${s.score.toFixed(1)}`);
  assert.ok(room.food.size > 0, 'boost left a trail');
});

test('boosting is refused below the minimum score', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0, C.BOOST_MIN_SCORE - 1);
  room.setInput('s0', 0, true);
  assert.strictEqual(s.boosting, false);
  room.tick();
  const moved = Math.hypot(s.x, s.y);
  const baseStep = C.BASE_SPEED * (C.TICK_MS / 1000);
  assert.ok(Math.abs(moved - baseStep) < 0.01, 'moved at base speed, not boost speed');
});

test('boost speed really is faster', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  place(s, 0, 0, 0, 300);
  room.setInput('s0', 0, true);
  room.tick();
  const step = s.x;
  assert.ok(Math.abs(step - C.BOOST_SPEED * (C.TICK_MS / 1000)) < 0.01, `stepped ${step}`);
});

test('radius grows with score but is capped', () => {
  const { room } = makeRoom(1);
  const small = room._radiusFor(10);
  const big = room._radiusFor(5000);
  assert.ok(big > small);
  assert.ok(big <= C.MAX_RADIUS);
});

test('garbage input is rejected', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  const before = s.targetAngle;
  for (const bad of [NaN, Infinity, null, undefined, 'left', {}]) {
    assert.strictEqual(room.setInput('s0', bad, false), false, `accepted ${String(bad)}`);
  }
  assert.strictEqual(s.targetAngle, before);
});

test('input is rate limited', () => {
  const { room } = makeRoom(1);
  let accepted = 0;
  for (let i = 0; i < 1000; i++) if (room.setInput('s0', i * 0.01, false)) accepted++;
  assert.ok(accepted <= C.INPUT_RATE_BURST + 5, `accepted ${accepted}`);
  assert.ok(accepted > 0);
});

test('the arena fills itself with bots', () => {
  const { room } = makeRoom(1);
  const living = [...room.snakes.values()].filter((s) => s.alive).length;
  assert.strictEqual(living, C.BOT_TARGET_POPULATION, `arena has ${living} snakes`);
  assert.ok(botsOf(room).length > 0);
});

test('bots keep the population topped up after deaths', () => {
  const { room } = makeRoom(1);
  const victims = botsOf(room).slice(0, 4);
  for (const b of victims) {
    b.alive = false;
    b.diedAt = Date.now() - C.BOT_RESPAWN_MS - 100;
  }
  room.tick();
  const living = [...room.snakes.values()].filter((s) => s.alive).length;
  assert.strictEqual(living, C.BOT_TARGET_POPULATION);
});

test('bots steer away from the rim instead of driving off it', () => {
  const { room } = makeRoom(1);
  const bot = botsOf(room)[0];
  place(bot, C.WORLD_RADIUS - 100, 0, 0); // pointing straight at the edge
  const b = room.bots.find((x) => x.snake.id === bot.id);
  b.think(0.05, { bodyHash: room.bodyHash, foodNear: () => null, snakes: room.snakes.values() });
  assert.ok(Math.abs(bot.targetAngle) > Math.PI / 2, 'turned back inward');
});

test('bots head for nearby food', () => {
  const { room } = makeRoom(1);
  const bot = botsOf(room)[0];
  place(bot, 0, 0, 0);
  room.food.clear();
  const pellet = room._spawnFood({ x: 0, y: 200 }, 1);
  room._rebuildHashes();
  const b = room.bots.find((x) => x.snake.id === bot.id);
  b.target = null;
  b.retargetIn = -1;
  b.think(0.05, { bodyHash: room.bodyHash, foodNear: (x, y, r) => room._foodNear(x, y, r), snakes: room.snakes.values() });
  assert.ok(Math.abs(bot.targetAngle - Math.atan2(pellet.y, pellet.x)) < 0.1, 'aimed at the pellet');
});

test('a client is only sent what is near it', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  const me = snakeOf(0);
  place(me, 0, 0, 0);
  parkBotsFarAway(room);
  room.food.clear();
  // Far enough not to be eaten this tick, but well inside the viewport.
  const near = room._spawnFood({ x: 300, y: 0 }, 1);      // in view
  const far = room._spawnFood({ x: C.WORLD_RADIUS * 0.7, y: C.WORLD_RADIUS * 0.6 }, 1); // far away
  direct.length = 0;
  room.tick(); // note: the tick also trickles in new random pellets

  const view = direct.find((d) => d.event === 'view');
  assert.ok(view, 'a view was sent');
  const ids = view.payload.fa.map((f) => f[0]);
  assert.ok(ids.includes(near.id), 'the nearby pellet is included');
  assert.ok(!ids.includes(far.id), 'the distant pellet is culled');
  const snakeIds = [...view.payload.enter.map((e) => e.id), ...view.payload.move.map((m) => m[0])];
  assert.ok(!snakeIds.some((id) => id !== me.id), 'no distant snakes included');
});

test('a snake sends its full body on entry, then head-only updates', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  const me = snakeOf(0);
  place(me, 0, 0, 0);
  parkBotsFarAway(room);

  // start() already sent one full view; forget it so we can watch entry happen.
  room.players.get('s0').known = new Set();
  direct.length = 0;
  room.tick();
  const first = direct.find((d) => d.event === 'view').payload;
  const entry = first.enter.find((e) => e.id === me.id);
  assert.ok(entry, 'first view carries a full body');
  assert.ok(Array.isArray(entry.p) && entry.p.length > 5);

  direct.length = 0;
  room.tick();
  const second = direct.find((d) => d.event === 'view').payload;
  assert.strictEqual(second.enter.length, 0, 'no repeat full body');
  assert.ok(second.move.some((m) => m[0] === me.id), 'head-only update instead');
});

test('a snake leaving the viewport is announced once', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  const me = snakeOf(0);
  place(me, 0, 0, 0);
  parkBotsFarAway(room);
  const bot = botsOf(room)[0];
  place(bot, 30, 0, 0);

  room.tick();
  assert.ok(room.players.get('s0').known.has(bot.id), 'bot is known while close');

  place(bot, Math.min(C.WORLD_RADIUS * 0.8, C.WORLD_RADIUS - 120), 0, Math.PI);
  bot.targetAngle = bot.angle;
  direct.length = 0;
  room.tick();
  const view = direct.find((d) => d.event === 'view').payload;
  assert.ok(view.leave.includes(bot.id), 'client told to drop it');
  assert.ok(!room.players.get('s0').known.has(bot.id));
});

test('per-tick view payload stays small', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  place(snakeOf(0), 0, 0, 0);
  room.tick();          // first tick sends full bodies
  direct.length = 0;
  room.tick();          // steady state
  const view = direct.find((d) => d.event === 'view');
  const bytes = Buffer.byteLength(JSON.stringify(view.payload));
  // Food is a delta, so a steady-state tick is basically just head positions.
  assert.ok(bytes < 2500, `steady-state view was ${bytes} bytes`);
});

test('the leaderboard ranks by score and reports your own rank', () => {
  const { room, snakeOf } = makeRoom(1);
  const me = snakeOf(0);
  me.score = 9999;
  const board = room.leaderboard();
  assert.strictEqual(board.top[0].name, 'P0');
  assert.ok(board.top.length <= 10);
  const mine = board.you.find((y) => y.socketId === 's0');
  assert.strictEqual(mine.rank, 1);
  assert.strictEqual(mine.score, 9999);
});

test('a dead player can respawn without leaving the room', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  const oldId = s.id;
  room._killSnake(s, null);
  assert.strictEqual(s.alive, false);

  assert.strictEqual(room.respawn('s0'), true);
  const fresh = snakeOf(0);
  assert.notStrictEqual(fresh.id, oldId, 'a new snake');
  assert.strictEqual(fresh.alive, true);
  assert.strictEqual(Math.floor(fresh.score), C.START_SCORE, 'starts small again');
});

test('respawn is refused while you are still alive', () => {
  const { room } = makeRoom(1);
  assert.strictEqual(room.respawn('s0'), false);
});

test('snakes do not spawn on top of an existing body', () => {
  const { room } = makeRoom(1);
  room._rebuildHashes();
  for (let i = 0; i < 25; i++) {
    const p = room._safeSpawnPoint();
    const near = room.bodyHash.query(p.x, p.y, 60);
    assert.strictEqual(near.length, 0, 'spawned inside another snake');
    assert.ok(Math.hypot(p.x, p.y) <= C.WORLD_RADIUS, 'spawned inside the arena');
  }
});

test('the room ends with players ranked by score', () => {
  const { room, events, snakeOf } = makeRoom(2);
  snakeOf(0).score = 120;
  snakeOf(1).score = 400;
  room.end();
  const over = events.find((e) => e.event === 'game_over');
  assert.ok(over);
  assert.strictEqual(over.payload.winner.username, 'P1');
  assert.strictEqual(over.payload.results[0].placement, 1);
  assert.strictEqual(over.payload.results[1].placement, 2);
});

test('the room empties and stops its loop when the last player leaves', () => {
  let emptied = false;
  const room = new GameRoom('TEST9', {
    hostClientId: 'c0',
    emit: () => {},
    emitTo: () => {},
    onEmpty: () => { emptied = true; },
  });
  room.addPlayer('s0', { clientId: 'c0' });
  room.start();
  assert.ok(room.timer);
  room.removePlayer('s0');
  assert.ok(emptied);
  assert.strictEqual(room.timer, null);
});

test('a disconnected player keeps their seat, then loses it', () => {
  const room = new GameRoom('TEST8', { hostClientId: 'c0', emit: () => {}, emitTo: () => {} });
  room.addPlayer('s0', { clientId: 'c0', username: 'P0' });
  room.addPlayer('s1', { clientId: 'c1', username: 'P1' });
  room.start();
  room.stop();

  room.markDisconnected('s1');
  assert.strictEqual(room.playerCount, 2);
  const back = room.reclaim('c1', 's1-new');
  assert.ok(back);
  assert.strictEqual(back.index, 1);
  assert.ok(room.players.has('s1-new'));
});

test('the simulation keeps up with a full arena', () => {
  const { room, snakeOf } = makeRoom(5);
  for (const s of room.snakes.values()) s.score = 400; // long bodies, worst case
  const started = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) room.tick();
  const msPerTick = Number(process.hrtime.bigint() - started) / 1e6 / 100;
  assert.ok(msPerTick < C.TICK_MS / 2, `${msPerTick.toFixed(2)}ms per tick, budget ${C.TICK_MS}ms`);
  assert.ok(snakeOf(0));
});

test('players keep the colour they pick, and a bad index is clamped', () => {
  const room = new GameRoom('TESTC', { hostClientId: 'c0', emit: () => {}, emitTo: () => {} });
  const p = room.addPlayer('s0', { clientId: 'c0', username: 'P0', colorIndex: 7 });
  assert.strictEqual(p.colorIndex, 7);
  assert.strictEqual(p.color, C.COLORS[7]);

  for (const bad of [-1, 999, 1.5, 'red', null, undefined, NaN]) {
    const q = new GameRoom('TESTD', { hostClientId: 'x', emit: () => {}, emitTo: () => {} })
      .addPlayer('s0', { clientId: 'x', colorIndex: bad });
    assert.ok(q.colorIndex >= 0 && q.colorIndex < C.COLORS.length, `bad index ${String(bad)} not clamped`);
  }
});

test('changing colour in the lobby updates the player and their snake', () => {
  const { room } = makeRoom(1);
  assert.strictEqual(room.setLook('s0', { colorIndex: 4 }), true);
  const p = room.players.get('s0');
  assert.strictEqual(p.colorIndex, 4);
  assert.strictEqual(room.snakes.get(p.snakeId).color, C.COLORS[4]);
});

test('two players may take the same colour', () => {
  const room = new GameRoom('TESTE', { hostClientId: 'c0', emit: () => {}, emitTo: () => {} });
  const a = room.addPlayer('s0', { clientId: 'c0', colorIndex: 3 });
  const b = room.addPlayer('s1', { clientId: 'c1', colorIndex: 3 });
  assert.strictEqual(a.colorIndex, 3);
  assert.strictEqual(b.colorIndex, 3, 'duplicates are allowed, as in snake.io');
});

test('loose food is multicoloured', () => {
  const { room } = makeRoom(1);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(room._spawnFood({ x: 0, y: 0 }, 1).ci);
  assert.ok(seen.size > 5, `only ${seen.size} distinct pellet colours in 200 spawns`);
  for (const ci of seen) assert.ok(ci >= 0 && ci < C.COLORS.length);
});

test('corpse pellets keep the dead snake’s colour', () => {
  const { room, snakeOf } = makeRoom(1);
  const s = snakeOf(0);
  s.colorIndex = 6;
  place(s, 0, 0, 0, 200);
  room.food.clear();
  room._killSnake(s, null);
  const colours = new Set([...room.food.values()].map((f) => f.ci));
  assert.deepStrictEqual([...colours], [6], 'every corpse pellet is the snake’s colour');
});

test('the palette is sent to clients once, in the meta', () => {
  const { room } = makeRoom(1);
  const meta = room.meta();
  assert.ok(Array.isArray(meta.colors) && meta.colors.length > 5);
  assert.strictEqual(meta.colors[0], C.COLORS[0]);
});

test('the wire carries colour as an index, not a hex string', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  place(snakeOf(0), 0, 0, 0);
  room.players.get('s0').known = new Set();
  room.players.get('s0').knownFood = new Set();
  direct.length = 0;
  room.tick();
  const view = direct.find((d) => d.event === 'view').payload;
  const entry = view.enter[0];
  assert.strictEqual(typeof entry.ci, 'number');
  assert.strictEqual(entry.c, undefined, 'no hex strings on the hot path');
  if (view.fa.length) assert.strictEqual(typeof view.fa[0][5], 'number', 'food carries a colour index');
});

test('players keep the skin they pick, and a bad index is clamped', () => {
  const room = new GameRoom('TESTS', { hostClientId: 'c0', emit: () => {}, emitTo: () => {} });
  const p = room.addPlayer('s0', { clientId: 'c0', username: 'P0', skinIndex: 4 });
  assert.strictEqual(p.skinIndex, 4);

  for (const bad of [-1, 999, 2.5, 'panda', null, NaN]) {
    const q = new GameRoom('TESTT', { hostClientId: 'x', emit: () => {}, emitTo: () => {} })
      .addPlayer('s0', { clientId: 'x', skinIndex: bad });
    assert.ok(q.skinIndex >= 0 && q.skinIndex < SKINS.length, `bad skin ${String(bad)} not clamped`);
  }
});

test('changing your look in the lobby updates player and snake together', () => {
  const { room } = makeRoom(1);
  assert.strictEqual(room.setLook('s0', { colorIndex: 2, skinIndex: 5 }), true);
  const p = room.players.get('s0');
  assert.strictEqual(p.colorIndex, 2);
  assert.strictEqual(p.skinIndex, 5);
  const s = room.snakes.get(p.snakeId);
  assert.strictEqual(s.skinIndex, 5);
  assert.strictEqual(s.color, C.COLORS[2]);
});

test('setLook accepts a partial change', () => {
  const { room } = makeRoom(1);
  room.setLook('s0', { colorIndex: 3, skinIndex: 7 });
  room.setLook('s0', { skinIndex: 1 });
  const p = room.players.get('s0');
  assert.strictEqual(p.skinIndex, 1, 'skin changed');
  assert.strictEqual(p.colorIndex, 3, 'colour left alone');
});

test('bots wear a spread of skins so the catalogue is visible in play', () => {
  const { room } = makeRoom(1);
  const worn = new Set([...room.snakes.values()].filter((s) => s.isBot).map((s) => s.skinIndex));
  assert.ok(worn.size >= 3, `bots only wore ${worn.size} distinct skins`);
});

test('the skin catalogue is sent to clients in the meta', () => {
  const { room } = makeRoom(1);
  const meta = room.meta();
  assert.ok(Array.isArray(meta.skins) && meta.skins.length >= 10);
  assert.strictEqual(meta.skins[0].id, 'classic');
  for (const s of meta.skins) {
    assert.ok(s.id && s.name, 'every skin has an id and a name');
    assert.ok(s.mode === 'bands' || s.mode === 'gradient', `bad mode on ${s.id}`);
    if (s.pattern !== null) {
      assert.ok(Array.isArray(s.pattern) && s.pattern.length > 0, `bad pattern on ${s.id}`);
      for (const c of s.pattern) assert.match(c, /^#[0-9A-Fa-f]{6}$/, `bad colour on ${s.id}`);
    }
  }
});

test('the wire carries the skin as an index', () => {
  const { room, direct, snakeOf } = makeRoom(1);
  place(snakeOf(0), 0, 0, 0);
  room.players.get('s0').known = new Set();
  direct.length = 0;
  room.tick();
  const entry = direct.find((d) => d.event === 'view').payload.enter[0];
  assert.strictEqual(typeof entry.si, 'number');
});
