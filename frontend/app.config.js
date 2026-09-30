// Adds the build's git commit to the app config, so My profile can show which
// build a tester has ("Version 1.0.1 · a1b2c3d"). Everything else stays in
// app.json. EAS provides the commit in EAS_BUILD_GIT_COMMIT_HASH; a laptop
// build asks git. Without either, the commit is simply left out.
const { execSync } = require("child_process");

function gitCommit() {
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

module.exports = ({ config }) => ({ ...config, extra: { ...(config.extra || {}), gitCommit: gitCommit() } });
