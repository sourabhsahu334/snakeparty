'use strict';

/**
 * Phase 4 check: a dropped connection keeps its seat and its snake, and a
 * client that never comes back is cleaned up.
 *
 *   npm run test:reconnect
 */

process.env.PORT = process.env.PORT || '3996';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { io: ioClient } = require('socket.io-client');
const C = require('../src/config');

// Shorten the grace window so the test doesn't sit for 15 seconds. The room
// reads this at disconnect time, so mutating it before we start is enough.
C.RECONNECT_GRACE_MS = 800;

const { httpServer, manager } = require('../src/index');

const URL = `http://localhost:${process.env.PORT}`;
const checks = [];

function check(label, ok, detail = '') {
  checks.push({ label, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function connect(clientId, username) {
  return new Promise((resolve, reject) => {
    const s = ioClient(URL, {
      auth: { clientId, username },
      transports: ['websocket'],
      reconnection: false,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const emit = (s, e, p) => new Promise((r) => s.emit(e, p, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`\nreconnect / grace-window test  (grace ${C.RECONNECT_GRACE_MS}ms)\n`);

  const alice = await connect('c-alice', 'Alice');
  let bob = await connect('c-bob', 'Bob');

  const created = await emit(alice, 'create_room', {});
  const joined = await emit(bob, 'join_room', { code: created.code });
  const bobIndex = joined.you.index;
  const room = manager.getRoom(created.code);

  await emit(alice, 'start_game', {});
  await wait(150);
  const bobSnake = room.snakes.get(room.players.get(bob.id).snakeId);
  const headAtDrop = { x: bobSnake.x, y: bobSnake.y };

  // --- drop Bob mid-round --------------------------------------------------
  bob.disconnect();
  await wait(150);

  const held = [...room.players.values()].find((p) => p.clientId === 'c-bob');
  check('the seat is held after a mid-round drop', !!held && room.playerCount === 2);
  check('the seat is flagged as offline', !!held && held.connected === false);
  check('the round keeps running', room.status === 'running');

  await wait(200);
  const after = room.snakes.get(held.snakeId);
  check(
    'the abandoned snake keeps moving on autopilot',
    after.x !== headAtDrop.x || after.y !== headAtDrop.y,
    `${headAtDrop.x.toFixed(0)},${headAtDrop.y.toFixed(0)} -> ${after.x.toFixed(0)},${after.y.toFixed(0)}`
  );

  // --- Bob comes back ------------------------------------------------------
  bob = await connect('c-bob', 'Bob');
  const rejoin = await emit(bob, 'rejoin_room', { code: created.code });

  check('rejoin_room succeeds inside the grace window', rejoin.ok, rejoin.error || '');
  check('the same player slot comes back', rejoin.ok && rejoin.you.index === bobIndex, `slot ${rejoin.ok && rejoin.you.index}`);
  check('the server reports the round as running', rejoin.ok && rejoin.status === 'running');
  check(
    'the arena parameters are handed back to catch up',
    rejoin.ok && !!rejoin.meta && rejoin.meta.worldRadius === C.WORLD_RADIUS
  );
  check(
    'the snake survived the round trip',
    rejoin.ok && room.snakes.get(room.players.get(bob.id).snakeId).alive
  );
  check('the seat is marked online again', room.players.get(bob.id).connected === true);

  // The reconnected socket must actually receive live ticks again.
  const views = [];
  bob.on('view', (v) => views.push(v));
  await wait(300);
  check('live views resume after reconnect', views.length > 3, `${views.length} views`);
  check('the resumed view re-sends full bodies', views[0] && views[0].enter.length > 0);

  // Control still works.
  const snakeNow = room.snakes.get(room.players.get(bob.id).snakeId);
  const before = snakeNow.targetAngle;
  bob.emit('set_input', { a: before + 1, b: false });
  await wait(120);
  check('input works again after reconnect', snakeNow.targetAngle !== before);

  // --- someone who never comes back ---------------------------------------
  bob.disconnect();
  await wait(C.RECONNECT_GRACE_MS + 400);
  const stillThere = [...room.players.values()].some((p) => p.clientId === 'c-bob');
  check('the seat is released once the grace window expires', !stillThere, `${room.playerCount} player(s) left`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  alice.disconnect();
  await wait(200);
  httpServer.close();
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\nreconnect test crashed:', err);
  process.exit(1);
});
