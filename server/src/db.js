'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Postgres, running beside the game server on the same box.
 *
 * Kept out of the gameplay hot path exactly as Supabase was: this module is
 * touched on sign-in, on room creation (credits), and at game over. The 20Hz
 * tick loop never awaits a query.
 *
 * With DATABASE_URL unset the whole module degrades to a no-op and the server
 * still runs — the game is playable, credits are unlimited, and no history is
 * written. That keeps `npm run dev` working without a database, which the test
 * suite depends on.
 */
const URL = process.env.DATABASE_URL;
const enabled = Boolean(URL);

if (!enabled) {
  console.warn('[db] DATABASE_URL not set — no history, no credit limit (dev mode).');
}

const pool = enabled
  ? new Pool({
      connectionString: URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

// An idle client erroring out (a restarted database, say) must not take the
// process down — the pool discards it and the next query gets a fresh one.
if (pool) pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/**
 * Every caller is on a path that must not break the game, so a failed query is
 * logged and reported as "no rows" rather than thrown. Callers decide what
 * absence means; none of them treat it as fatal.
 */
async function query(text, params) {
  if (!pool) return { rows: [], rowCount: 0 };
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('[db] query failed:', err.message);
    return { rows: [], rowCount: 0 };
  }
}

/**
 * Run several statements as one transaction. Used only where a partial write
 * would be worse than none — recording a match, and spending a credit.
 *
 * Unlike query() this rethrows, because a caller asking for a transaction is
 * asking to know whether it committed.
 */
async function transaction(fn) {
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Apply db/schema.sql. Idempotent — every statement is create-if-not-exists. */
async function migrate() {
  if (!pool) return false;
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema applied');
  return true;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { enabled, pool, query, transaction, migrate, close };
