const CACHE_NAME = "tokyo-sunlight-map-v17";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./detail.html",
  "./manifest.webmanifest",
  "./assets/icons/icon-144.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-256.png",
  "./assets/icons/icon-384.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./data/datasets.json",
  "./data/tokyo-areas.json",
  "./data/landmarks/lod2/manifest.json",
  "./data/landmarks/lod2/tokyo_tower_lod2_surfaces.json",
  "./data/landmarks/lod2/tokyo_skytree_lod2_surfaces.json",
  "./data/landmarks/lod2/roppongi_hills_mori_tower_lod2_surfaces.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const shouldCache =
            response &&
            (response.ok || response.type === "opaque") &&
            ["document", "script", "style", "image", "font"].includes(event.request.destination);

          if (shouldCache || event.request.url.includes("/data/")) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }

          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          throw new Error("Network unavailable and no cached response found.");
        });
    })
  );
});
