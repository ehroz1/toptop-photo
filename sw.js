// Service worker кэширует только "оболочку" самого приложения (HTML/CSS/JS/иконки),
// чтобы PhotoSeek открывался мгновенно и был доступен офлайн. Запросы к API
// фотостоков и картинкам сознательно не трогаем — там всегда нужна сеть.
const CACHE_NAME = "photoseek-shell-v2";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/providers.js",
  "./js/translate.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch((err) => console.warn("SW install cache.addAll failed:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
