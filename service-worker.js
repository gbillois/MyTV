const CACHE_NAME = "mytv-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/epg.js",
  "./js/storage.js",
  "./js/ui.js",
  "./manifest.json",
  "./assets/icons/favicon.svg",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./demo/sample.xml"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.endsWith("/data/epg.xml")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          return (await cache.match(event.request)) || Response.error();
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && response.type === "basic") {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      }
      return response;
    }))
  );
});
