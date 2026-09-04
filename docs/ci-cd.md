# Shipping to Play from GitHub

`.github/workflows/android-release.yml` takes a push to `main` and turns it into
a signed `.aab` on the Play **production** track at a **100% rollout**. There is
no internal/beta hop and no staged percentage — merging to `main` ships to
everyone.

```
push to main (app/**)
  └─ npm ci → typecheck → 73 tests
     └─ bump versionCode (build.gradle + app.json)
        └─ write .env from secrets      ← EXPO_PUBLIC_* are inlined at bundle time
           └─ restore upload keystore   ← from secrets, shredded afterwards
              └─ ./gradlew :app:bundleRelease
                 └─ upload to track: production, status: completed  ← 100%
                    └─ commit the shipped versionCode back to main [skip ci]
```

`status: completed` **is** the full rollout. A staged one would be
`status: inProgress` plus a `userFraction`; Play does not accept
`userFraction: 1.0`, so "completed" is the only way to express 100%.

## What it does not do

- It does not run `expo prebuild`. `app/android/` is committed, so gradle builds
  it as-is. If you change anything in `app.json` that affects native code
  (plugins, package name, permissions), run `npx expo prebuild -p android`
  locally and commit the result.
- It only builds `arm64-v8a` — that is `reactNativeArchitectures` in
  `android/gradle.properties`. Widen it there if you want 32-bit devices.
- iOS is not wired up. Play only.

## One-time setup

### 1. Play service account

Publishing needs a Google service account with access to your Play developer
account. In **Play Console → Users and permissions → Invite new users**, invite
the service account email and grant it *Release apps to production, exclude
devices, and use Play App Signing* on `com.neukaps.snakeparty`.

To create the account: **Google Cloud Console → IAM & Admin → Service Accounts**
in the project linked under *Play Console → Setup → API access*, then create a
JSON key. The whole JSON file is one secret.

The **first** production release of an app has to be uploaded by hand in the
console — Play will not accept an API upload to a track that has never had a
release. After that this workflow takes over.

### 2. GitHub secrets

| Secret | Where it comes from |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i app/android/upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` in `app/android/keystore.properties` |
| `ANDROID_KEY_ALIAS` | `keyAlias` in the same file |
| `ANDROID_KEY_PASSWORD` | `keyPassword` in the same file |
| `PLAY_SERVICE_ACCOUNT_JSON` | the whole service-account JSON |
| `EXPO_PUBLIC_SERVER_URL` | `https://oracleserver2.neukaps.com` |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe to ship) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | optional — Google Sign-In |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | optional — Google Sign-In |

Set them from a checkout that still has the local files:

```bash
base64 -i app/android/upload-keystore.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD --body "$(grep '^storePassword=' app/android/keystore.properties | cut -d= -f2-)"
gh secret set ANDROID_KEY_ALIAS         --body "$(grep '^keyAlias='      app/android/keystore.properties | cut -d= -f2-)"
gh secret set ANDROID_KEY_PASSWORD      --body "$(grep '^keyPassword='   app/android/keystore.properties | cut -d= -f2-)"
gh secret set PLAY_SERVICE_ACCOUNT_JSON < ~/Downloads/play-service-account.json
gh secret set EXPO_PUBLIC_SERVER_URL        --body "$(grep '^EXPO_PUBLIC_SERVER_URL='        app/.env | cut -d= -f2-)"
gh secret set EXPO_PUBLIC_SUPABASE_URL      --body "$(grep '^EXPO_PUBLIC_SUPABASE_URL='      app/.env | cut -d= -f2-)"
gh secret set EXPO_PUBLIC_SUPABASE_ANON_KEY --body "$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' app/.env | cut -d= -f2-)"
```

> `app/android/upload-keystore.jks` and `app/android/keystore.properties` are
> gitignored and must stay that way. Lose the keystore and only Play support can
> get the app back — keep a copy somewhere off this machine.

## Releasing

- **Normal**: merge to `main`. Release notes fall back to
  `distribution/whatsnew/whatsnew-en-US` — edit that file in the same commit to
  say something real.
- **Manual**: Actions → *Android → Play production* → **Run workflow**, and type
  the release notes into the input (max 500 chars).

`versionName` still comes from `app.json` → `expo.version`; bump it by hand for
a user-visible version change. `versionCode` is never edited by hand — CI owns
it and commits the number it shipped back to `main` as
`release: versionCode N to production [skip ci]`, tagged `android-v1.0.0-N`.

## When it fails

| Symptom | Cause |
|---|---|
| `ANDROID_KEYSTORE_BASE64 is not set` | secret missing — the build would have been debug-signed |
| Play: *Version code N has already been used* | someone uploaded by hand; bump past it in `android/app/build.gradle` and push |
| Play: rejects the very first API upload | the app has no production release yet — upload one manually first |
| `The caller does not have permission` | service account not invited in Play Console, or missing the release permission |
| Gradle OOM | `org.gradle.jvmargs` in `android/gradle.properties` |
