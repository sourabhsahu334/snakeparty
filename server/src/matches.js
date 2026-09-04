'use strict';

const db = require('./db');

/**
 * Persist one finished round.
 *
 * Fire-and-forget from the caller: the round is already over and the result is
 * already on every player's screen, so a database problem here must never
 * surface. It is a transaction because half a match — a row in `matches` with
 * no scoreboard under it — is worse than no match at all.
 *
 * @param {{roomCode: string, durationMs: number, winner: object|null, results: Array}} payload
 * @returns {Promise<string|null>} the match id, or null if nothing was written
 */
async function recordMatch(payload) {
  if (!db.enabled) return null;
  if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) return null;

  try {
    return await db.transaction(async (client) => {
      const { rows } = await client.query(
        `insert into matches (room_code, winner_id, player_count, duration_ms)
              values ($1, $2, $3, $4)
           returning id`,
        [
          payload.roomCode,
          payload.winner ? payload.winner.userId || null : null,
          payload.results.length,
          Math.round(payload.durationMs || 0),
        ]
      );
      const matchId = rows[0].id;

      for (const r of payload.results) {
        await client.query(
          `insert into match_results (match_id, player_id, username, score, placement)
                values ($1, $2, $3, $4, $5)
           on conflict (match_id, player_id) do nothing`,
          [matchId, r.userId || null, r.username || 'Player', r.score || 0, r.placement || 0]
        );
      }

      return matchId;
    });
  } catch (err) {
    console.error('[matches] recordMatch failed:', err.message || err);
    return null;
  }
}

/** A player's own history, newest first. Replaces the my_match_history view. */
async function historyFor(playerId, limit = 20) {
  if (!db.enabled || !playerId) return [];
  const { rows } = await db.query(
    `select m.id as match_id, m.room_code, m.played_at, m.player_count, m.duration_ms,
            r.score, r.placement, (m.winner_id = $1) as won
       from match_results r
       join matches m on m.id = r.match_id
      where r.player_id = $1
      order by m.played_at desc
      limit $2`,
    [playerId, Math.min(Number(limit) || 20, 100)]
  );
  return rows;
}

module.exports = { recordMatch, historyFor };
