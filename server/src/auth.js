'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const db = require('./db');

/**
 * Identity, self-hosted. Replaces Supabase Auth.
 *
 * Two ways to be somebody:
 *
 *   guest   — keyed on the install's clientId. No sign-in, no Google project,
 *             works offline-ish. Dies with the app.
 *   google  — keyed on Google's `sub` claim. Survives reinstall. The native SDK
 *             does the account picking and hands us an ID token; we verify it
 *             here rather than trusting anything the client says about itself.
 *
 * Either way the client ends up holding one of our own JWTs, which is what the
 * socket handshake checks. The Google ID token is never stored and never
 * re-sent — it is exchanged once.
 */

const TOKEN_TTL = process.env.AUTH_TOKEN_TTL || '30d';
const GOOGLE_WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || '').trim();

/**
 * A missing secret is survivable but not silent: tokens signed with an
 * ephemeral key stop verifying the moment the process restarts, which in
 * practice logs everybody out on every deploy. Fine for `npm run dev`, never
 * what you want in production.
 */
const SECRET = process.env.AUTH_JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_JWT_SECRET) {
  console.warn('[auth] AUTH_JWT_SECRET not set — using an ephemeral key; sessions die on restart.');
}

const googleClient = GOOGLE_WEB_CLIENT_ID ? new OAuth2Client(GOOGLE_WEB_CLIENT_ID) : null;
if (!googleClient) {
  console.warn('[auth] GOOGLE_WEB_CLIENT_ID not set — Google sign-in disabled, guests only.');
}

const googleEnabled = Boolean(googleClient);

function sanitizeName(name) {
  return String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 20) || 'Player';
}

// ------------------------------------------------------------------- tokens

function issueToken(player) {
  return jwt.sign(
    { sub: player.id, name: player.username, guest: !player.google_sub },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * Check a token from the socket handshake or an Authorization header.
 * Returns null for guests and bad tokens alike — a bad token means "not signed
 * in", never a dropped connection.
 *
 * @returns {{id: string, username: string|null, guest: boolean} | null}
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, SECRET);
    return { id: claims.sub, username: claims.name ?? null, guest: claims.guest !== false };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ sign-in

/** Find-or-create the player behind an install id. */
async function signInGuest(clientId, username) {
  const name = sanitizeName(username);
  if (!db.enabled) {
    // No database: hand back a deterministic id so the same install keeps the
    // same identity for as long as the process lives.
    const id = crypto.createHash('sha256').update(String(clientId)).digest('hex');
    return { id: `dev-${id.slice(0, 32)}`, username: name, google_sub: null };
  }

  const { rows } = await db.query(
    `insert into players (client_id, username)
          values ($1, $2)
     on conflict (client_id) do update
            set last_seen_at = now(),
                -- Keep the name the player is currently using, but never let a
                -- blank or defaulted one overwrite a real choice.
                username = case when $2 = 'Player' then players.username else $2 end
      returning *`,
    [clientId, name]
  );
  return rows[0] ?? null;
}

/**
 * Exchange a Google ID token for one of our players.
 *
 * Linking rules, in order:
 *   1. Seen this Google account before → that player, always.
 *   2. Otherwise upgrade this device's guest row in place, so the history and
 *      today's spent credits follow the player into the account rather than
 *      handing them a fresh allowance by signing in.
 *   3. Otherwise a brand new account-only player.
 */
async function signInGoogle(idToken, clientId, username) {
  const payload = await verifyGoogleIdToken(idToken);
  if (!payload) return { error: 'Google sign-in could not be verified.' };
  return linkGoogleAccount(payload, clientId, username);
}

/**
 * Check the ID token's signature and audience with Google's own keys. Split
 * from the linking below so that linking — where the account-merging rules
 * live — can be tested without minting real Google tokens.
 *
 * @returns {Promise<object|null>} the verified claims, or null
 */
async function verifyGoogleIdToken(idToken) {
  if (!googleClient) return null;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_WEB_CLIENT_ID });
    const payload = ticket.getPayload();
    return payload && payload.sub ? payload : null;
  } catch (err) {
    console.warn('[auth] google id token rejected:', err.message);
    return null;
  }
}

/**
 * Turn verified Google claims into one of our players.
 *
 * Rules, in order:
 *   1. Seen this Google account before → that player, always.
 *   2. Otherwise upgrade this device's guest row in place, so history and
 *      today's spent credits follow the player into the account rather than
 *      handing out a fresh allowance for signing in.
 *   3. Otherwise a brand new account-only player.
 */
async function linkGoogleAccount(payload, clientId, username) {
  const sub = payload.sub;
  const email = payload.email ?? null;
  const name = sanitizeName(username || payload.name || payload.email?.split('@')[0]);

  if (!db.enabled) {
    return { player: { id: `dev-google-${sub}`, username: name, google_sub: sub, email } };
  }

  const seen = await db.query('select * from players where google_sub = $1', [sub]);
  if (seen.rows[0]) {
    await db.query('update players set last_seen_at = now(), email = $2 where id = $1', [
      seen.rows[0].id,
      email,
    ]);
    return { player: { ...seen.rows[0], email } };
  }

  if (clientId) {
    const upgraded = await db.query(
      `update players
          set google_sub = $1, email = $2, username = $3, last_seen_at = now()
        where client_id = $4 and google_sub is null
      returning *`,
      [sub, email, name, clientId]
    );
    if (upgraded.rows[0]) return { player: upgraded.rows[0] };
  }

  const created = await db.query(
    `insert into players (google_sub, email, username) values ($1, $2, $3) returning *`,
    [sub, email, name]
  );
  return created.rows[0] ? { player: created.rows[0] } : { error: 'Could not create the account.' };
}

/** Rename a player. The JWT carries the name, so the caller gets a fresh one. */
async function setUsername(playerId, username) {
  const name = sanitizeName(username);
  if (!db.enabled) return { id: playerId, username: name, google_sub: null };
  const { rows } = await db.query(
    'update players set username = $2, last_seen_at = now() where id = $1 returning *',
    [playerId, name]
  );
  return rows[0] ?? null;
}

module.exports = {
  googleEnabled,
  verifyGoogleIdToken,
  linkGoogleAccount,
  sanitizeName,
  issueToken,
  verifyToken,
  signInGuest,
  signInGoogle,
  setUsername,
};
