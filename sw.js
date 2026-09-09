// App-shell cache for offline loading, plus the desktop notification
// delivery surface (showNotification() calls from app.js's local scheduler,
// and a `push` handler for whenever real server-sent Web Push exists).
//
// Deliberately narrow scope: this only ever intercepts same-origin GET
// requests for the fixed shell-asset list below (or navigations). Every
// other request — Firestore/Auth's own network calls, Google Fonts, the
// CDN scripts in index.html's <head>, anything cross-origin or non-GET —
// is never touched (fetch() isn't even called on it, let alone
// respondWith()), so Firestore's own persistentLocalCache offline
// persistence (see firebase-init.js) keeps working exactly as it did before
// this file existed. The two caching layers never see each other.
const CACHE_VERSION = "flit-shell-v3";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/auth.js",
  "/auth-ui.js",
  "/auth-action.html",
  "/auth-action.js",
  "/firebase-init.js",
  "/firestore-sync.js",
  "/migrate.js",
  "/styles.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  // Self-hosted (see index.html's own comment) so they're actually
  // cacheable here -- the whole point of vendoring them off jsdelivr/
  // unpkg/gstatic. Without these, the app shell's HTML/CSS/JS loaded fine
  // offline but lucide.createIcons() and the Firebase SDK's own module
  // imports failed on every cross-origin fetch, which is what produced the
  // blank/chunky offline load this fixes: icons never rendering, and (for
  // a signed-in user) Firestore's offline persistence never even getting a
  // chance to run since the SDK modules that own it hadn't loaded.
  "/vendor/lucide.js",
  "/vendor/sortable.min.js",
  "/vendor/firebase/firebase-app.js",
  "/vendor/firebase/firebase-auth.js",
  "/vendor/firebase/firebase-firestore.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (typing the URL, a hard reload, opening the installed PWA)
  // go network-first so a signed-in user always gets the live app when
  // online, falling back to the cached shell only once offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (!SHELL_ASSETS.includes(url.pathname)) return;

  // Stale-while-revalidate: serve the cached shell file instantly (this is
  // what makes offline reloads work at all), while a background fetch keeps
  // the cache current for next time. A failed background fetch (offline)
  // just falls back to whatever's already cached.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// No server-side send capability exists yet (needs a Cloud Function plus
// the VAPID private key — see app.js's registerWebPushSubscription()
// comment) — this handler is real, correct plumbing for whenever that
// exists, but nothing calls it today. The desktop notifications a user
// actually sees right now come from app.js's local scheduler calling
// registration.showNotification() directly, not from a push event.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {}
  const title = payload.title || "Flit";
  const body = payload.body || "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "flit-push"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
