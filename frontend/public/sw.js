// LocalMind web app shell for offline use.
//
// Keeps the app's own files (the page, its script bundle, fonts and icons) so
// the app still opens when the server cannot be reached. Student content is
// not cached here: the app stores that itself (src/offline) and API requests
// always go to the network. Browsers only run service workers on https or
// localhost; on a plain-http LAN address this file is never registered and
// the app still works offline for as long as its tab stays open.
const CACHE = "localmind-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/media/")) return;

  if (request.mode === "navigate") {
    // Pages: network first, the saved app page when offline.
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put("/", copy));
        return response;
      }).catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
    return;
  }
  // Scripts, fonts, images: saved copy first (their names change with every build).
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
      return response;
    })),
  );
});
