'use strict';

const auth = require('./auth');
const credits = require('./credits');
const matches = require('./matches');
const db = require('./db');

/**
 * The small HTTP surface that replaced Supabase.
 *
 * The app used to talk to two hosts: Supabase for identity, this server for the
 * game. Now there is one. Everything here is off the gameplay path — it runs
 * at sign-in and when the lobby wants a credit count, never during a round.
 *
 * Deliberately hand-rolled rather than pulling in Express: five routes, no
 * middleware, and the socket.io server already owns the http server.
 */

const MAX_BODY = 16 * 1024;
const ORIGIN = process.env.CORS_ORIGIN || '*';

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ORIGIN,
  });
  res.end(body);
}

/** Read a JSON body, refusing anything oversized rather than buffering it. */
function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      raw += chunk;
      if (raw.length > MAX_BODY) {
        tooBig = true;
        raw = '';
      }
    });
    req.on('end', () => {
      if (tooBig) return resolve(null);
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Everything a client needs to render the lobby for a freshly signed-in player. */
async function sessionPayload(player) {
  return {
    token: auth.issueToken(player),
    player: {
      id: player.id,
      username: player.username,
      email: player.email ?? null,
      isGuest: !player.google_sub,
    },
    credits: await credits.remaining(player.id),
  };
}

/**
 * @returns {Promise<boolean>} true when the request was handled here.
 */
async function handle(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  if (path === '/health' || path === '/') {
    send(res, 200, {
      ok: true,
      rooms: ctx.rooms(),
      db: db.enabled,
      google: auth.googleEnabled,
      freeRoomsPerDay: credits.PER_DAY,
      uptime: Math.round(process.uptime()),
    });
    return true;
  }

  // ------------------------------------------------------------------ auth

  if (path === '/auth/guest' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body || !body.clientId) return send(res, 400, { error: 'MISSING_CLIENT_ID' }), true;
    const player = await auth.signInGuest(String(body.clientId).slice(0, 64), body.username);
    if (!player) return send(res, 500, { error: 'SIGN_IN_FAILED' }), true;
    send(res, 200, await sessionPayload(player));
    return true;
  }

  if (path === '/auth/google' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body || !body.idToken) return send(res, 400, { error: 'MISSING_ID_TOKEN' }), true;
    const out = await auth.signInGoogle(
      body.idToken,
      body.clientId ? String(body.clientId).slice(0, 64) : null,
      body.username
    );
    if (out.error) return send(res, 401, { error: out.error }), true;
    send(res, 200, await sessionPayload(out.player));
    return true;
  }

  // ------------------------------------------------------------------- me

  if (path === '/me/username' && req.method === 'POST') {
    const claims = auth.verifyToken(bearer(req));
    if (!claims) return send(res, 401, { error: 'UNAUTHORIZED' }), true;
    const body = await readJson(req);
    const player = await auth.setUsername(claims.id, body && body.username);
    if (!player) return send(res, 404, { error: 'NO_SUCH_PLAYER' }), true;
    // The name lives in the token, so renaming has to mint a new one.
    send(res, 200, await sessionPayload(player));
    return true;
  }

  if (path === '/me/credits' && req.method === 'GET') {
    const claims = auth.verifyToken(bearer(req));
    if (!claims) return send(res, 401, { error: 'UNAUTHORIZED' }), true;
    send(res, 200, await credits.remaining(claims.id));
    return true;
  }

  if (path === '/me/history' && req.method === 'GET') {
    const claims = auth.verifyToken(bearer(req));
    if (!claims) return send(res, 401, { error: 'UNAUTHORIZED' }), true;
    send(res, 200, { matches: await matches.historyFor(claims.id, url.searchParams.get('limit')) });
    return true;
  }

  return false;
}

module.exports = { handle };
