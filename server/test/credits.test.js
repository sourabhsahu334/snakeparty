'use strict';

/**
 * Credits, identity and match recording, against a real Postgres.
 *
 * PGlite is Postgres compiled to wasm, so db/schema.sql and every statement in
 * credits.js / auth.js / matches.js run here exactly as they will on the box —
 * constraints, `on conflict`, date arithmetic and all. A mocked query layer
 * would have proved only that the JavaScript is shaped right, which is not
 * where the risk is.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PGlite } = require('@electric-sql/pglite');

process.env.FREE_ROOMS_PER_DAY = '2';
process.env.CREDITS_TIMEZONE = 'Asia/Kolkata';

const db = require('../src/db');
const credits = require('../src/credits');
const auth = require('../src/auth');
const matches = require('../src/matches');

let pg;

test.before(async () => {
  pg = await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

  // Point the db module at PGlite. The modules under test read db.enabled and
  // db.query at call time, so replacing them here is enough.
  db.enabled = true;
  db.query = async (text, params) => pg.query(text, params);
  db.transaction = async (fn) => {
    await pg.query('BEGIN');
    try {
      const out = await fn({ query: (t, p) => pg.query(t, p) });
      await pg.query('COMMIT');
      return out;
    } catch (err) {
      await pg.query('ROLLBACK');
      throw err;
    }
  };
});

async function freshGuest(clientId, name = 'Tester') {
  const player = await auth.signInGuest(clientId, name);
  assert.ok(player && player.id, 'guest sign-in returned a player');
  return player;
}

// --------------------------------------------------------------- identity --

test('a guest is created once and reused on every later sign-in', async () => {
  const first = await freshGuest('install-a', 'Ana');
  const again = await auth.signInGuest('install-a', 'Ana');
  assert.equal(again.id, first.id, 'same install id means the same player row');

  const { rows } = await pg.query('select count(*)::int as n from players where client_id = $1', [
    'install-a',
  ]);
  assert.equal(rows[0].n, 1, 'no duplicate row');
});

test('a player must have at least one identity', async () => {
  await assert.rejects(
    () => pg.query("insert into players (username) values ('Nobody')"),
    /players_have_an_identity/,
    'a row with neither client_id nor google_sub is rejected'
  );
});

test('signing in with Google upgrades the guest row instead of forking it', async () => {
  const guest = await freshGuest('install-b', 'Bo');
  await credits.spend(guest.id); // burn one before linking

  const { player } = await auth.linkGoogleAccount(
    { sub: 'google-123', email: 'bo@example.com', name: 'Bo Real' },
    'install-b',
    null
  );

  assert.equal(player.id, guest.id, 'same row, upgraded in place');
  assert.equal(player.google_sub, 'google-123');
  assert.equal(player.client_id, 'install-b', 'the install id stays attached');

  // The point of upgrading rather than creating: signing in is not a way to
  // refill the day's allowance.
  const left = await credits.remaining(player.id);
  assert.equal(left.remaining, 1, 'the credit spent as a guest still counts');
});

test('a returning Google account resolves to the same player from any device', async () => {
  const { player: onNewDevice } = await auth.linkGoogleAccount(
    { sub: 'google-123', email: 'bo@example.com', name: 'Bo Real' },
    'a-different-install',
    null
  );
  const { rows } = await pg.query('select id from players where google_sub = $1', ['google-123']);
  assert.equal(rows.length, 1, 'still exactly one row for this Google account');
  assert.equal(onNewDevice.id, rows[0].id);
});

// ---------------------------------------------------------------- credits --

test('two free rooms a day, and the third is refused', async () => {
  const p = await freshGuest('install-c', 'Cy');

  const one = await credits.spend(p.id);
  assert.equal(one.ok, true);
  assert.equal(one.remaining, 1);

  const two = await credits.spend(p.id);
  assert.equal(two.ok, true);
  assert.equal(two.remaining, 0);

  const three = await credits.spend(p.id);
  assert.equal(three.ok, false, 'the third room is refused');
  assert.ok(three.resetsAt, 'and the client is told when it resets');
});

test('the allowance comes back the next day', async () => {
  const p = await freshGuest('install-d', 'Dee');
  await credits.spend(p.id);
  await credits.spend(p.id);
  assert.equal((await credits.spend(p.id)).ok, false, 'spent out today');

  // Pretend the counter was set yesterday rather than waiting a day.
  await pg.query(
    "update players set credits_day = credits_day - interval '1 day' where id = $1",
    [p.id]
  );

  const afterMidnight = await credits.spend(p.id);
  assert.equal(afterMidnight.ok, true, 'a stale day resets the counter');
  assert.equal(afterMidnight.remaining, 1, 'and it resets to a full allowance, not a partial one');
});

test('the limit is enforced by the statement, not by a read-then-write', async () => {
  // The guard lives in the UPDATE's WHERE clause, so two racing spends cannot
  // both observe "1 used" and both write "2 used". Fired together here; under
  // PGlite they serialize on one connection, which still proves the guard is
  // what refuses the extra room rather than a check in JavaScript.
  const p = await freshGuest('install-e', 'Eve');
  const results = await Promise.all([
    credits.spend(p.id),
    credits.spend(p.id),
    credits.spend(p.id),
    credits.spend(p.id),
  ]);
  const granted = results.filter((r) => r.ok).length;
  assert.equal(granted, 2, 'exactly the daily allowance was handed out');

  const { rows } = await pg.query('select credits_used from players where id = $1', [p.id]);
  assert.equal(rows[0].credits_used, 2, 'and the counter matches what was granted');
});

test('a refund returns a credit but never goes negative', async () => {
  const p = await freshGuest('install-f', 'Fin');
  await credits.spend(p.id);
  await credits.refund(p.id);
  assert.equal((await credits.remaining(p.id)).remaining, 2, 'back to a full day');

  await credits.refund(p.id);
  await credits.refund(p.id);
  const { rows } = await pg.query('select credits_used from players where id = $1', [p.id]);
  assert.equal(rows[0].credits_used, 0, 'refunding past zero is a no-op');
});

test('joining is free — only the host is charged', async () => {
  // There is no spend() on the join path at all; this asserts the invariant
  // that a player who never hosts keeps a full allowance no matter what.
  const guest = await freshGuest('install-g', 'Gus');
  assert.equal((await credits.remaining(guest.id)).remaining, 2);
});

// ---------------------------------------------------------------- matches --

test('a finished round is recorded with its scoreboard', async () => {
  const a = await freshGuest('install-h', 'Ha');
  const b = await freshGuest('install-i', 'Ib');

  const id = await matches.recordMatch({
    roomCode: 'ABCDE',
    durationMs: 61_000,
    winner: { userId: a.id },
    results: [
      { userId: a.id, username: 'Ha', score: 120, placement: 1 },
      { userId: b.id, username: 'Ib', score: 80, placement: 2 },
      // A guest who never signed in still belongs on the scoreboard.
      { userId: null, username: 'Randomer', score: 10, placement: 3 },
    ],
  });
  assert.ok(id, 'a match id came back');

  const history = await matches.historyFor(a.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].room_code, 'ABCDE');
  assert.equal(history[0].score, 120);
  assert.equal(history[0].won, true, 'the winner is flagged');

  const loser = await matches.historyFor(b.id);
  assert.equal(loser[0].won, false, 'and everyone else is not');

  const { rows } = await pg.query('select count(*)::int as n from match_results where match_id=$1', [
    id,
  ]);
  assert.equal(rows[0].n, 3, 'the anonymous player was recorded too');
});

test('a match with no results is not written at all', async () => {
  const before = await pg.query('select count(*)::int as n from matches');
  assert.equal(await matches.recordMatch({ roomCode: 'ZZZZZ', results: [] }), null);
  const after = await pg.query('select count(*)::int as n from matches');
  assert.equal(after.rows[0].n, before.rows[0].n, 'no empty match row left behind');
});

// ------------------------------------------------------------------ tokens --

test('a token round-trips, and a tampered one does not', async () => {
  const p = await freshGuest('install-j', 'Jo');
  const token = auth.issueToken(p);

  const claims = auth.verifyToken(token);
  assert.equal(claims.id, p.id);
  assert.equal(claims.username, 'Jo');
  assert.equal(claims.guest, true, 'no google_sub means guest');

  assert.equal(auth.verifyToken(token.slice(0, -2) + 'xy'), null, 'a bad signature is rejected');
  assert.equal(auth.verifyToken('not-a-jwt'), null);
  assert.equal(auth.verifyToken(null), null);
});

test('a linked account is not a guest', async () => {
  const { player } = await auth.linkGoogleAccount(
    { sub: 'google-456', email: 'k@example.com', name: 'Kay' },
    null,
    null
  );
  assert.equal(auth.verifyToken(auth.issueToken(player)).guest, false);
});
