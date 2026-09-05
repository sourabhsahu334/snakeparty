'use strict';

/**
 * Capacity measurement: N concurrent clients spread across rooms of 5, playing
 * for real (steering every tick), while we sample CPU, memory and bytes sent.
 *
 *   node test/loadTest.js [clients] [seconds]
 */

process.env.PORT = process.env.PORT || '3995';
process.env.REQUIRE_ACCOUNT_FOR_ROOMS = 'false';

const CLIENTS = Number(process.argv[2] || 50);
const SECONDS = Number(process.argv[3] || 30);
const PER_ROOM = 5;

const { io: ioClient } = require('socket.io-client');
const C = require('../src/config');

// Count every byte the server pushes out, before socket.io framing.
let bytesOut = 0;
let msgsOut = 0;
const { Server } = require('socket.io');
const origEmit = Server.prototype.to;
// Simpler: wrap JSON size at the room level via a hook below.

const { httpServer, manager, io } = require('../src/index');

// Measure payload sizes by tapping the same serialiser the server uses.
const origToEmit = io.to.bind(io);
io.to = (target) => {
  const room = origToEmit(target);
  const origE = room.emit.bind(room);
  room.emit = (event, payload) => {
    bytesOut += Buffer.byteLength(JSON.stringify(payload ?? ''));
    msgsOut++;
    return origE(event, payload);
  };
  return room;
};

const URL = `http://localhost:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(i) {
  return new Promise((resolve, reject) => {
    const s = ioClient(URL, {
      auth: { clientId: `load-${i}`, username: `L${i}`, colorIndex: i % 20, skinIndex: i % 16 },
      transports: ['websocket'],
      reconnection: false,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const emit = (s, e, p) => new Promise((r) => s.emit(e, p ?? {}, r));

(async () => {
  console.log(`\nload test: ${CLIENTS} clients, rooms of ${PER_ROOM}, ${SECONDS}s\n`);

  const sockets = [];
  const codes = [];
  let received = 0;

  for (let i = 0; i < CLIENTS; i++) {
    const s = await connect(i);
    sockets.push(s);
    s.on('view', () => received++);

    if (i % PER_ROOM === 0) {
      const res = await emit(s, 'create_room');
      codes.push(res.code);
    } else {
      await emit(s, 'join_room', { code: codes[codes.length - 1] });
    }
  }
  console.log(`  connected ${sockets.length} clients across ${codes.length} rooms`);

  // Start every room.
  for (let i = 0; i < sockets.length; i += PER_ROOM) await emit(sockets[i], 'start_game');
  await wait(500);

  // Everyone steers constantly — the realistic worst case for input handling.
  const pilots = sockets.map((s, i) => {
    let a = i;
    return setInterval(() => {
      a += 0.15;
      s.emit('set_input', { a, b: i % 4 === 0 });
    }, 50);
  });

  // ---- sample ------------------------------------------------------------
  const cpu0 = process.cpuUsage();
  const t0 = Date.now();
  bytesOut = 0;
  msgsOut = 0;
  received = 0;

  const tickLag = [];
  let lastTick = Date.now();
  const lagTimer = setInterval(() => {
    const now = Date.now();
    tickLag.push(now - lastTick - 50);
    lastTick = now;
  }, 50);

  await wait(SECONDS * 1000);

  clearInterval(lagTimer);
  const elapsed = (Date.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  pilots.forEach(clearInterval);

  const mem = process.memoryUsage();
  const cpuPct = ((cpu.user + cpu.system) / 1000 / (elapsed * 1000)) * 100;
  const snakes = [...manager.rooms.values()].reduce((n, r) => n + r.snakes.size, 0);
  tickLag.sort((a, b) => a - b);

  console.log(`
  ── measured over ${elapsed.toFixed(1)}s ──
  rooms                 ${manager.rooms.size}
  snakes simulated      ${snakes}   (players + bots)
  server ticks/sec      ${(manager.rooms.size * (1000 / C.TICK_MS)).toFixed(0)}

  CPU (1 core = 100%)   ${cpuPct.toFixed(1)}%
  event-loop lag p50    ${tickLag[Math.floor(tickLag.length * 0.5)]}ms
  event-loop lag p95    ${tickLag[Math.floor(tickLag.length * 0.95)]}ms
  event-loop lag max    ${tickLag[tickLag.length - 1]}ms

  RSS                   ${(mem.rss / 1048576).toFixed(0)} MB
  heap used             ${(mem.heapUsed / 1048576).toFixed(0)} MB

  outbound              ${(bytesOut / elapsed / 1024).toFixed(0)} KB/s total
  per player            ${(bytesOut / elapsed / 1024 / CLIENTS).toFixed(1)} KB/s
  messages/sec          ${(msgsOut / elapsed).toFixed(0)}
  views received        ${(received / elapsed / CLIENTS).toFixed(1)}/sec/client (expect ${1000 / C.TICK_MS})
`);

  sockets.forEach((s) => s.disconnect());
  await wait(400);
  httpServer.close();
  process.exit(0);
})().catch((e) => {
  console.error('load test failed:', e);
  process.exit(1);
});
