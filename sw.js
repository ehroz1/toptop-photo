// Service worker кэширует "оболочку" приложения (HTML/CSS/JS/иконки), чтобы
// Picta открывалась мгновенно и был доступен офлайн. Запросы к API
// фотостоков и картинкам сознательно не трогаем — там всегда нужна сеть.
//
// Стратегия — "network-first, cache as fallback": при каждом заходе сначала
// пробуем сеть и, если она отвечает, отдаём и кэшируем свежий файл. Кэш
// используется только если сети нет (офлайн) или она не ответила вовремя.
// Раньше было наоборот (cache-first) — из-за этого после каждого обновления
// сайта старая версия могла показываться ещё один-два захода, пока кэш не
// обновится в фоне. CACHE_NAME нужно поднимать при каждом заметном релизе,
// чтобы гарантированно почистить старый кэш при активации.
const CACHE_NAME = "picta-shell-v32";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/i18n.js",
  "./js/auth.js",
  "./js/providers.js",
  "./js/icons.js",
  "./js/videoProviders.js",
  "./js/translate.js",
  "./js/queryLogic.js",
  "./js/spellcheck.js",
  "./js/dedupe.js",
  "./js/app.js",
  "./js/background.js",
  "./js/cursor.js",
  "./js/analytics.js",
  "./manifest.webmanifest",
  "./fonts/manrope-cyrillic.woff2",
  "./fonts/manrope-latin.woff2",
  "./fonts/unbounded-black-cyrillic.woff2",
  "./fonts/unbounded-black-latin.woff2",
  // ?v=3 — номер версии в адресе иконок: при смене логотипа его поднимают,
  // иначе браузер/телефон мог бы показывать старую иконку из своего кэша.
  "./icons/icon-192.png?v=3",
  "./icons/icon-512.png?v=3",
  "./icons/favicon.svg?v=3",
  "./icons/logo.svg",
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
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== "GET") return;
  // Страница открывается и как "/", и как "/?q=кот" — это одна и та же
  // оболочка. Кэшируем её под одним ключом без query, иначе каждая ссылка на
  // поиск копилась бы в кэше отдельной копией, а офлайн не открывалась бы.
  const isPage = req.mode === "navigate";
  const cacheKey = isPage ? new Request(url.origin + url.pathname) : req;
  const network = fetch(req).then((res) => {
    if (res.ok) {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
    }
    return res;
  });
  network.catch(() => {}); // офлайн при наличии кэша — не ошибка
  // Сеть не уложилась в таймаут или недоступна — отдаём кэш; если в кэше
  // этого файла нет, продолжаем ждать сеть, а не отдаём пустой ответ.
  event.respondWith(
    withTimeout(network, NETWORK_TIMEOUT_MS)
      .catch(() => caches.match(cacheKey).then((cached) => cached || network))
  );
});
