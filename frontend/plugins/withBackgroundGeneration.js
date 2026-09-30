/**
 * iOS settings for on-device generation that continues while the person uses
 * other apps (modules/localmind-background). Android needs nothing here: the
 * module's own AndroidManifest declares its service and permissions.
 *
 * iOS 26 continued-processing tasks must use identifiers the app lists in
 * BGTaskSchedulerPermittedIdentifiers; the module uses "<bundle id>.generate.<id>".
 *
 * gpuInBackground (default false): also request the GPU while LocalMind is off
 * screen, on iPhones that support it. Turn it on only after enabling the
 * "Background GPU Access" capability for this App ID in the Apple Developer
 * portal; without that capability the signed build is rejected. With it off,
 * generation continues off screen on the CPU and returns to the GPU on screen.
 */
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const GPU_ENTITLEMENT = 'com.apple.developer.background-tasks.continued-processing.gpu';

module.exports = function withBackgroundGeneration(config, { gpuInBackground = false } = {}) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('withBackgroundGeneration needs ios.bundleIdentifier');
  config = withInfoPlist(config, (c) => {
    const pattern = `${bundleId}.generate.*`;
    const permitted = new Set(c.modResults.BGTaskSchedulerPermittedIdentifiers || []);
    permitted.add(pattern);
    c.modResults.BGTaskSchedulerPermittedIdentifiers = [...permitted];
    const modes = new Set(c.modResults.UIBackgroundModes || []);
    modes.add('processing');
    c.modResults.UIBackgroundModes = [...modes];
    if (gpuInBackground) c.modResults.LocalMindBackgroundGPU = true;
    else delete c.modResults.LocalMindBackgroundGPU;
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    if (gpuInBackground) c.modResults[GPU_ENTITLEMENT] = true;
    else delete c.modResults[GPU_ENTITLEMENT];
    return c;
  });
  return config;
};
