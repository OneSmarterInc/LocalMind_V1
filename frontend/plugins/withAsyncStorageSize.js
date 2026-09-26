// Keeps the Android AsyncStorage size limit in android/gradle.properties when
// the native folder is regenerated with `npx expo prebuild --clean`.
// The offline course copy (src/offline/store.ts) lives in AsyncStorage, whose
// Android database is capped at 6 MB unless AsyncStorage_db_size_in_MB is set.
const { withGradleProperties } = require("expo/config-plugins");

const KEY = "AsyncStorage_db_size_in_MB";

module.exports = function withAsyncStorageSize(config, { sizeMB = 200 } = {}) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((item) => !(item.type === "property" && item.key === KEY));
    cfg.modResults.push({ type: "property", key: KEY, value: String(sizeMB) });
    return cfg;
  });
};
