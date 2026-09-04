/**
 * All runtime configuration comes from EXPO_PUBLIC_* env vars (see .env.example)
 * so the same build can point at localhost, a LAN IP or the deployed server.
 * Nothing here is a secret — the service role key never leaves the server.
 */
export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL?.trim() || 'http://localhost:3001';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Google Sign-In. The *web* client ID is what Supabase verifies the ID token
 * against, so it is required on both platforms; the iOS one is only read by the
 * native SDK on iOS. Neither is a secret (the Android client is bound to the
 * package name + signing certificate, the iOS one to the bundle ID).
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || '';

/** Google needs Supabase behind it — the ID token is exchanged for a session. */
export const GOOGLE_ENABLED = Boolean(SUPABASE_ENABLED && GOOGLE_WEB_CLIENT_ID);
