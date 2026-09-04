const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Wire the release build type to the upload key in android/keystore.properties.
 *
 * The generated template signs release with the *debug* key, which Play
 * rejects. Doing this as a config plugin rather than by hand means
 * `expo prebuild --clean` no longer silently reverts us to a debug-signed
 * bundle — the failure mode that costs you a rejected upload.
 *
 * If keystore.properties is absent (a fresh checkout — it is gitignored) the
 * build still works and falls back to the debug key, which is fine locally and
 * rejected by Play, which is exactly the failure you want.
 */
const MARKER = '// --- withReleaseSigning ---';

const LOAD_BLOCK = `${MARKER}
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;

const RELEASE_SIGNING_CONFIG = `        if (keystoreProperties['storeFile']) {
            release {
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    // 1. Load the properties file just above the android {} block.
    const androidBlock = '\nandroid {';
    if (!src.includes(androidBlock)) {
      throw new Error("withReleaseSigning: no 'android {' block in build.gradle");
    }
    src = src.replace(androidBlock, '\n' + LOAD_BLOCK + 'android {');

    // 2. Add a release signing config next to the debug one.
    const debugSigning = /(signingConfigs \{\n(?:.*\n)*?        \}\n)/;
    if (!debugSigning.test(src)) {
      throw new Error('withReleaseSigning: could not find signingConfigs block');
    }
    src = src.replace(debugSigning, `$1${RELEASE_SIGNING_CONFIG}`);

    // 3. Point the release build type at it.
    const releaseDebugSign =
      '            // Caution! In production, you need to generate your own keystore file.\n' +
      '            // see https://reactnative.dev/docs/signed-apk-android.\n' +
      '            signingConfig signingConfigs.debug';
    if (!src.includes(releaseDebugSign)) {
      throw new Error('withReleaseSigning: release buildType signingConfig not found');
    }
    src = src.replace(
      releaseDebugSign,
      "            signingConfig keystoreProperties['storeFile'] ? signingConfigs.release : signingConfigs.debug"
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
