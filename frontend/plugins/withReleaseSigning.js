// Release signing for APKs built on a laptop with Gradle
// (`cd android && ./gradlew assembleRelease`), kept when the native folder is
// regenerated with `npx expo prebuild --clean`.
//
// The generated android/app/build.gradle signs release builds with the public
// Android debug key. Google Play refuses those, anyone could sign an "update"
// with the same public key, and a build made on one laptop cannot install over
// one made on another (each laptop has its own debug keystore).
//
// With this plugin a release build uses the upload key named in the person's
// own ~/.gradle/gradle.properties (never in the repository):
//
//   LOCALMIND_UPLOAD_STORE_FILE=C:/keys/localmind-upload.jks
//   LOCALMIND_UPLOAD_STORE_PASSWORD=...
//   LOCALMIND_UPLOAD_KEY_ALIAS=localmind
//   LOCALMIND_UPLOAD_KEY_PASSWORD=...
//
// Without those properties the build still works, signed with the debug key as
// before, and Gradle prints a warning. EAS builds replace signing with the key
// EAS holds, so this changes nothing there. See MOBILE_BUILD.md.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// LocalMind: release upload key";

const RELEASE_CONFIG = `        ${MARK} (plugins/withReleaseSigning.js)
        release {
            if (project.hasProperty('LOCALMIND_UPLOAD_STORE_FILE')) {
                storeFile file(LOCALMIND_UPLOAD_STORE_FILE)
                storePassword LOCALMIND_UPLOAD_STORE_PASSWORD
                keyAlias LOCALMIND_UPLOAD_KEY_ALIAS
                keyPassword LOCALMIND_UPLOAD_KEY_PASSWORD
            }
        }
`;

const RELEASE_USES = `            signingConfig project.hasProperty('LOCALMIND_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug
            if (!project.hasProperty('LOCALMIND_UPLOAD_STORE_FILE')) {
                logger.warn('LocalMind: no upload key configured; release builds are signed with the debug key. See MOBILE_BUILD.md.')
            }`;

/** Adds the release signing config to an app/build.gradle text. Idempotent. */
function applyReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const signing = gradle.indexOf("signingConfigs {");
  const debugBlock = signing >= 0 ? gradle.indexOf("debug {", signing) : -1;
  const debugEnd = debugBlock >= 0 ? gradle.indexOf("}\n", debugBlock) : -1;
  if (debugEnd < 0) throw new Error("withReleaseSigning: signingConfigs { debug { … } } not found in app/build.gradle");
  let out = gradle.slice(0, debugEnd + 2) + RELEASE_CONFIG + gradle.slice(debugEnd + 2);
  const release = out.indexOf("release {", out.indexOf("buildTypes {"));
  const uses = release >= 0 ? out.indexOf("signingConfig signingConfigs.debug", release) : -1;
  if (uses < 0) throw new Error("withReleaseSigning: release build type signing line not found in app/build.gradle");
  const lineStart = out.lastIndexOf("\n", uses) + 1;
  const lineEnd = out.indexOf("\n", uses);
  out = out.slice(0, lineStart) + RELEASE_USES + out.slice(lineEnd);
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === "groovy") cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
