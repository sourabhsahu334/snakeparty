const { withGradleProperties } = require('expo/config-plugins');

/**
 * Gradle's default HTTP timeouts are short, and the first Android build pulls
 * hundreds of artifacts from dl.google.com and Maven Central. On a slow or
 * congested link a single stalled read fails the whole build with
 * "Could not HEAD ... Read timed out".
 *
 * These raise the timeouts and let Gradle retry a stalled request instead of
 * giving up. Lives as a config plugin so `expo prebuild --clean` doesn't
 * wipe it the way editing android/gradle.properties by hand would.
 */
const PROPERTIES = {
  // --- Build capacity -----------------------------------------------------
  // RN 0.76 with the new architecture compiles C++ codegen for every native
  // module, and Skia is large on top of that. On an 8GB machine the default
  // 2GB heap and unbounded worker count let four concurrent CMake configures
  // (app + skia, x2 ABIs) starve each other until AGP gives up with
  // "[CXX1428] Expected metadata generation to create android_gradle_build.json".
  'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8',
  'org.gradle.workers.max': '4',
  // Only ship the ABI real devices use. Halves the native build.
  // NOTE: `expo run:android` overrides this from the connected device's ABI
  // list, so build via ./gradlew directly to keep it single-ABI.
  reactNativeArchitectures: 'arm64-v8a',

  // --- Network resilience -------------------------------------------------
  'systemProp.org.gradle.internal.http.connectionTimeout': '180000',
  'systemProp.org.gradle.internal.http.socketTimeout': '180000',
  // Gradle renamed this between versions; setting both is harmless.
  'systemProp.org.gradle.internal.repository.max.retries': '8',
  'systemProp.org.gradle.internal.repository.max.tentatives': '8',
  'systemProp.org.gradle.internal.repository.initial.backoff': '1000',
};

module.exports = function withGradleNetworkTimeouts(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
