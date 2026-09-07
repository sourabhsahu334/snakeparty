-- ============================================================================
--  Snake Party — Postgres schema (self-hosted, replaces Supabase)
--
--  Runs on the same OCI box as the game server. There is no RLS here and no
--  per-user database role: the game server is the only client, it connects as
--  one owner role, and every read the app performs goes through an HTTP
--  endpoint that scopes by the caller's JWT. That is why the Supabase policy
--  layer has no equivalent below — it protected a direct-from-client
--  connection that no longer exists.
-- ============================================================================

-- gen_random_uuid() is core Postgres since 13, so there is no pgcrypto
-- extension to install — which also means this schema runs unmodified under
-- PGlite, and test/credits.test.js exercises the real SQL rather than a mock.

-- ----------------------------------------------------------------- players --

-- One row per human. Two ways in, and a player can hold both at once:
--
--   client_id  — the install's stable random id. Costs nothing, needs no
--                sign-in, and dies when the app is uninstalled.
--   google_sub — Google's immutable subject claim. Survives reinstall, which
--                is the entire reason Google sign-in exists here.
--
-- Signing in with Google on a device that already has a guest row upgrades
-- that row in place (see linkGoogle in src/auth.js) so the guest's history and
-- today's spent credits follow the player into the account instead of handing
-- them a fresh allowance.
create table if not exists players (
  id           uuid primary key default gen_random_uuid(),
  client_id    text unique,
  google_sub   text unique,
  username     text not null check (char_length(username) between 1 and 20),
  email        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Daily free-room allowance. Stored as "which day was this counter for"
  -- rather than a timestamp so the reset is a date comparison, not arithmetic
  -- on an interval — see src/credits.js for why the day is computed in a
  -- configured timezone rather than UTC.
  credits_day  date not null default current_date,
  credits_used int  not null default 0 check (credits_used >= 0),

  -- At least one identity, or the row is unreachable.
  constraint players_have_an_identity check (client_id is not null or google_sub is not null)
);

create index if not exists players_google_sub_idx on players (google_sub) where google_sub is not null;
create index if not exists players_client_id_idx  on players (client_id)  where client_id  is not null;

-- ----------------------------------------------------------------- matches --

create table if not exists matches (
  id           uuid primary key default gen_random_uuid(),
  room_code    text not null,
  played_at    timestamptz not null default now(),
  winner_id    uuid references players (id) on delete set null,
  player_count int not null default 0,
  duration_ms  int not null default 0
);

create index if not exists matches_played_at_idx on matches (played_at desc);
create index if not exists matches_room_code_idx on matches (room_code);

-- ------------------------------------------------------------ match_results --

create table if not exists match_results (
  id        uuid primary key default gen_random_uuid(),
  match_id  uuid not null references matches (id) on delete cascade,
  -- Nullable: guests who never signed in still belong on the scoreboard, by
  -- name. Their row simply has no player to attach to.
  player_id uuid references players (id) on delete set null,
  username  text not null default 'Player',
  score     int not null default 0,
  placement int not null default 0,
  unique (match_id, player_id)
);

create index if not exists match_results_match_idx  on match_results (match_id);
create index if not exists match_results_player_idx on match_results (player_id);

-- --------------------------------------------------------------- solo_runs --

-- Single-player runs. Multiplayer already lands in match_results, but a solo
-- run never reaches the game loop on this server at all — it is simulated
-- entirely on the device — so there is nowhere else for its score to live.
--
-- IMPORTANT: a row here is a *claim*, not an observation. The server did not
-- watch this run and cannot verify it; the endpoint only rejects scores that
-- are outright impossible. Multiplayer scores in match_results are
-- server-authoritative and are the only ones that carry real weight.
create table if not exists solo_runs (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players (id) on delete cascade,
  username   text not null default 'Player',
  score      int  not null default 0 check (score >= 0),
  duration_ms int not null default 0,
  played_at  timestamptz not null default now()
);

-- The leaderboard reads "best score per player", so lead with the player.
create index if not exists solo_runs_player_idx on solo_runs (player_id, score desc);
create index if not exists solo_runs_score_idx  on solo_runs (score desc);
