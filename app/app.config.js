const base = require('./app.json');

/**
 * app.json stays the source of truth; this file only bolts on the bits that
 * differ per Google Cloud project.
 *
 * Google Sign-In on iOS needs the *reversed* iOS OAuth client ID registered as
 * a URL scheme, and that string is project-specific — so it comes from
 * GOOGLE_IOS_URL_SCHEME in .env instead of being baked into app.json. With the
 * var unset the plugin is left out entirely and the app still builds and runs
 * (guest sign-in only), which keeps a checkout without Google credentials
 * working.
 */
module.exports = () => {
  const expo = { ...base.expo };
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME?.trim();

  if (iosUrlScheme) {
    expo.plugins = [
      ...(expo.plugins ?? []),
      ['@react-native-google-signin/google-signin', { iosUrlScheme }],
    ];
  }

  return { ...base, expo };
};
