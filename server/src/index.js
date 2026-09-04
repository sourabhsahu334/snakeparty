'use strict';

require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');

const C = require('./config');
const RoomManager = require('./RoomManager');
const db = require('./db');
const auth = require('./auth');
const credits = require('./credits');
const { recordMatch } = require('./matches');
const httpApi = require('./httpApi');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

// ------------------------------------------------------------------ http shell

const httpServer = http.createServer((req, res) => {
  httpApi
    .handle(req, res, { rooms: () => (manager ? manager.size : 0) })
    .then((handled) => {
      if (handled) return;
      res.writeHead(404);
      res.end();
    })
    .catch((err) => {
      console.error('[http] unhandled:', err.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 20000,
});

// ------------------------------------------------------------------- rooms

const manager = new RoomManager({
  emitTo: (socketId, event, payload) => {
    io.to(socketId).emit(event, payload);
  },
  emit: (room, event, payload) => {
    io.to(room.code).emit(event, payload);
    if (event === 'game_over') {
      // Off the hot path, and never allowed to break the round.
      recordMatch(payload).then((id) => {
        if (id) console.log(`[room ${room.code}] match ${id} recorded`);
      });
    }
  },
});

// --------------------------------------------------------------- handshake

io.use(async (socket, next) => {
  const handshake = socket.handshake.auth || {};
  const clientId = typeof handshake.clientId === 'string' ? handshake.clientId.slice(0, 64) : null;
  if (!clientId) return next(new Error('MISSING_CLIENT_ID'));

  const user = auth.verifyToken(handshake.accessToken);

  socket.data.clientId = clientId;
  socket.data.userId = user ? user.id : null;
  socket.data.username = sanitizeName(
    (user && user.username) || handshake.username || `Guest-${clientId.slice(0, 4)}`
  );
  socket.data.colorIndex = Number.isInteger(handshake.colorIndex) ? handshake.colorIndex : undefined;
  socket.data.skinIndex = Number.isInteger(handshake.skinIndex) ? handshake.skinIndex : undefined;
  next();
});

/**
 * The player row this socket spends credits against.
 *
 * A signed-in client already carries our JWT, so its id came out of the
 * handshake. A client that never called /auth/guest gets a row created on the
 * spot, keyed on its install id — the same row it would have got by signing in,
 * so credits survive a restart either way.
 */
async function ensurePlayerId(socket) {
  if (socket.data.userId) return socket.data.userId;
  if (!socket.data.clientId) return null;
  const player = await auth.signInGuest(socket.data.clientId, socket.data.username);
  socket.data.userId = player ? player.id : null;
  return socket.data.userId;
}

function sanitizeName(name) {
  return String(name).replace(/[^\w \-]/g, '').trim().slice(0, 20) || 'Player';
}

function identityOf(socket) {
  return {
    clientId: socket.data.clientId,
    userId: socket.data.userId,
    username: socket.data.username,
    colorIndex: socket.data.colorIndex,
    skinIndex: socket.data.skinIndex,
  };
}

/** Clients may name a palette slot and a skin when creating or joining. */
function applyLook(socket, payload) {
  if (!payload) return;
  if (Number.isInteger(payload.colorIndex)) socket.data.colorIndex = payload.colorIndex;
  if (Number.isInteger(payload.skinIndex)) socket.data.skinIndex = payload.skinIndex;
}

function ack(cb, payload) {
  if (typeof cb === 'function') cb(payload);
}

// ------------------------------------------------------------------ events

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id} (${socket.data.username})`);

  socket.on('create_room', async (payload, cb) => {
    const existing = manager.roomForSocket(socket.id);
    if (existing) return ack(cb, { ok: false, error: 'ALREADY_IN_ROOM' });
    applyLook(socket, payload);

    // Hosting costs one of the day's free rooms; joining one costs nothing.
    // The player row is materialised here rather than in the handshake so an
    // ordinary connection stays database-free — but it does have to happen
    // before the spend, or a client that simply never called /auth/guest would
    // have no counter to charge and would host unlimited rooms.
    const playerId = await ensurePlayerId(socket);
    const spent = await credits.spend(playerId);
    if (!spent.ok) {
      return ack(cb, {
        ok: false,
        error: 'NO_ROOM_CREDITS',
        credits: { remaining: 0, perDay: credits.PER_DAY, resetsAt: spent.resetsAt },
      });
    }

    let room;
    try {
      room = manager.createRoom({ hostClientId: socket.data.clientId });
    } catch (err) {
      // Never charge for a room that does not exist.
      await credits.refund(playerId);
      throw err;
    }
    const player = room.addPlayer(socket.id, identityOf(socket));
    socket.join(room.code);

    console.log(
      `[room ${room.code}] created by ${socket.data.username} ` +
        `(${spent.remaining}/${credits.PER_DAY} rooms left today)`
    );
    ack(cb, {
      ok: true,
      code: room.code,
      you: publicSelf(player),
      lobby: room.lobbyState(),
      credits: { remaining: spent.remaining, perDay: credits.PER_DAY },
    });
    io.to(room.code).emit('lobby_state', room.lobbyState());
  });

  socket.on('join_room', (payload, cb) => {
    const code = payload && payload.code;
    if (manager.roomForSocket(socket.id)) return ack(cb, { ok: false, error: 'ALREADY_IN_ROOM' });
    applyLook(socket, payload);

    const res = manager.joinRoom(code, socket.id, identityOf(socket));
    if (!res.ok) return ack(cb, res);

    socket.join(res.room.code);
    console.log(`[room ${res.room.code}] ${socket.data.username} joined`);
    ack(cb, {
      ok: true,
      code: res.room.code,
      you: publicSelf(res.player),
      lobby: res.room.lobbyState(),
    });
    io.to(res.room.code).emit('lobby_state', res.room.lobbyState());
  });

  /**
   * Reconnect path: the client kept its clientId, so if the grace window has
   * not expired we hand the same snake back rather than making a new player.
   */
  socket.on('rejoin_room', (payload, cb) => {
    const room = manager.getRoom(payload && payload.code);
    if (!room) return ack(cb, { ok: false, error: 'ROOM_NOT_FOUND' });

    const player = room.reclaim(socket.data.clientId, socket.id);
    if (!player) return ack(cb, { ok: false, error: 'NO_SEAT_HELD' });

    socket.join(room.code);
    console.log(`[room ${room.code}] ${socket.data.username} reconnected`);
    ack(cb, {
      ok: true,
      code: room.code,
      you: publicSelf(player),
      lobby: room.lobbyState(),
      status: room.status,
      // The client rebuilds the world from the next `view`; it just needs the
      // arena parameters to draw with.
      meta: room.status === 'running' ? room.meta() : null,
    });
    io.to(room.code).emit('lobby_state', room.lobbyState());
  });

  // Change your colour and/or skin from the lobby.
  socket.on('set_look', (payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    applyLook(socket, payload);
    const ok = room.setLook(socket.id, payload || {});
    if (ok) io.to(room.code).emit('lobby_state', room.lobbyState());
    ack(cb, { ok });
  });

  socket.on('start_game', (_payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    if (!room.isHost(socket.data.clientId)) return ack(cb, { ok: false, error: 'NOT_HOST' });
    if (room.playerCount < C.MIN_PLAYERS) return ack(cb, { ok: false, error: 'NOT_ENOUGH_PLAYERS' });

    const started = room.start();
    if (!started) return ack(cb, { ok: false, error: 'CANNOT_START' });
    console.log(`[room ${room.code}] game started with ${room.playerCount} player(s)`);
    ack(cb, { ok: true });
  });

  socket.on('play_again', (_payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    if (!room.isHost(socket.data.clientId)) return ack(cb, { ok: false, error: 'NOT_HOST' });
    ack(cb, { ok: room.resetToLobby() });
  });

  /**
   * Hot path: desired heading plus whether boost is held. No ack, no logging,
   * no database — validate and store. The server still decides how fast the
   * snake may actually turn and whether it has the score to boost.
   */
  socket.on('set_input', (payload) => {
    const room = manager.roomForSocket(socket.id);
    if (!room || !payload) return;
    room.setInput(socket.id, payload.a, payload.b);
  });

  // Dead players can jump straight back in without leaving the room.
  socket.on('respawn', (_payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    ack(cb, { ok: room.respawn(socket.id) });
  });

  // Host can end the round early and take everyone to the scoreboard.
  socket.on('end_round', (_payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    if (!room.isHost(socket.data.clientId)) return ack(cb, { ok: false, error: 'NOT_HOST' });
    room.end();
    ack(cb, { ok: true });
  });

  socket.on('leave_room', (_payload, cb) => {
    const room = manager.roomForSocket(socket.id);
    if (!room) return ack(cb, { ok: true });
    const code = room.code;
    room.removePlayer(socket.id);
    socket.leave(code);
    if (manager.getRoom(code)) io.to(code).emit('lobby_state', room.lobbyState());
    ack(cb, { ok: true });
  });

  socket.on('disconnect', (reason) => {
    const room = manager.roomForSocket(socket.id);
    console.log(`[disc] ${socket.id} (${reason})`);
    if (!room) return;

    if (room.status === 'lobby') {
      // Nothing in flight — just free the seat.
      const code = room.code;
      room.removePlayer(socket.id);
      if (manager.getRoom(code)) io.to(code).emit('lobby_state', room.lobbyState());
      return;
    }

    // Mid-match: hold the seat so a flaky connection can come back.
    room.markDisconnected(socket.id, (p) => {
      if (manager.getRoom(room.code)) {
        io.to(room.code).emit('player_left', { index: p.index, username: p.username });
        io.to(room.code).emit('lobby_state', room.lobbyState());
      }
    });
    io.to(room.code).emit('lobby_state', room.lobbyState());
  });
});

function publicSelf(player) {
  return {
    index: player.index,
    clientId: player.clientId,
    username: player.username,
    color: player.color,
    colorIndex: player.colorIndex,
    skinIndex: player.skinIndex,
  };
}

// ------------------------------------------------------------------ startup

// Applying the schema on boot means a fresh box needs no manual migration step;
// every statement is create-if-not-exists, so a restart is a no-op.
db.migrate().catch((err) => console.error('[db] migrate failed:', err.message));

httpServer.listen(PORT, HOST, () => {
  console.log(
    `snake server listening on ${HOST}:${PORT} ` +
      `(tick ${C.TICK_MS}ms, arena r=${C.WORLD_RADIUS}, bots→${C.BOT_TARGET_POPULATION})`
  );
});

function shutdown(sig) {
  console.log(`\n${sig} received, shutting down`);
  for (const room of manager.rooms.values()) room.stop();
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { io, httpServer, manager };
