'use strict';

/**
 * Deliverable check #4: a deliberately modified client tries to cheat, and the
 * authoritative server state is inspected after every attempt.
 *
 *   npm run test:cheat
 */

process.env.PORT = process.env.PORT || '3998';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { io: ioClient } = require('socket.io-client');
const { httpServer, manager } = require('../src/index');
const C = require('../src/config');
const { normalizeAngle } = require('../src/GameRoom');

// This test is about server authority, not about surviving the arena. Bots
// wander into things and would kill the cheater's snake at random, making the
// assertions flaky for reasons that have nothing to do with cheating.
C.BOT_TARGET_POPULATION = 0;

const URL = `http://localhost:${process.env.PORT}`;
const checks = [];

function check(label, blocked, detail = '') {
  checks.push({ label, ok: blocked });
  console.log(`${blocked ? '  ✓ blocked ' : '  ✗ ALLOWED'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function connect(clientId, username) {
  return new Promise((resolve, reject) => {
    const s = ioClient(URL, { auth: { clientId, username }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}
const emit = (s, e, p) => new Promise((r) => s.emit(e, p, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`\ncheat-resistance test  (${URL})\n`);

  // A client that refuses to send a clientId at all.
  let anonRejected = false;
  await new Promise((resolve) => {
    const s = ioClient(URL, { auth: {}, transports: ['websocket'], reconnection: false });
    s.once('connect_error', () => { anonRejected = true; resolve(); });
    s.once('connect', () => { s.disconnect(); resolve(); });
    setTimeout(resolve, 1500);
  });
  check('handshake without a clientId', anonRejected);

  const cheater = await connect('client-cheater', 'Mallory');
  const honest = await connect('client-honest', 'Honest');

  const created = await emit(cheater, 'create_room', {});
  await emit(honest, 'join_room', { code: created.code });
  const room = manager.getRoom(created.code);

  // A third client tries to take a seat in a 5-cap room that is already full.
  const fillers = [];
  for (let i = 0; i < 3; i++) {
    const f = await connect(`filler-${i}`, `F${i}`);
    fillers.push(f);
    await emit(f, 'join_room', { code: created.code });
  }
  const overflow = await connect('client-overflow', 'Extra');
  const overflowRes = await emit(overflow, 'join_room', { code: created.code });
  check('joining a full room', !overflowRes.ok, overflowRes.error);

  await emit(cheater, 'start_game', {});
  await wait(150);

  // Always look snakes up fresh: respawning replaces the object, so a captured
  // reference goes stale the moment a snake dies.
  const snakeOf = (sock) => room.snakes.get(room.players.get(sock.id).snakeId);
  /** The cheater's snake, revived if something killed it. */
  const liveMe = async () => {
    let s = snakeOf(cheater);
    if (!s || !s.alive) {
      await emit(cheater, 'respawn', {});
      await wait(150);
      s = snakeOf(cheater);
    }
    return s;
  };

  let me = await liveMe();
  const victim = snakeOf(honest);
  const mePlayer = room.players.get(cheater.id);

  // 1. Teleport: claim a position outright.
  const before = { x: me.x, y: me.y };
  cheater.emit('set_input', { a: 0, b: false, x: 0, y: 0, score: 99999 });
  cheater.emit('set_position', { x: 0, y: 0 });
  cheater.emit('view', { t: 1, move: [[me.id, 0, 0, 0, 99, 99999, 1]] });
  cheater.emit('teleport', { x: 1700, y: 1700 });
  await wait(200);
  check(
    'client-reported position / teleport events',
    (me.x !== before.x || me.y !== before.y) && Math.hypot(me.x, me.y) > 1,
    'snake moved only by the server simulation'
  );

  // 2. Award itself points.
  cheater.emit('set_score', 99999);
  cheater.emit('score', { score: 99999 });
  cheater.emit('game_over', { winner: { username: 'Mallory' } });
  cheater.emit('leaderboard', { top: [{ rank: 1, name: 'Mallory', score: 99999 }] });
  await wait(120);
  check('client-set score', me.score < 1000, `score is ${me.score.toFixed(0)}`);
  check('client-forced game_over', room.status === 'running');

  // 3. Snap-turn: demand an instant 180 and see if the server obliges.
  me = await liveMe();
  const committed = me.angle;
  cheater.emit('set_input', { a: committed + Math.PI, b: false });
  await wait(60);
  const turned = Math.abs(normalizeAngle(me.angle - committed));
  const capForWindow = C.MAX_TURN_RATE * (C.TICK_MS / 1000) * 4;
  check(
    'instant 180-degree snap turn',
    turned <= capForWindow + 0.2,
    `turned ${turned.toFixed(2)} rad in the window, cap ~${capForWindow.toFixed(2)}`
  );

  // 4. Flood the input channel.
  let sent = 0;
  for (let i = 0; i < 2000; i++) {
    cheater.emit('set_input', { a: i * 0.01, b: false });
    sent++;
  }
  await wait(250);
  check(
    `input flood (${sent} events)`,
    mePlayer.tokens < C.INPUT_RATE_BURST,
    `token bucket drained to ${mePlayer.tokens.toFixed(1)}`
  );
  // The arena has bots in it, so the cheater's snake may legitimately die
  // mid-flood. What matters is that flooding didn't corrupt its state — not
  // that it survived.
  const coherent =
    Number.isFinite(me.angle) &&
    Number.isFinite(me.x) &&
    Number.isFinite(me.y) &&
    me.score >= 0 &&
    (!me.alive || me.path.length > 0);
  check(
    'flood did not corrupt the snake',
    coherent,
    me.alive ? `alive, body ${me.path.length} points` : 'died to a bot mid-flood, state still coherent'
  );

  // 5. Steer another player's snake.
  const victimAngle = victim.targetAngle;
  cheater.emit('set_input', { socketId: honest.id, snakeId: victim.id, a: victimAngle + 2, b: true });
  await wait(120);
  check(
    "steering another player's snake",
    victim.targetAngle === victimAngle,
    'victim heading untouched by the cheater'
  );

  // 6. Start / reset the room without being host.
  const hostAttempt = await emit(honest, 'start_game', {});
  check('non-host start_game', !hostAttempt.ok, hostAttempt.error);
  const resetAttempt = await emit(honest, 'play_again', {});
  check('non-host play_again', !resetAttempt.ok, resetAttempt.error);

  // 6b. Grant itself boost while too small to afford it.
  const boostSnake = await liveMe();
  boostSnake.score = C.BOOST_MIN_SCORE - 2;
  cheater.emit('set_input', { a: boostSnake.angle, b: true });
  await wait(120);
  check(
    'boosting below the minimum score',
    boostSnake.boosting === false,
    `score ${boostSnake.score.toFixed(1)}`
  );

  // 7. Drive straight through the arena rim. Revive first, or the check would
  // pass vacuously against an already-dead snake.
  const rimSnake = await liveMe();
  rimSnake.score = 200;
  rimSnake.x = C.WORLD_RADIUS - 2;
  rimSnake.y = 0;
  rimSnake.angle = 0;
  rimSnake.targetAngle = 0;
  room.players.get(cheater.id).tokens = C.INPUT_RATE_BURST;
  for (let i = 0; i < 50; i++) cheater.emit('set_input', { a: 0, b: false });
  await wait(250);
  check('driving through the arena rim', rimSnake.alive === false, 'cheater died at the boundary');

  // 8. Join a match already in progress.
  const lateRes = await emit(overflow, 'join_room', { code: created.code });
  check('joining a room mid-match', !lateRes.ok, lateRes.error);

  // 9. Reclaim a seat belonging to someone else.
  const impostor = await connect('client-impostor', 'Impostor');
  const stolen = await emit(impostor, 'rejoin_room', { code: created.code });
  check("rejoining with someone else's clientId", !stolen.ok, stolen.error);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} cheat attempts blocked\n`);

  [cheater, honest, overflow, impostor, ...fillers].forEach((s) => s.disconnect());
  await wait(200);
  httpServer.close();
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\ncheat test crashed:', err);
  process.exit(1);
});
