// Minimal service worker — exists so the app is installable and to provide a
// graceful offline experience for the cached app shell. NetworkFirst on API
// routes (so the user always sees fresh data when online), CacheFirst on
// static assets, and an offline fallback for the dashboard.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isHtml(request) {
  return request.mode === "navigate" || request.destination === "document";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isApi(url)) {
    // Network-first; do not cache (data is too time-sensitive).
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }

  if (isHtml(request)) {
    // Network-first, with the cached shell as a fallback offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    }),
  );
});

// Web-push hooks (used by Phase F). Living here from day one keeps the SW
// registration churn-free when push lands.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Rival Slayer", body: event.data.text() };
  }
  const title = payload.title || "Rival Slayer";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    data: payload.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ("focus" in c && c.url.includes(url)) return c.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
