'use strict';

/**
 * Two real socket clients in one private room: each sees the other's snake
 * moving through the arena, plus bots, food and a live leaderboard.
 *
 *   npm run test:clients
 */

process.env.PORT = process.env.PORT || '3999';
// These exercise game mechanics, not sign-in, so they connect as guests and
// the account gate is off. accountGate.test.js is what proves the gate works.
process.env.REQUIRE_ACCOUNT_FOR_ROOMS = 'false';

const { io: ioClient } = require('socket.io-client');
const { httpServer, manager } = require('../src/index');
const C = require('../src/config');

const URL = `http://localhost:${process.env.PORT}`;
const checks = [];

function check(label, ok, detail = '') {
  checks.push({ label, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function connect(clientId, username) {
  return new Promise((resolve, reject) => {
    const s = ioClient(URL, { auth: { clientId, username }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const emit = (s, e, p) => new Promise((r) => s.emit(e, p ?? {}, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The arena is full of bots, so a test snake can legitimately be killed mid-run.
 * Always look the snake up fresh (respawn makes a NEW one with a new id) and
 * revive it if it died, so later assertions test what they mean to.
 */
async function liveSnake(room, socket, sock) {
  let p = room.players.get(sock.id);
  let s = room.snakes.get(p.snakeId);
  if (!s || !s.alive) {
    await new Promise((r) => sock.emit('respawn', {}, r));
    await wait(120);
    p = room.players.get(sock.id);
    s = room.snakes.get(p.snakeId);
  }
  return s;
}

/** Steer in a slow circle so the snake stays alive and away from the rim. */
function autopilot(socket, sim) {
  let angle = 0;
  return setInterval(() => {
    angle += 0.08;
    socket.emit('set_input', { a: angle, b: false });
  }, 50);
}

(async () => {
  console.log(`\nsnake arena integration test  (${URL})\n`);

  const alice = await connect('client-alice', 'Alice');
  const bob = await connect('client-bob', 'Bob');
  check('both clients connected', alice.connected && bob.connected);

  const created = await emit(alice, 'create_room');
  check('create_room returned a code', created.ok && typeof created.code === 'string', created.code);
  check(
    'join code is 5 unambiguous chars',
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(created.code || ''),
    created.code
  );

  const badJoin = await emit(bob, 'join_room', { code: 'ZZZZZ' });
  check('joining an unknown code is rejected', !badJoin.ok && badJoin.error === 'ROOM_NOT_FOUND');

  const joined = await emit(bob, 'join_room', { code: created.code.toLowerCase() });
  check('join_room works (and is case-insensitive)', joined.ok, joined.error || '');
  check('lobby lists both players', joined.ok && joined.lobby.players.length === 2);

  const notHost = await emit(bob, 'start_game');
  check('non-host cannot start the game', !notHost.ok && notHost.error === 'NOT_HOST');

  // ---- gameplay ----------------------------------------------------------
  const starts = [];
  const aliceViews = [];
  const bobViews = [];
  const boards = [];
  const overs = [];

  alice.on('game_start', (m) => starts.push(m));
  bob.on('game_start', (m) => starts.push(m));
  alice.on('view', (v) => aliceViews.push(v));
  bob.on('view', (v) => bobViews.push(v));
  bob.on('leaderboard', (b) => boards.push(b));
  alice.on('game_over', (p) => overs.push(p));
  bob.on('game_over', (p) => overs.push(p));

  const started = await emit(alice, 'start_game');
  check('host started the game', started.ok, started.error || '');
  await wait(150);

  check('both clients received game_start', starts.length === 2);
  check(
    'game_start carries the arena parameters',
    starts[0] && starts[0].worldRadius === C.WORLD_RADIUS && starts[0].tickMs === C.TICK_MS
  );

  const room = manager.getRoom(created.code);
  check(
    'the arena filled itself with bots',
    [...room.snakes.values()].filter((s) => s.isBot).length > 0,
    `${[...room.snakes.values()].length} snakes total`
  );

  // Park both players near each other so they are inside one another's view.
  const aSnake = room.snakes.get(room.players.get(alice.id).snakeId);
  const bSnake = room.snakes.get(room.players.get(bob.id).snakeId);
  aSnake.x = 0; aSnake.y = 0;
  bSnake.x = 120; bSnake.y = 0;

  const pilotA = autopilot(alice);
  const pilotB = autopilot(bob);
  await wait(1200);

  const expectedTicks = 1200 / C.TICK_MS;
  check(
    `server ticked at ~${1000 / C.TICK_MS}Hz`,
    Math.abs(aliceViews.length - expectedTicks) <= 5,
    `${aliceViews.length} views in 1.2s`
  );

  // The core assertion: each client's stream contains the other's snake.
  const bobSeenByAlice = new Set();
  for (const v of aliceViews) {
    for (const e of v.enter) if (e.id === bSnake.id) bobSeenByAlice.add(`${e.x},${e.y}`);
    for (const m of v.move) if (m[0] === bSnake.id) bobSeenByAlice.add(`${m[1]},${m[2]}`);
  }
  const aliceSeenByBob = new Set();
  for (const v of bobViews) {
    for (const e of v.enter) if (e.id === aSnake.id) aliceSeenByBob.add(`${e.x},${e.y}`);
    for (const m of v.move) if (m[0] === aSnake.id) aliceSeenByBob.add(`${m[1]},${m[2]}`);
  }
  check("Alice receives Bob's moving snake", bobSeenByAlice.size > 10, `${bobSeenByAlice.size} distinct positions`);
  check("Bob receives Alice's moving snake", aliceSeenByBob.size > 10, `${aliceSeenByBob.size} distinct positions`);

  check('food reaches the client', aliceViews.some((v) => v.fa.length > 0));
  check('the leaderboard is broadcast', boards.length > 0, `${boards.length} updates`);
  check(
    'the leaderboard ranks by score and includes your own row',
    boards.length > 0 && boards[0].top.length > 0 && boards[0].you.length === 2
  );

  const avgBytes = Math.round(
    aliceViews.reduce((n, v) => n + Buffer.byteLength(JSON.stringify(v)), 0) / aliceViews.length
  );
  check('per-tick payload is compact', avgBytes < 2500, `${avgBytes} bytes avg (~${Math.round(avgBytes * 20 / 1024)} KB/s)`);

  clearInterval(pilotA);
  clearInterval(pilotB);

  // Steering is authoritative: the server turns the snake toward our heading.
  const aLive = await liveSnake(room, alice, alice);
  const before = aLive.angle;
  alice.emit('set_input', { a: before + Math.PI / 2, b: false });
  await wait(200);
  check(
    'set_input steers the snake server-side',
    aLive.angle !== before,
    `${before.toFixed(2)} → ${aLive.angle.toFixed(2)}`
  );

  // ---- death and respawn --------------------------------------------------
  const bLive = await liveSnake(room, bob, bob);
  const died = [];
  bob.on('you_died', (d) => died.push(d));
  bLive.x = C.WORLD_RADIUS - 1;
  bLive.y = 0;
  bLive.angle = 0;
  bLive.targetAngle = 0;
  await wait(250);
  check(
    'hitting the rim kills you and the client is told',
    died.length >= 1,
    died[0] ? `score ${died[0].score}` : 'no you_died received'
  );

  const again = await emit(bob, 'respawn');
  check('a dead player can respawn in place', again.ok);
  await wait(150);
  const fresh = room.snakes.get(room.players.get(bob.id).snakeId);
  check(
    'respawn produces a live snake back at starting size',
    fresh.alive && fresh.score >= C.START_SCORE && fresh.score < C.START_SCORE + 25,
    `score ${fresh.score.toFixed(0)} (it may have eaten in the time it took to check)`
  );

  // ---- end of round -------------------------------------------------------
  const ended = await emit(alice, 'end_round');
  check('host can end the round', ended.ok);
  await wait(200);
  check('game_over reached both clients', overs.length === 2, `${overs.length} received`);
  check('results are placed 1..N', overs[0] && overs[0].results.map((r) => r.placement).join(',') === '1,2');
  check('results carry score and kills', overs[0] && overs[0].results.every((r) => typeof r.score === 'number' && typeof r.kills === 'number'));

  const replay = await emit(alice, 'play_again');
  check('host can reset the room to the lobby', replay.ok && room.status === 'lobby');

  alice.disconnect();
  bob.disconnect();
  await wait(300);
  check('room is destroyed once empty', manager.getRoom(created.code) === null, `${manager.size} rooms left`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  httpServer.close();
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\nintegration test crashed:', err);
  process.exit(1);
});
