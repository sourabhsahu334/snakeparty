'use strict';

/**
 * Leaderboards, against a real Postgres.
 *
 * Same reasoning as credits.test.js: the risk in leaderboard.js is entirely in
 * the SQL — the grouping, the "best score per player" rule, and the rank
 * arithmetic — so it runs against db/schema.sql under PGlite rather than a
 * mocked query layer that would only prove the JavaScript is shaped right.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PGlite } = require('@electric-sql/pglite');

const db = require('../src/db');
const auth = require('../src/auth');
const matches = require('../src/matches');
const leaderboard = require('../src/leaderboard');

let pg;

test.before(async () => {
  pg = await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

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

const guest = (clientId, name) => auth.signInGuest(clientId, name);

// --------------------------------------------------------------------- solo

test('a solo board ranks players by their best run, not their total', async () => {
  const grinder = await guest('solo-grinder', 'Grinder');
  const oneShot = await guest('solo-oneshot', 'OneShot');

  // Four mediocre runs against a single great one. Summing would put Grinder
  // on top with 400; best-of puts OneShot there with 300, which is the point.
  for (const s of [100, 100, 100, 100]) {
    await leaderboard.recordSoloRun({ playerId: grinder.id, username: 'Grinder', score: s });
  }
  await leaderboard.recordSoloRun({ playerId: oneShot.id, username: 'OneShot', score: 300 });

  const top = await leaderboard.top('solo', 10);
  assert.strictEqual(top[0].username, 'OneShot');
  assert.strictEqual(Number(top[0].score), 300);
  assert.strictEqual(Number(top[1].score), 100);
  assert.strictEqual(top[1].runs, 4, 'run count still reflects every attempt');
});

test('a player appears on the solo board once, however much they play', async () => {
  const p = await guest('solo-repeat', 'Repeat');
  for (const s of [10, 20, 30]) {
    await leaderboard.recordSoloRun({ playerId: p.id, username: 'Repeat', score: s });
  }
  const rows = (await leaderboard.top('solo', 100)).filter((r) => r.username === 'Repeat');
  assert.strictEqual(rows.length, 1, 'one row per player');
  assert.strictEqual(Number(rows[0].score), 30);
});

test('an impossible solo score is refused rather than stored', async () => {
  const p = await guest('solo-cheat', 'Cheater');
  const ok = await leaderboard.recordSoloRun({
    playerId: p.id,
    username: 'Cheater',
    score: leaderboard.MAX_PLAUSIBLE_SCORE + 1,
  });
  assert.strictEqual(ok, false, 'submission rejected');

  const rows = (await leaderboard.top('solo', 100)).filter((r) => r.username === 'Cheater');
  assert.strictEqual(rows.length, 0, 'nothing was written');
});

test('a negative solo score is refused', async () => {
  const p = await guest('solo-negative', 'Negative');
  assert.strictEqual(
    await leaderboard.recordSoloRun({ playerId: p.id, username: 'Negative', score: -5 }),
    false
  );
});

test('your standing knows your best and how many players beat it', async () => {
  const me = await guest('solo-standing', 'Standing');
  await leaderboard.recordSoloRun({ playerId: me.id, username: 'Standing', score: 150 });

  const s = await leaderboard.standingFor(me.id, 'solo');
  const board = await leaderboard.top('solo', 100);
  const ahead = board.filter((r) => Number(r.score) > 150).length;

  assert.strictEqual(Number(s.score), 150);
  assert.strictEqual(s.rank, ahead + 1, 'rank is everyone above you, plus one');
});

test('a player who has never played solo has no standing', async () => {
  const p = await guest('solo-never', 'Never');
  assert.strictEqual(await leaderboard.standingFor(p.id, 'solo'), null);
});

// -------------------------------------------------------------- multiplayer

test('the multiplayer board is built from recorded matches', async () => {
  const a = await guest('multi-a', 'Ava');
  const b = await guest('multi-b', 'Ben');

  await matches.recordMatch({
    roomCode: 'AAAAA',
    durationMs: 60_000,
    winner: { userId: a.id },
    results: [
      { userId: a.id, username: 'Ava', score: 420, placement: 1 },
      { userId: b.id, username: 'Ben', score: 210, placement: 2 },
    ],
  });

  const top = await leaderboard.top('multi', 10);
  assert.strictEqual(top[0].username, 'Ava');
  assert.strictEqual(Number(top[0].score), 420);
  assert.strictEqual(Number(top[1].score), 210);
});

test('multiplayer ranks on the best round, and counts the rest', async () => {
  const p = await guest('multi-repeat', 'Streak');
  for (const score of [50, 900, 120]) {
    await matches.recordMatch({
      roomCode: 'BBBBB',
      durationMs: 1000,
      winner: null,
      results: [{ userId: p.id, username: 'Streak', score, placement: 1 }],
    });
  }

  const row = (await leaderboard.top('multi', 100)).find((r) => r.username === 'Streak');
  assert.strictEqual(Number(row.score), 900);
  assert.strictEqual(row.runs, 3);
});

test('a guest with no player row still reaches the multiplayer board by name', async () => {
  await matches.recordMatch({
    roomCode: 'CCCCC',
    durationMs: 1000,
    winner: null,
    // player_id null is what the schema stores for someone who never signed in.
    results: [{ userId: null, username: 'Passerby', score: 77, placement: 1 }],
  });

  const row = (await leaderboard.top('multi', 100)).find((r) => r.username === 'Passerby');
  assert.ok(row, 'anonymous scoreboard entries are not silently dropped');
  assert.strictEqual(Number(row.score), 77);
});

test('the two boards are separate — a solo run never reaches multiplayer', async () => {
  const p = await guest('cross-mode', 'Crosser');
  await leaderboard.recordSoloRun({ playerId: p.id, username: 'Crosser', score: 999 });

  const multi = (await leaderboard.top('multi', 100)).filter((r) => r.username === 'Crosser');
  assert.strictEqual(multi.length, 0, 'solo scores stay out of the multiplayer board');

  const solo = (await leaderboard.top('solo', 100)).filter((r) => r.username === 'Crosser');
  assert.strictEqual(solo.length, 1);
});

test('the board honours its limit', async () => {
  const rows = await leaderboard.top('solo', 2);
  assert.ok(rows.length <= 2, `asked for 2, got ${rows.length}`);
});
