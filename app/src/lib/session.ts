import AsyncStorage from '@react-native-async-storage/async-storage';

import { SERVER_URL } from './env';
import { getClientId } from './clientId';
import { signInWithGoogle, signOutFromGoogle } from './google';

/**
 * Identity, against our own game server. Replaces the Supabase client.
 *
 * The app now talks to exactly one host. Sign-in returns a JWT that the socket
 * handshake carries, and that token is the only credential the client holds —
 * the Google ID token is exchanged once and never stored.
 *
 * Nothing in here runs during a round.
 */

const STORAGE_KEY = 'snake.session';
const TIMEOUT_MS = 10_000;

export type Session = {
  accessToken: string;
  userId: string;
  username: string | null;
  email: string | null;
  /** Guest: playable, but the history dies with the install. */
  isGuest: boolean;
};

export type Credits = {
  remaining: number;
  perDay: number;
  /** ISO instant of the next daily reset, for a "resets in 4h" line. */
  resetsAt: string;
};

type SessionResponse = {
  token: string;
  player: { id: string; username: string | null; email: string | null; isGuest: boolean };
  credits?: Credits;
};

let cached: Session | null | undefined;

/**
 * Sign-in happens on a cold start and on a tap, so a server that has gone away
 * must fail fast rather than leaving the button spinning. Every call is
 * wrapped: a network error is a null session, never a thrown render.
 */
async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[session] ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    console.warn(`[session] ${path} failed:`, err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toSession(res: SessionResponse): Session {
  return {
    accessToken: res.token,
    userId: res.player.id,
    username: res.player.username,
    email: res.player.email,
    isGuest: res.player.isGuest,
  };
}

async function persist(session: Session | null): Promise<Session | null> {
  cached = session;
  try {
    if (session) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // A device that refuses storage still plays; it just signs in again next
    // launch.
  }
  return session;
}

/** The stored session, if there is one. Does not hit the network. */
export async function getSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Guest sign-in, keyed on the install id. Named for the Supabase call it
 * replaces so the screens did not have to change shape.
 */
export async function signInAnonymously(username: string): Promise<Session | null> {
  const clientId = await getClientId();
  const res = await api<SessionResponse>('/auth/guest', {
    method: 'POST',
    body: { clientId, username },
  });
  return res ? persist(toSession(res)) : null;
}

/**
 * Sign in with a real Google account.
 *
 * The native SDK picks the account and returns an ID token; the server
 * verifies it against the web client ID and hands back one of our own tokens.
 * If this install was already playing as a guest, the server upgrades that same
 * player rather than creating a second one — so history and the day's spent
 * credits follow the player into the account.
 */
export async function signInWithGoogleAccount(): Promise<{
  session: Session | null;
  error: string | null;
  cancelled: boolean;
}> {
  const res = await signInWithGoogle();
  if (!res.ok) return { session: null, error: res.error, cancelled: res.cancelled };

  const clientId = await getClientId();
  const out = await api<SessionResponse>('/auth/google', {
    method: 'POST',
    body: { idToken: res.credential.idToken, clientId, username: res.credential.name },
  });
  if (!out) {
    return { session: null, error: 'Could not sign in with Google.', cancelled: false };
  }
  return { session: await persist(toSession(out)), error: null, cancelled: false };
}

/** Rename the player. The name lives in the token, so this mints a new one. */
export async function setUsername(username: string): Promise<Session | null> {
  const current = await getSession();
  if (!current) return null;
  const res = await api<SessionResponse>('/me/username', {
    method: 'POST',
    body: { username },
    token: current.accessToken,
  });
  if (!res) {
    // Keep the typed name locally even if the server did not hear about it;
    // the next sign-in will carry it up.
    return persist({ ...current, username });
  }
  return persist(toSession(res));
}

export async function signOut(): Promise<void> {
  await signOutFromGoogle();
  await persist(null);
}

/** Today's remaining free rooms, for the lobby. Null when it cannot be read. */
export async function getCredits(): Promise<Credits | null> {
  const current = await getSession();
  if (!current) return null;
  return api<Credits>('/me/credits', { token: current.accessToken });
}
