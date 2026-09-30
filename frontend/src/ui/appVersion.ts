import Constants from "expo-constants";

/** \"Version 1.0.1 · a1b2c3d\": which build this is, for testers to report.
 *  The version comes from app.json and the commit from app.config.js. */
export function appVersionLabel(config: { version?: string; extra?: { gitCommit?: unknown } } | null | undefined = Constants.expoConfig): string {
  const version = config?.version ? `Version ${config.version}` : "Version unknown";
  const commit = typeof config?.extra?.gitCommit === "string" ? config.extra.gitCommit.trim() : "";
  return commit ? `${version} · ${commit}` : version;
}
