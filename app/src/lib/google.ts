import { GOOGLE_ENABLED, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './env';

/**
 * Thin wrapper over the native Google Sign-In SDK.
 *
 * Everything is lazy and guarded on purpose: the module is a native one, so a
 * build without it (Expo Go, or a checkout with no Google client IDs) must not
 * crash on import — it just reports Google as unavailable and the guest flow
 * carries on.
 */
type GoogleModule = typeof import('@react-native-google-signin/google-signin');

export type GoogleCredential = {
  /** The JWT the game server verifies and exchanges for a session. */
  idToken: string;
  name: string | null;
  email: string | null;
  photo: string | null;
};

export type GoogleResult =
  | { ok: true; credential: GoogleCredential }
  | { ok: false; cancelled: boolean; error: string | null };

let cached: GoogleModule | null | undefined;
let configured = false;

function load(): GoogleModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when a Google button should be shown at all. */
export const googleAvailable = () => GOOGLE_ENABLED && load() !== null;

function configure(mod: GoogleModule) {
  if (configured) return;
  mod.GoogleSignin.configure({
    // The server checks the token's audience against this one, on both platforms.
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    scopes: ['profile', 'email'],
  });
  configured = true;
}

/** Opens the native account picker and returns a fresh ID token. */
export async function signInWithGoogle(): Promise<GoogleResult> {
  const mod = load();
  if (!mod || !GOOGLE_ENABLED) {
    return { ok: false, cancelled: false, error: 'Google sign-in is not configured.' };
  }
  try {
    // Inside the try: on a build where the native module was never linked (an
    // old APK running new JS), this is where it throws.
    configure(mod);

    // Android only; a no-op that resolves on iOS.
    await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // A stale native session would silently hand back the previous account, so
    // always start from a clean picker.
    await mod.GoogleSignin.signOut().catch(() => {});

    const res = await mod.GoogleSignin.signIn();
    if (!mod.isSuccessResponse(res)) {
      return { ok: false, cancelled: true, error: null };
    }

    const { idToken, user } = res.data;
    if (!idToken) {
      return {
        ok: false,
        cancelled: false,
        error: 'Google did not return an ID token — check the web client ID.',
      };
    }

    return {
      ok: true,
      credential: {
        idToken,
        name: user.name ?? user.givenName ?? null,
        email: user.email ?? null,
        photo: user.photo ?? null,
      },
    };
  } catch (err: any) {
    const code = err?.code;
    const { statusCodes } = mod;
    if (code === statusCodes.SIGN_IN_CANCELLED) {
      return { ok: false, cancelled: true, error: null };
    }
    if (code === statusCodes.IN_PROGRESS) {
      return { ok: false, cancelled: true, error: null };
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { ok: false, cancelled: false, error: 'Google Play services are unavailable.' };
    }
    return { ok: false, cancelled: false, error: err?.message ?? 'Google sign-in failed.' };
  }
}

/** Best-effort: forget the Google account so the next sign-in shows the picker. */
export async function signOutFromGoogle() {
  const mod = load();
  if (!mod) return;
  try {
    await mod.GoogleSignin.signOut();
  } catch {
    // Never block signing out on this.
  }
}
