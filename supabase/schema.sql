-- ============================================================================
--  Multiplayer Snake — Supabase schema
--  Run in the Supabase SQL editor, or: supabase db push
--
--  Note on writes: the game server talks to Postgres with the SERVICE ROLE key,
--  which bypasses RLS. There are deliberately NO insert/update policies for
--  normal users on matches / match_results, so a client cannot forge results.
--  The policies below are read-only.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (char_length(username) between 1 and 20),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Display name for each auth user (including anonymous ones).';

-- Give every new auth user a profile: anonymous sign-ins and Google accounts
-- alike. A username the player chose wins; Google only supplies full_name /
-- name, so those are the fallback before the email local part.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'username', ''),
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Player-' || substr(new.id::text, 1, 4)
      ),
      -- profiles.username is capped at 20 chars and a Google display name can
      -- be longer, so trim rather than fail the sign-up.
      20
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------- matches --

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  played_at     timestamptz not null default now(),
  winner_id     uuid references public.profiles (id) on delete set null,
  player_count  int  not null default 0,
  duration_ms   int  not null default 0
);

create index if not exists matches_played_at_idx on public.matches (played_at desc);
create index if not exists matches_room_code_idx on public.matches (room_code);

-- ----------------------------------------------------------- match_results --

create table if not exists public.match_results (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  -- Nullable: guests play without signing in, and we still want them on the
  -- scoreboard by name.
  player_id  uuid references public.profiles (id) on delete set null,
  username   text not null default 'Player',
  score      int  not null default 0,
  placement  int  not null default 0,
  unique (match_id, player_id)
);

create index if not exists match_results_match_idx  on public.match_results (match_id);
create index if not exists match_results_player_idx on public.match_results (player_id);

-- ------------------------------------------------------------------- RLS ----

alter table public.profiles      enable row level security;
alter table public.matches       enable row level security;
alter table public.match_results enable row level security;

-- Usernames are public inside the game (they show up in lobbies and results).
drop policy if exists "profiles are readable by signed-in users" on public.profiles;
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- SECURITY DEFINER so the policy on match_results can ask "was I in this
-- match?" without recursively re-evaluating match_results' own RLS.
create or replace function public.participated_in(p_match uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.match_results mr
    where mr.match_id = p_match
      and mr.player_id = auth.uid()
  );
$$;

revoke all on function public.participated_in(uuid) from public;
grant execute on function public.participated_in(uuid) to authenticated;

drop policy if exists "read matches you played in" on public.matches;
create policy "read matches you played in"
  on public.matches for select
  to authenticated
  using (public.participated_in(id));

-- You can see every scoreboard row of a match you were in — that is the point
-- of a friend lobby — but nothing from matches you did not play.
drop policy if exists "read results of matches you played in" on public.match_results;
create policy "read results of matches you played in"
  on public.match_results for select
  to authenticated
  using (public.participated_in(match_id));

-- --------------------------------------------------------- history helpers --

-- Your own match history, newest first.
create or replace view public.my_match_history
with (security_invoker = true) as
  select
    m.id as match_id,
    m.room_code,
    m.played_at,
    m.player_count,
    m.duration_ms,
    r.score,
    r.placement,
    (m.winner_id is not distinct from auth.uid()) as won
  from public.matches m
  join public.match_results r on r.match_id = m.id
  where r.player_id = auth.uid();

grant select on public.my_match_history to authenticated;

-- Leaderboard across the matches you have played — i.e. your friend group,
-- not a global ranking.
create or replace function public.my_leaderboard()
returns table (
  player_id     uuid,
  username      text,
  matches       bigint,
  wins          bigint,
  total_score   bigint,
  best_score    int,
  avg_placement numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select match_id from public.match_results where player_id = auth.uid()
  )
  select
    r.player_id,
    max(r.username)                              as username,
    count(*)                                     as matches,
    count(*) filter (where r.placement = 1)      as wins,
    sum(r.score)::bigint                         as total_score,
    max(r.score)                                 as best_score,
    round(avg(r.placement), 2)                   as avg_placement
  from public.match_results r
  join mine on mine.match_id = r.match_id
  group by r.player_id
  order by wins desc, total_score desc;
$$;

revoke all on function public.my_leaderboard() from public;
grant execute on function public.my_leaderboard() to authenticated;
