const CACHE_NAME = "otui-static-v6";
const ASSETS = ["/manifest.json", "/favicon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("otui-static-") && k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const url = new URL(request.url);

  // A worker left over from preview must never intercept Vite's source modules
  // or hot-reload runtime while it is being unregistered by the development app.
  if (/^\/(?:src\/|@vite\/|@react-refresh(?:\/|$)|@id\/|@fs\/|node_modules\/)/.test(url.pathname)) return;

  // Never intercept/cache API or health calls — data must always be fresh.
  // Caching these would serve stale data after mutations (e.g. adding a holding).
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  const isNavigation = request.mode === "navigate";
  const isHtml = request.headers.get("accept")?.includes("text/html");

  // Keep app shell fresh to avoid serving stale builds after deploy.
  if (isNavigation || isHtml) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match("/index.html");
        })
    );
    return;
  }

  // Cache-first for static assets. Do not cache HTML for asset requests; that
  // turns stale chunk URLs into JavaScript MIME errors after a rebuild.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        const contentType = resp.headers.get("content-type") || "";
        const shouldCache =
          url.origin === self.location.origin &&
          resp.ok &&
          !contentType.includes("text/html");
        if (shouldCache) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return resp;
      });
    })
  );
});
