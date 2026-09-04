# Google Sign-In

Multiplayer identities are Supabase auth users. Anonymous sign-in still exists —
a player who never touches the Google button plays as a guest exactly as before —
but a Google account is what survives a reinstall and keeps match history and the
leaderboard attached to the same person.

The app uses the **native** flow: `@react-native-google-signin/google-signin`
shows the system account picker and returns an ID token, which is handed to
`supabase.auth.signInWithIdToken({ provider: 'google' })`. No browser, no deep
link, no client secret in the app.

Code involved:

- [app/src/lib/google.ts](../app/src/lib/google.ts) — native SDK wrapper (lazy + guarded)
- [app/src/lib/supabaseClient.ts](../app/src/lib/supabaseClient.ts) — `signInWithGoogleAccount()`
- [app/src/screens/HomeScreen.tsx](../app/src/screens/HomeScreen.tsx) — the button and account row
- [app/app.config.js](../app/app.config.js) — adds the iOS URL scheme when configured

Everything degrades cleanly: with the env vars unset the button is hidden, the
config plugin is skipped, and the build is identical to what shipped before.

---

## 1. Google Cloud — create the OAuth clients

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
pick (or create) a project, configure the OAuth consent screen (External, add
your account as a test user while it is unpublished), then create **three**
OAuth 2.0 client IDs:

### a. Web application — *required*

This is the one Supabase verifies tokens against, on both platforms.

| Field | Value |
| --- | --- |
| Authorized redirect URI | `https://anicknkeksmxkyfxzkxn.supabase.co/auth/v1/callback` |

Copy the **client ID** and the **client secret**.

### b. Android

| Field | Value |
| --- | --- |
| Package name | `com.neukaps.snakeparty` |
| SHA-1 (debug build) | `29:72:2A:19:26:12:6B:69:5B:3A:58:BA:17:C1:48:42:C4:25:F9:2A` |
| SHA-1 (upload keystore) | `E2:5F:3D:A0:CD:25:88:94:22:9E:FE:D5:D6:9B:06:02:6E:88:D5:68` |

One client ID per fingerprint — create the debug one so `expo run:android` works
locally, and the upload one for the release APK/AAB.

If the app is distributed through Play App Signing, Google re-signs the bundle,
so **also** create a client for the fingerprint under
*Play Console → Test and release → Setup → App signing → App signing key
certificate*. Without it, sign-in works on your own APK and fails with
`DEVELOPER_ERROR` for everyone who installs from Play.

Android client IDs are never referenced in code — Google matches on package name
plus signature.

Regenerate the fingerprints any time with:

```bash
cd app
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA1
keytool -list -v -keystore android/upload-keystore.jks -alias snakeparty-upload | grep SHA1
```

### c. iOS

| Field | Value |
| --- | --- |
| Bundle ID | `com.neukaps.snakeparty` |

Copy the client ID and its **reversed** form
(`com.googleusercontent.apps.<numbers>-<hash>`), shown in the console as the
"iOS URL scheme".

---

## 2. Supabase — enable the provider

Dashboard → *Authentication → Sign In / Providers → Google*:

1. Toggle **Enable Sign in with Google**.
2. **Client IDs**: paste all of them, comma-separated — web, iOS, and every
   Android client ID you created. A token whose audience is not in this list is
   rejected.
3. **Client Secret**: the web client's secret.
4. Save.

Leave anonymous sign-in enabled (*Authentication → Sign In / Providers →
Anonymous*) — guests still rely on it.

Then re-run [supabase/schema.sql](../supabase/schema.sql) (it is idempotent) so
`handle_new_user` picks up the new fallback: Google sends `full_name` / `name`
rather than `username`, and without this a Google player's profile row would be
named after their email prefix.

---

## 3. The app — env vars

Add to `app/.env` (see `app/.env.example`):

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client ID>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<iOS client ID>
GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.<reversed iOS client ID>
```

`GOOGLE_IOS_URL_SCHEME` has no `EXPO_PUBLIC_` prefix on purpose: it is read by
`app.config.js` at build time and never shipped in the JS bundle.

---

## 4. Rebuild

The native module is new, so Metro alone is not enough — the app must be rebuilt:

```bash
cd app
npx expo prebuild --clean     # regenerates ios/ and android/ with the plugin
npx expo run:android          # or: npx expo run:ios
```

Expo Go cannot run this build; use a dev client or a real build.

---

## What a player sees

- **Guest** (default): types a name, hits Multiplayer. An anonymous Supabase
  user is created on the first create/join, exactly as before.
- **Google**: taps *Sign in with Google* on the home screen. The account row
  replaces the button, showing the name and email plus a *Sign out* control.
  Their Google display name fills the name field unless they already typed one
  of their own; editing the name afterwards renames the account.

Signing in while playing as a guest **replaces** the anonymous session — the
guest's match history is not carried over. Supabase's identity-linking API does
not cover the native ID-token flow, so merging the two would mean a server-side
migration of `match_results.player_id`; not worth it for a friends-only lobby.

The socket handshake is re-run after sign-in and after sign-out
(`reauthenticate`), so the game server always sees the current token and writes
match results against the right user.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `DEVELOPER_ERROR` on Android | Missing Android OAuth client for the exact package name + SHA-1 that signed the running build (most often the Play App Signing fingerprint). |
| "Google did not return an ID token" | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is empty or wrong — the native SDK only mints an ID token for a valid web client ID. |
| Supabase rejects the token (`Invalid audience`) | That client ID is not in the provider's **Client IDs** list. |
| `Passed nonce and nonce in id_token should either both exist or not` | Enable **Skip nonce checks** in the Supabase Google provider settings; the native SDK does not send one. |
| Button not showing at all | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` unset, Supabase env vars unset, or running a build made before the module was installed. |
