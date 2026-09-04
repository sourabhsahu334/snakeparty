'use strict';

const db = require('./db');

/**
 * Daily free room credits.
 *
 * Hosting a room costs one credit; joining one costs nothing. That split is
 * the whole point — a player who is out of credits can still play all day if a
 * friend hosts, so nobody is ever locked out of seeing what the game is. It
 * caps how many lobbies one person can spin up, not how much they can play.
 *
 * Solo practice is free too (it never creates a room).
 */

const PER_DAY = Number(process.env.FREE_ROOMS_PER_DAY || 2);

/**
 * Resetting "at midnight" is meaningless without saying whose midnight. The
 * server runs in UTC, the players are not, and a UTC reset would land in the
 * middle of an Indian evening — mid-session, which is the one moment it must
 * not. So the day boundary is computed in a real timezone.
 */
const TZ = process.env.CREDITS_TIMEZONE || 'Asia/Kolkata';

/** Today's date in TZ as YYYY-MM-DD — the value stored in players.credits_day. */
function today(now = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is exactly Postgres' date literal.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Spend one credit, if there is one.
 *
 * The reset and the decrement are a single statement on purpose: two players
 * (or two taps) racing on the same row would otherwise both read "1 used" and
 * both write "2 used", handing out a third room. Here the WHERE clause is the
 * limit check, so Postgres' row lock serializes them and the loser matches no
 * row.
 *
 * @returns {Promise<{ok: true, used: number, remaining: number}
 *                 | {ok: false, remaining: 0, resetsAt: string}>}
 */
async function spend(playerId) {
  if (!db.enabled || !playerId) {
    // No database means no durable counter to enforce against; the game stays
    // playable rather than refusing every room.
    return { ok: true, used: 0, remaining: PER_DAY };
  }

  const day = today();
  const { rows } = await db.query(
    `update players
        set credits_day  = $2::date,
            credits_used = case when credits_day = $2::date then credits_used + 1 else 1 end
      where id = $1
        and (credits_day <> $2::date or credits_used < $3)
  returning credits_used`,
    [playerId, day, PER_DAY]
  );

  if (!rows[0]) return { ok: false, remaining: 0, resetsAt: nextReset() };
  const used = rows[0].credits_used;
  return { ok: true, used, remaining: Math.max(0, PER_DAY - used) };
}

/** Give a credit back — used only when room creation fails after spending. */
async function refund(playerId) {
  if (!db.enabled || !playerId) return;
  await db.query(
    `update players
        set credits_used = greatest(0, credits_used - 1)
      where id = $1 and credits_day = $2::date`,
    [playerId, today()]
  );
}

/** Read-only: what the player has left today, for the lobby UI. */
async function remaining(playerId) {
  if (!db.enabled || !playerId) return { remaining: PER_DAY, perDay: PER_DAY, resetsAt: nextReset() };
  const { rows } = await db.query(
    `select case when credits_day = $2::date then credits_used else 0 end as used
       from players where id = $1`,
    [playerId, today()]
  );
  const used = rows[0] ? Number(rows[0].used) : 0;
  return { remaining: Math.max(0, PER_DAY - used), perDay: PER_DAY, resetsAt: nextReset() };
}

/** ISO instant of the next TZ-midnight, so the client can say "resets in 4h". */
function nextReset(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // formatToParts renders midnight as hour 24 in some ICU versions.
  const secondsIntoDay = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return new Date(now.getTime() + (86_400 - secondsIntoDay) * 1000).toISOString();
}

module.exports = { PER_DAY, TZ, today, spend, refund, remaining, nextReset };
