import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createClient,
  type Session as AuthSession,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_ENABLED, SUPABASE_URL } from './env';
import { signInWithGoogle, signOutFromGoogle } from './google';

/**
 * Auth + match history only. Nothing in here is called during gameplay — the
 * game socket is the only thing running once a round starts.
 *
 * If the env vars are absent the app still works end to end as a guest; you
 * just don't get a persisted match history.
 */
export const supabase: SupabaseClient | null = SUPABASE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // No URL-based auth callbacks on native.
        detectSessionInUrl: false,
      },
    })
  : null;

export type Session = {
  accessToken: string;
  userId: string;
  username: string | null;
  email: string | null;
  /** Anonymous sign-in: playable, but the history dies with the install. */
  isGuest: boolean;
};

/**
 * A username the player picked always wins; Google's `full_name` / `name` is
 * the fallback for accounts that never set one.
 */
function displayName(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (meta.username as string | undefined) ||
    (meta.full_name as string | undefined) ||
    (meta.name as string | undefined) ||
    user.email?.split('@')[0] ||
    null
  );
}

function toSession(session: AuthSession): Session {
  return {
    accessToken: session.access_token,
    userId: session.user.id,
    username: displayName(session.user),
    email: session.user.email ?? null,
    isGuest: session.user.is_anonymous === true,
  };
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return toSession(data.session);
}

/** Anonymous sign-in — enough for a friends-only lobby. */
export async function signInAnonymously(username: string): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { username } },
  });
  if (error || !data.session) {
    console.warn('[supabase] anonymous sign-in failed:', error?.message);
    return null;
  }
  await setUsername(username);
  return { ...toSession(data.session), username };
}

/**
 * Sign in with a real Google account.
 *
 * The native SDK does the account picking and hands back an ID token, which
 * Supabase verifies against the web client ID and turns into a session — no
 * browser round-trip, no deep link. Any anonymous session is replaced, so the
 * guest's local history does not follow the player into the account.
 */
export async function signInWithGoogleAccount(): Promise<{
  session: Session | null;
  error: string | null;
  cancelled: boolean;
}> {
  if (!supabase) return { session: null, error: 'Supabase is not configured.', cancelled: false };

  const res = await signInWithGoogle();
  if (!res.ok) return { session: null, error: res.error, cancelled: res.cancelled };

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: res.credential.idToken,
  });
  if (error || !data.session) {
    console.warn('[supabase] google sign-in failed:', error?.message);
    return { session: null, error: error?.message ?? 'Google sign-in failed.', cancelled: false };
  }

  return { session: toSession(data.session), error: null, cancelled: false };
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(email: string, password: string, username: string) {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  return { error: error?.message ?? null };
}

export async function signOut() {
  await signOutFromGoogle();
  await supabase?.auth.signOut();
}

/** Rename the player everywhere: auth metadata (cheap to read) and the profile row. */
export async function setUsername(username: string) {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.auth.updateUser({ data: { username } });
  await supabase.from('profiles').upsert({ id: data.user.id, username });
}

export type HistoryRow = {
  match_id: string;
  room_code: string;
  played_at: string;
  player_count: number;
  duration_ms: number;
  score: number;
  placement: number;
  won: boolean;
};

export async function fetchMatchHistory(limit = 20): Promise<HistoryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('my_match_history')
    .select('*')
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[supabase] history fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as HistoryRow[];
}

export type LeaderboardRow = {
  player_id: string;
  username: string;
  matches: number;
  wins: number;
  total_score: number;
  best_score: number;
  avg_placement: number;
};

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_leaderboard');
  if (error) {
    console.warn('[supabase] leaderboard fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as LeaderboardRow[];
}
