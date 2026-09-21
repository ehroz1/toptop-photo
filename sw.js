// Service worker кэширует "оболочку" приложения (HTML/CSS/JS/иконки), чтобы
// PhotoSeek открывался мгновенно и был доступен офлайн. Запросы к API
// фотостоков и картинкам сознательно не трогаем — там всегда нужна сеть.
//
// Стратегия — "network-first, cache as fallback": при каждом заходе сначала
// пробуем сеть и, если она отвечает, отдаём и кэшируем свежий файл. Кэш
// используется только если сети нет (офлайн) или она не ответила вовремя.
// Раньше было наоборот (cache-first) — из-за этого после каждого обновления
// сайта старая версия могла показываться ещё один-два захода, пока кэш не
// обновится в фоне. CACHE_NAME нужно поднимать при каждом заметном релизе,
// чтобы гарантированно почистить старый кэш при активации.
const CACHE_NAME = "photoseek-shell-v4";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/i18n.js",
  "./js/providers.js",
  "./js/translate.js",
  "./js/queryLogic.js",
  "./js/spellcheck.js",
  "./js/dedupe.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const NETWORK_TIMEOUT_MS = 3000;

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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    withTimeout(fetch(event.request), NETWORK_TIMEOUT_MS)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
