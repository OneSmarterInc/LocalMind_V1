# Keep the browser parser aligned with the application build

A network-loaded app shell could receive an older parser from the offline
service worker because every build used `/private-assets/parser.js`. The worker
caches assets by pathname; a query-string cache buster would not solve this.

The asset preparation step now creates a content-hashed parser filename and a
generated TypeScript constant. The application requests that exact filename.
An existing worker with an old cached parser cannot substitute it for the new
filename. The new asset is included in the offline manifest for offline setup.
The legacy filename remains for parser tooling and backwards compatibility.

No IndexedDB databases, downloaded models, learner history or localStorage are
cleared. Update the branch, export the frontend and restart the server, then
save offline app files and reload. A running tab retains its already loaded
JavaScript until it reloads. WEB_DIST, if explicitly configured, must point to
the newly exported frontend/dist directory.

Validation: TypeScript and the web export passed. Two browser regression tests
passed: import rollback/persistence and importing with an old 48 MiB parser
planted in the offline cache. The latter verifies the new parser filename is
requested and existing local data remains present.
