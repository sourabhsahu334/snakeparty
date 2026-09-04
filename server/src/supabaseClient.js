'use strict';

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Supabase is deliberately kept out of the gameplay hot path: this module is
 * only touched on connect (token check) and at game over (writing results).
 *
 * If the env vars are missing the server still runs fully — auth degrades to
 * guest-only and match history is skipped — so you can develop the game loop
 * without a Supabase project.
 */
const enabled = Boolean(URL && SERVICE_KEY);

if (!enabled) {
  console.warn(
    '[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — running in guest-only mode (no match history).'
  );
}

const supabase = enabled
  ? createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

/**
 * Validate a Supabase access token handed over in the socket handshake.
 * Returns null for guests / bad tokens — a bad token never throws the
 * connection away, it just means "not signed in".
 *
 * @returns {Promise<{id: string, username: string} | null>}
 */
async function verifyToken(accessToken) {
  if (!enabled || !accessToken) return null;
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data || !data.user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', data.user.id)
      .maybeSingle();

    const meta = data.user.user_metadata || {};
    return {
      id: data.user.id,
      username:
        (profile && profile.username) ||
        meta.username ||
        // Google supplies these two rather than `username`.
        meta.full_name ||
        meta.name ||
        data.user.email?.split('@')[0] ||
        null,
    };
  } catch (err) {
    console.error('[supabase] verifyToken failed', err.message);
    return null;
  }
}

/**
 * Persist one finished round. Fire-and-forget from the caller's perspective —
 * a Supabase outage must never break a game that already finished.
 *
 * @param {{roomCode: string, durationMs: number, winner: object|null, results: Array}} payload
 */
async function recordMatch(payload) {
  if (!enabled) return null;
  try {
    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .insert({
        room_code: payload.roomCode,
        winner_id: payload.winner ? payload.winner.userId : null,
        player_count: payload.results.length,
        duration_ms: payload.durationMs,
      })
      .select('id')
      .single();

    if (matchErr) throw matchErr;

    const rows = payload.results.map((r) => ({
      match_id: match.id,
      player_id: r.userId,
      username: r.username,
      score: r.score,
      placement: r.placement,
    }));

    const { error: resultsErr } = await supabase.from('match_results').insert(rows);
    if (resultsErr) throw resultsErr;

    return match.id;
  } catch (err) {
    console.error('[supabase] recordMatch failed', err.message || err);
    return null;
  }
}

module.exports = { supabase, enabled, verifyToken, recordMatch };
