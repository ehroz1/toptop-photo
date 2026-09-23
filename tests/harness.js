// Тестовый стенд: реальный index.html + реальные js/*.js в jsdom, с
// подменённым fetch — чтобы прогнать loadPage/runSearch по-настоящему,
// а не гадать по чтению кода. Никакой реальной сети — только контролируемые
// синтетические ответы (задержки/ошибки/таймауты по провайдерам).
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

function makeItem(provider, i, overrides = {}) {
  return Object.assign({
    id: `${provider}-${i}`,
    provider,
    thumb: `https://example.com/${provider}/${i}/thumb.jpg`,
    full: `https://example.com/${provider}/${i}/full.jpg`,
    width: 1200,
    height: 800,
    title: `${provider} item ${i}`,
    description: "",
    tags: [],
    author: "someone",
    authorUrl: "https://example.com",
    pageUrl: "https://example.com/page",
    download: { type: "direct", url: `https://example.com/${provider}/${i}/full.jpg` },
    license: { name: "Test License", url: "https://example.com/license", commercial: true, attribution: false },
  }, overrides);
}

async function buildPage(opts = {}) {
  // Настоящий index.html, но без встроенных <script> — их мы сами вгоняем
  // ниже, по одному, в правильном порядке и с уже готовыми заглушками API.
  const rawHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const html = rawHtml.replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.test/", pretendToBeVisual: true, runScripts: "dangerously" });
  const { window } = dom;

  // ---- Полифиллы/заглушки браузерных API, которых нет в jsdom ----
  window.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  // Картинки карточек считаем сразу "на экране" (превью грузятся через
  // IntersectionObserver, см. queueImageLoad в app.js). Сентинел
  // бесконечной прокрутки — нет: тесты сами включают подгрузку страниц.
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); }
    observe(t) {
      this.targets.add(t);
      if (t.tagName === "IMG") setTimeout(() => { if (this.targets.has(t)) this.cb([{ target: t, isIntersecting: true }], this); }, 0);
    }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  if (!window.matchMedia().addEventListener) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  window.navigator.vibrate = () => {};
  // jsdom не делает раскладку — getBoundingClientRect() всегда нули, из-за
  // чего isNearViewport() в app.js решил бы, что "Показать ещё" всегда
  // на экране, и сам рекурсивно улетел бы на много страниц вперёд. Явно
  // говорим, что всё "далеко" — тесты сами включают постраничную подгрузку,
  // где это нужно проверить, через window.__nearViewport = true.
  window.__nearViewport = false;
  window.Element.prototype.getBoundingClientRect = function () {
    const top = window.__nearViewport ? 0 : 99999;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top };
  };
  window.CSS = window.CSS || {};
  window.CSS.escape = window.CSS.escape || ((s) => s.replace(/["\\]/g, "\\$&"));
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.AbortController = global.AbortController;
  window.PLAYWRIGHT_STUB = true;

  // localStorage — jsdom обычно даёт рабочий window.localStorage
  try {
    window.localStorage.clear();
    // Для тестов миграции/persisted-фильтров: seed нужен ДО того, как ниже
    // выполнится app.js (он читает localStorage синхронно при загрузке).
    if (opts.seedLocalStorage) {
      Object.entries(opts.seedLocalStorage).forEach(([k, v]) => {
        window.localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      });
    }
  } catch {}

  // ---- Подменный fetch: маршрутизируем по URL на синтетические ответы ----
  window.__fetchLog = [];
  window.__providerBehavior = {}; // providerId -> {delayMs, items, total, status, errorBody, throwNetwork, aiGenerated}
  window.__iconifyBehavior = {}; // {delayMs, icons, collectionInfo, respectPrefixes, respectPalette}
  window.fetch = (url, opts) => {
    const u = String(url);
    window.__fetchLog.push(u);
    const signal = opts && opts.signal;
    if (u.includes("api.iconify.design")) return mockIconifyFetch(u, signal);
    let providerId = null;
    // "-video" варианты ДО общих /pixabay и /pexels — иначе substring-match
    // общего правила перехватил бы их первым и отдал фото-форму ответа.
    if (u.includes("/pixabay-video")) providerId = "pixabay-video";
    else if (u.includes("/pexels-video")) providerId = "pexels-video";
    else if (u.includes("archive.org/advancedsearch")) providerId = "archive-search";
    else if (u.includes("archive.org/metadata/")) providerId = "archive-metadata";
    else if (u.includes("archive.org/services/img/")) providerId = "archive-thumb";
    else if (u.includes("/coverr")) providerId = "coverr";
    else if (u.includes("/pixabay")) providerId = "pixabay";
    else if (u.includes("/pexels")) providerId = "pexels";
    else if (u.includes("/unsplash/search")) providerId = "unsplash";
    else if (u.includes("commons.wikimedia.org")) providerId = "wikimedia";
    else if (u.includes("api.openverse.org")) providerId = "openverse";
    else if (u.includes("doodl.co")) providerId = "doodl";
    else if (u.includes("/flickr")) providerId = "flickr";
    else if (u.includes("/shutterstock")) providerId = "shutterstock";
    else if (u.includes("/pexafy")) providerId = "pexafy";
    else if (u.includes("mymemory")) providerId = "translate";
    else if (u.includes("speller.yandex")) providerId = "spellcheck";
    else providerId = "unknown";

    const behavior = window.__providerBehavior[providerId] || { delayMs: 10, items: 3, total: 30 };

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        if (behavior.throwNetwork) { reject(new Error("network down")); return; }
        if (behavior.hang) return; // никогда не резолвится — для теста таймаута
        const status = behavior.status || 200;
        let page = 1;
        try { page = Number(new URL(u).searchParams.get("page")) || 1; } catch {}
        const body = behavior.errorBody || buildBody(providerId, behavior, page);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 429 ? "Too Many Requests" : "Error",
          json: async () => body,
          text: async () => JSON.stringify(body),
        });
      }, behavior.delayMs ?? 10);
      if (signal) signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  };

  const DEFAULT_ICON_POOL = [
    { id: "mdi:home", prefix: "mdi", name: "home", palette: false },
    { id: "mdi:cat", prefix: "mdi", name: "cat", palette: false },
    { id: "tabler:home", prefix: "tabler", name: "home", palette: false },
    { id: "tabler:cat", prefix: "tabler", name: "cat", palette: false },
    { id: "ph:home", prefix: "ph", name: "home", palette: false },
    { id: "twemoji:cat", prefix: "twemoji", name: "cat", palette: true },
    { id: "simple-icons:github", prefix: "simple-icons", name: "github", palette: false },
  ];

  // Мок Iconify (api.iconify.design): /search, /collections, /{prefix}.json.
  // behavior.respectPrefixes/respectPalette включают серверную фильтрацию —
  // по умолчанию выключены, чтобы тесты по умолчанию проверяли именно
  // клиентский safety-net фильтр в app.js/loadIconPage, а не мок.
  function mockIconifyFetch(u, signal) {
    const parsed = new URL(u);
    const behavior = window.__iconifyBehavior || {};
    return new Promise((resolve, reject) => {
      const onAbort = () => { const err = new Error("aborted"); err.name = "AbortError"; reject(err); };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        let body;
        if (parsed.pathname === "/search") {
          const start = Number(parsed.searchParams.get("start")) || 0;
          const limit = Number(parsed.searchParams.get("limit")) || 64;
          const reqPrefixes = (parsed.searchParams.get("prefixes") || "").split(",").filter(Boolean);
          const palette = parsed.searchParams.get("palette");
          let pool = (behavior.icons || DEFAULT_ICON_POOL).slice();
          if (behavior.respectPrefixes && reqPrefixes.length) pool = pool.filter((ic) => reqPrefixes.includes(ic.prefix));
          if (behavior.respectPalette && palette != null) {
            const wantColor = palette === "true";
            pool = pool.filter((ic) => !!ic.palette === wantColor);
          }
          const total = pool.length;
          const page = pool.slice(start, start + limit);
          body = { icons: page.map((ic) => ic.id), total, collections: {} };
        } else if (parsed.pathname === "/collections") {
          const prefixes = (parsed.searchParams.get("prefix") || "").split(",").filter(Boolean);
          const info = {};
          const pool = behavior.icons || DEFAULT_ICON_POOL;
          prefixes.forEach((p) => {
            const fromPool = pool.find((ic) => ic.prefix === p);
            info[p] = (behavior.collectionInfo && behavior.collectionInfo[p]) || { title: p, palette: fromPool ? !!fromPool.palette : false };
          });
          body = info;
        } else {
          const prefix = parsed.pathname.replace(/^\//, "").replace(/\.json$/, "");
          const names = (parsed.searchParams.get("icons") || "").split(",").filter(Boolean);
          const icons = {};
          names.forEach((n) => { icons[n] = { body: `<path d="M0 0h1v1h-1z"/>` }; });
          body = { width: 24, height: 24, icons };
        }
        resolve({ ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) });
      }, behavior.delayMs ?? 5);
      if (signal) signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  }

  function buildBody(providerId, behavior, page = 1) {
    const n = behavior.items ?? 3;
    const total = behavior.total ?? 30;
    // Уникальный сдвиг индекса на страницу — иначе все "страницы" отдавали бы
    // фото с одинаковыми id/URL, и дедуп уровня 1 (по точному URL) законно
    // схлопывал бы "страницу 2" в дубли "страницы 1", маскируя баг пагинации.
    const base = (page - 1) * 1000;
    switch (providerId) {
      case "pixabay":
        return { hits: Array.from({ length: n }, (_, i) => ({ id: 1000 + base + i, webformatURL: `https://x/pixabay/${base + i}.jpg`, largeImageURL: `https://x/pixabay/${base + i}-l.jpg`, imageWidth: 1200, imageHeight: 800, tags: "cat, animal", user: "u", user_id: 1, pageURL: "https://x" })), totalHits: total };
      case "pexels":
        return { photos: Array.from({ length: n }, (_, i) => ({ id: 2000 + base + i, src: { medium: `https://x/pexels/${base + i}.jpg`, original: `https://x/pexels/${base + i}-o.jpg` }, width: 1200, height: 800, alt: "cat", photographer: "p", photographer_url: "https://x", url: "https://x" })), total_results: total };
      case "unsplash":
        return { results: Array.from({ length: n }, (_, i) => ({ id: `u${base + i}`, urls: { small: `https://x/unsplash/${base + i}.jpg`, regular: `https://x/unsplash/${base + i}-r.jpg`, full: `https://x/unsplash/${base + i}-f.jpg` }, width: 1200, height: 800, description: "cat", user: { name: "u", links: { html: "https://x" } }, links: { html: "https://x", download_location: "https://api.unsplash.com/dl" } })), total };
      case "wikimedia": {
        // window.__wikimediaVideoMode переключает mime image/*->video/* —
        // и фото-, и видео-провайдер Wikimedia бьют в один и тот же
        // MediaWiki-эндпоинт с идентичной формой запроса, различаясь только
        // клиентским фильтром по mime (см. providers.js/videoProviders.js).
        const isVideo = !!behavior.wikimediaVideo;
        const ext = isVideo ? "webm" : "jpg";
        const mime = isVideo ? "video/webm" : "image/jpeg";
        return { query: { pages: Object.fromEntries(Array.from({ length: n }, (_, i) => [base + i, { pageid: base + i, title: `File:cat${base + i}.${ext}`, imageinfo: [{ url: `https://x/wm/${base + i}.${ext}`, thumburl: `https://x/wm/${base + i}-t.jpg`, thumbwidth: 800, thumbheight: 600, mime, extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://x" } } }] }])) } };
      }
      case "pixabay-video":
        return { hits: Array.from({ length: n }, (_, i) => ({ id: 5000 + base + i, pageURL: "https://x", tags: "cat, animal", duration: 12, picture_id: `pic${base + i}`, videos: { large: { url: `https://x/pv/${base + i}.mp4`, width: 1920, height: 1080, thumbnail: `https://x/pv/${base + i}.jpg` } }, user: "u", user_id: 1 })), totalHits: total };
      case "pexels-video":
        return { videos: Array.from({ length: n }, (_, i) => ({ id: 6000 + base + i, width: 1920, height: 1080, duration: 15, image: `https://x/pxv/${base + i}.jpg`, user: { name: "p", url: "https://x" }, url: "https://x", video_files: [{ quality: "hd", width: 1280, height: 720, link: `https://x/pxv/${base + i}.mp4` }] })), total_results: total };
      case "archive-search":
        return { response: { numFound: total, docs: Array.from({ length: n }, (_, i) => ({ identifier: `arch${base + i}`, title: "Cat film", description: "desc", runtime: "0:12" })) } };
      case "archive-metadata":
        return { files: [{ name: "movie_512kb.mp4", format: "512Kb MPEG4", width: "640", height: "480", length: "12.5" }] };
      case "archive-thumb":
        return {};
      case "coverr":
        return { hits: Array.from({ length: n }, (_, i) => ({ id: `cv${base + i}`, title: "Cat video", urls: { mp4: `https://x/cv/${base + i}.mp4`, poster: `https://x/cv/${base + i}.jpg` }, duration: 8 })), pagination: { total_hits: total } };
      case "openverse":
        return { results: Array.from({ length: n }, (_, i) => ({ id: `ov${base + i}`, thumbnail: `https://x/ov/${base + i}.jpg`, url: `https://x/ov/${base + i}-f.jpg`, width: 1200, height: 800, title: "cat", tags: [], creator: "c", license: "by", license_url: "https://x" })), result_count: total };
      case "doodl":
        return { seed: "seed1", total, results: Array.from({ length: n }, (_, i) => ({ id: `doodl-uuid-${base + i}`, title: "AI cat", width: 1200, height: 800, tags: ["cat"], urls: { small: `https://x/doodl/${base + i}.jpg`, large: `https://x/doodl/${base + i}-l.jpg`, download: `https://x/doodl/${base + i}/download` }, page_url: "https://x", creator: { name: "c" }, license: { url: "https://x", commercial_use: true, attribution_required: false } })) };
      case "flickr":
        return { stat: "ok", photos: { total: String(total), photo: Array.from({ length: n }, (_, i) => ({ id: `${base + i}`, owner: "o", url_n: `https://x/fl/${base + i}.jpg`, url_l: `https://x/fl/${base + i}-l.jpg`, title: "cat", tags: "cat animal", ownername: "o", license: "4" })) } };
      case "shutterstock":
        return { data: Array.from({ length: n }, (_, i) => ({ id: `${3000 + base + i}`, description: "cat", keywords: ["cat"], assets: { preview_1000: { url: `https://x/sstk/${base + i}.jpg`, width: 1000, height: 667 }, large_thumb: { url: `https://x/sstk/${base + i}-t.jpg` } } })), total_count: total };
      case "pexafy":
        return { data: Array.from({ length: n }, (_, i) => ({ photo_id: `pxf-uuid-${base + i}`, description: "cat", width: 1200, height: 800, urls: { small: `https://x/pxf/${base + i}.jpg`, regular: `https://x/pxf/${base + i}-r.jpg`, full: `https://x/pxf/${base + i}-f.jpg` }, photographer_username: "p" })), pagination: { per_page: 24, has_more: false, next_cursor: null } };
      case "translate":
        return { responseData: { translatedText: "cat" } };
      case "spellcheck":
        return [];
      default:
        return {};
    }
  }

  // ---- Загружаем реальные скрипты проекта в порядке из index.html ----
  const scripts = [
    "js/config.js", "js/i18n.js", "js/auth.js", "js/providers.js", "js/icons.js", "js/videoProviders.js",
    "js/translate.js", "js/queryLogic.js", "js/spellcheck.js", "js/dedupe.js", "js/app.js", "js/background.js", "js/cursor.js",
  ];
  window.JSZip = function () { this.file = () => {}; this.generateAsync = async () => new Blob(); };
  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    window.eval(code);
    if (rel === "js/i18n.js") window.I18N.applyStaticI18n();
  }

  return { dom, window, document: window.document };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// С появлением MAX_ACTIVE_SOURCES=3 (см. app.js) больше нельзя просто
// "кликнуть всё кроме X" — источники по умолчанию активны не все, и есть
// потолок в 3 одновременно активных. Этот хелпер кликами (как настоящий
// пользователь — состояние app.js доступно только через реальные события)
// доводит набор активных фото-источников ровно до wantIds, независимо от
// того, с чего стартовали. Приоритет: сперва добираем нужные (если есть
// место до потолка), затем гасим лишние (если активных больше одного) —
// это гарантированно не застревает ни на потолке, ни на правиле "минимум
// один источник должен остаться включён".
function setActiveSources(doc, win, wantIds) {
  const wanted = new Set(wantIds);
  const CAP = 3;
  // Фото-источники теперь настоящие <input type="checkbox"> в popover
  // "Источники" — .click() (а не dispatchEvent(new Event("click"))) нужен,
  // чтобы jsdom сам переключил .checked и выстрелил change, как у реального
  // пользователя (синтетический Event этого не делает для чекбоксов).
  const chips = () => Array.from(doc.querySelectorAll('#sources input.source-checkbox[data-source]:not([hidden])'));
  for (let guard = 0; guard < 40; guard++) {
    const all = chips();
    const active = all.filter((c) => c.checked);
    const wantedInactive = all.filter((c) => wanted.has(c.dataset.source) && !c.checked);
    const unwantedActive = active.filter((c) => !wanted.has(c.dataset.source));
    if (wantedInactive.length === 0 && unwantedActive.length === 0) break;
    if (wantedInactive.length > 0 && active.length < CAP) {
      wantedInactive[0].click();
    } else if (unwantedActive.length > 0 && active.length > 1) {
      unwantedActive[0].click();
    } else {
      break; // не должно случаться для wantIds.length <= 3
    }
  }
}

module.exports = { buildPage, sleep, makeItem, setActiveSources };
