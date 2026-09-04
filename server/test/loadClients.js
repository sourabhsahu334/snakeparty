'use strict';
/**
 * Client-only load generator. Run against a server in a SEPARATE process so the
 * server's CPU can be measured without the clients' own work polluting it.
 *
 *   node test/loadClients.js <url> [clients] [seconds]
 */
const { io: ioClient } = require('socket.io-client');

const URL = process.argv[2] || 'http://localhost:3994';
const CLIENTS = Number(process.argv[3] || 50);
const SECONDS = Number(process.argv[4] || 30);
const PER_ROOM = 5;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (s, e, p) => new Promise((r) => s.emit(e, p ?? {}, r));

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

(async () => {
  const sockets = [];
  const codes = [];
  let bytesIn = 0;
  let views = 0;

  for (let i = 0; i < CLIENTS; i++) {
    const s = await connect(i);
    sockets.push(s);
    s.on('view', (v) => {
      views++;
      bytesIn += Buffer.byteLength(JSON.stringify(v));
    });
    if (i % PER_ROOM === 0) codes.push((await emit(s, 'create_room')).code);
    else await emit(s, 'join_room', { code: codes[codes.length - 1] });
  }
  for (let i = 0; i < sockets.length; i += PER_ROOM) await emit(sockets[i], 'start_game');
  await wait(500);

  const pilots = sockets.map((s, i) => {
    let a = i;
    return setInterval(() => {
      a += 0.15;
      s.emit('set_input', { a, b: i % 4 === 0 });
    }, 50);
  });

  console.log(`READY ${sockets.length} clients / ${codes.length} rooms`);
  bytesIn = 0;
  views = 0;
  const t0 = Date.now();
  await wait(SECONDS * 1000);
  const el = (Date.now() - t0) / 1000;

  pilots.forEach(clearInterval);
  console.log(`RESULT views/sec/client=${(views / el / CLIENTS).toFixed(1)} inbound_total_KBs=${(bytesIn / el / 1024).toFixed(0)} per_player_KBs=${(bytesIn / el / 1024 / CLIENTS).toFixed(1)}`);
  sockets.forEach((s) => s.disconnect());
  await wait(300);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
