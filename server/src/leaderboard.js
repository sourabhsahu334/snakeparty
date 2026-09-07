'use strict';

const db = require('./db');

/**
 * All-time leaderboards, one per mode.
 *
 * Two modes, two very different sources, and the difference matters:
 *
 *   multi — read out of `match_results`, which this server wrote while it was
 *           simulating the round. Server-authoritative: the score is what the
 *           arena actually awarded.
 *   solo  — read out of `solo_runs`, which the *client* posted after a run it
 *           simulated by itself. The server never saw it. `MAX_PLAUSIBLE_SCORE`
 *           throws out the obviously fabricated, and that is the whole of the
 *           defence. Treat this board as a personal-best tracker, not a
 *           competitive ranking.
 *
 * Both rank by a player's single best score rather than a sum, so someone who
 * plays all day does not out-rank someone who played one very good round.
 */

/**
 * Ceiling on an accepted solo score.
 *
 * Not a real anti-cheat — a determined client can post anything under it. It
 * exists so one obviously bogus submission cannot permanently sit at the top
 * of the board and make it useless to everyone else.
 */
const MAX_PLAUSIBLE_SCORE = 100_000;

const MODES = ['solo', 'multi'];

/** Bank one finished single-player run. Fire-and-forget, like recordMatch. */
async function recordSoloRun({ playerId, username, score, durationMs }) {
  if (!db.enabled || !playerId) return false;

  const s = Math.round(Number(score) || 0);
  if (!Number.isFinite(s) || s < 0 || s > MAX_PLAUSIBLE_SCORE) return false;

  try {
    await db.query(
      `insert into solo_runs (player_id, username, score, duration_ms)
            values ($1, $2, $3, $4)`,
      [playerId, username || 'Player', s, Math.round(Number(durationMs) || 0)]
    );
    return true;
  } catch (err) {
    console.error('[leaderboard] recordSoloRun failed:', err.message || err);
    return false;
  }
}

/**
 * Top `limit` players for a mode, best-score-first.
 *
 * Guests are included by name. In `multi` their result row has no player_id at
 * all (see the schema note), so those rows are grouped by username instead —
 * imperfect, but dropping them would hide most of a room's scoreboard.
 */
async function top(mode, limit = 25) {
  if (!db.enabled) return [];
  const n = Math.min(Math.max(Number(limit) || 25, 1), 100);

  if (mode === 'solo') {
    const { rows } = await db.query(
      `select p.id as player_id,
              coalesce(p.username, r.username) as username,
              max(r.score)   as score,
              count(*)::int  as runs,
              max(r.played_at) as last_at
         from solo_runs r
         join players p on p.id = r.player_id
        group by p.id, coalesce(p.username, r.username)
        order by score desc, last_at asc
        limit $1`,
      [n]
    );
    return rows;
  }

  const { rows } = await db.query(
    `select r.player_id,
            coalesce(p.username, r.username) as username,
            max(r.score)  as score,
            count(*)::int as runs,
            max(m.played_at) as last_at
       from match_results r
       join matches m on m.id = r.match_id
       left join players p on p.id = r.player_id
      group by r.player_id, coalesce(p.username, r.username)
      order by score desc, last_at asc
      limit $1`,
    [n]
  );
  return rows;
}

/**
 * One player's best and where it places, so the app can show "you" even when
 * they are nowhere near the top of the board.
 *
 * Rank is "how many players beat you, plus one" rather than a window function
 * over the whole table — the same answer, and it stays cheap as the table grows
 * because it never materialises the full ranking.
 */
async function standingFor(playerId, mode) {
  if (!db.enabled || !playerId) return null;

  if (mode === 'solo') {
    const { rows } = await db.query(
      `select max(score) as score, count(*)::int as runs
         from solo_runs where player_id = $1`,
      [playerId]
    );
    const best = rows[0] && rows[0].score;
    if (best === null || best === undefined) return null;

    const { rows: ahead } = await db.query(
      `select count(*)::int as n from (
         select player_id from solo_runs
          group by player_id having max(score) > $1
       ) t`,
      [best]
    );
    return { score: best, runs: rows[0].runs, rank: ahead[0].n + 1 };
  }

  const { rows } = await db.query(
    `select max(score) as score, count(*)::int as runs
       from match_results where player_id = $1`,
    [playerId]
  );
  const best = rows[0] && rows[0].score;
  if (best === null || best === undefined) return null;

  const { rows: ahead } = await db.query(
    `select count(*)::int as n from (
       select player_id from match_results
        where player_id is not null
        group by player_id having max(score) > $1
     ) t`,
    [best]
  );
  return { score: best, runs: rows[0].runs, rank: ahead[0].n + 1 };
}

module.exports = { recordSoloRun, top, standingFor, MODES, MAX_PLAUSIBLE_SCORE };
