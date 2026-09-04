/**
 * All runtime configuration comes from EXPO_PUBLIC_* env vars (see .env.example)
 * so the same build can point at localhost, a LAN IP or the deployed server.
 * Nothing here is a secret: identity and history live behind SERVER_URL now,
 * and the database is never reachable from the app.
 */
export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL?.trim() || 'http://localhost:3001';

/**
 * Google Sign-In. The *web* client ID is the audience the game server checks
 * the ID token against, so it is required on both platforms; the iOS one is
 * only read by the native SDK on iOS. Neither is a secret (the Android client
 * is bound to the package name + signing certificate, the iOS one to the
 * bundle ID).
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || '';

/**
 * Google needs the server behind it — the ID token is exchanged there for a
 * session. SERVER_URL always has a value, so the client ID is the only switch.
 */
export const GOOGLE_ENABLED = Boolean(GOOGLE_WEB_CLIENT_ID);
