// Поиск иконок — отдельный от фото источник данных. Используем Iconify
// (api.iconify.design): бесплатный, без ключа публичный API, объединяющий
// ~200 открытых наборов иконок (Material Design Icons, Tabler, Font Awesome
// Free, Feather и т.д.) с понятной лицензией у каждого набора.
//
// В отличие от фотостоков, иконки рендерим не через <img src="...">, а
// вставляем настоящую inline-SVG разметку в DOM: тогда заливка currentColor
// внутри иконки берёт цвет текста из CSS (тему интерфейса или выбранный
// пользователем акцентный цвет), а не остаётся всегда чёрной, как было бы
// при загрузке SVG через <img>.
(function (global) {
  "use strict";

  const API_BASE = "https://api.iconify.design";
  const PAGE_SIZE = 64;

  // Кэш на время сессии (не в localStorage — данных может быть много,
  // а повторный запрос при перезагрузке страницы не критичен).
  const collectionsCache = new Map(); // prefix -> info | null
  const iconBodyCache = new Map(); // "prefix:name" -> {body,width,height} | null

  // Лицензии наборов иконок — это ПО (SVG-файлы в npm-пакетах), а не CC, как
  // у фото, поэтому классифицируем по SPDX-идентификатору лицензии открытого
  // ПО, а не по коду Creative Commons.
  function classifyIconLicense(license) {
    if (!license) return null;
    const spdx = (license.spdx || license.title || "").toLowerCase();
    if (!spdx) return null;
    const noAttribution = /(cc0|unlicense|mit-0|mit0|0bsd|public domain)/.test(spdx);
    const copyleft = /(^|[^l])gpl|agpl/.test(spdx); // gpl/agpl, но не lgpl
    return {
      name: license.title || license.spdx || "License",
      url: license.url || null,
      commercial: copyleft ? undefined : true,
      attribution: !noAttribution,
    };
  }

  async function fetchCollectionsInfo(prefixes) {
    const missing = prefixes.filter((p) => !collectionsCache.has(p));
    if (missing.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/collections?prefix=${missing.map(encodeURIComponent).join(",")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      missing.forEach((p) => collectionsCache.set(p, data[p] || null));
    } catch {
      // Лицензия не критична для показа самой иконки — просто останется
      // неизвестной (см. license_unknown в лайтбоксе).
      missing.forEach((p) => { if (!collectionsCache.has(p)) collectionsCache.set(p, null); });
    }
  }

  function getCollectionInfo(prefix) {
    return collectionsCache.get(prefix) || null;
  }

  // prefixes/palette — базовые фильтры (выбор наборов иконок + моно/цветные,
  // см. app.js). Отправляем их и на сервер (если Iconify их поддерживает —
  // меньше лишних данных в ответе), но полагаться только на это нельзя: не
  // из этой песочницы проверить точные имена параметров живого API, поэтому
  // app.js обязательно ещё раз фильтрует items на клиенте после ответа —
  // сервер-side фильтр тут просто оптимизация, а не единственный барьер.
  async function search(query, { page = 1, prefixes = [], palette = "any" } = {}) {
    const start = (page - 1) * PAGE_SIZE;
    const params = new URLSearchParams({ query, limit: String(PAGE_SIZE), start: String(start) });
    if (prefixes.length) params.set("prefixes", prefixes.join(","));
    if (palette === "mono") params.set("palette", "false");
    else if (palette === "color") params.set("palette", "true");
    const url = `${API_BASE}/search?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ids = Array.isArray(data.icons) ? data.icons : [];
    const items = ids.map((id) => {
      const sep = id.indexOf(":");
      return { id, prefix: id.slice(0, sep), name: id.slice(sep + 1) };
    });
    const resultPrefixes = Array.from(new Set(items.map((it) => it.prefix)));
    if (data.collections) {
      resultPrefixes.forEach((p) => {
        if (data.collections[p] && !collectionsCache.has(p)) collectionsCache.set(p, data.collections[p]);
      });
    }
    // Не ждём лицензии наборов, чтобы не тормозить показ сетки — подтянутся
    // к моменту, когда пользователь откроет конкретную иконку.
    fetchCollectionsInfo(resultPrefixes);
    return { items, total: typeof data.total === "number" ? data.total : null };
  }

  // Один запрос на набор иконок (а не по одному на иконку) — в выдаче обычно
  // всего несколько разных наборов, а не десятки.
  async function fetchIconBodies(items) {
    const byPrefix = new Map();
    items.forEach((it) => {
      if (!byPrefix.has(it.prefix)) byPrefix.set(it.prefix, []);
      byPrefix.get(it.prefix).push(it.name);
    });
    await Promise.all(Array.from(byPrefix.entries()).map(async ([prefix, names]) => {
      const need = names.filter((n) => !iconBodyCache.has(`${prefix}:${n}`));
      if (need.length === 0) return;
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(prefix)}.json?icons=${need.map(encodeURIComponent).join(",")}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const defW = data.width || 16;
        const defH = data.height || 16;
        need.forEach((n) => {
          const ic = data.icons && data.icons[n];
          iconBodyCache.set(`${prefix}:${n}`, ic ? { body: ic.body, width: ic.width || defW, height: ic.height || defH } : null);
        });
      } catch {
        need.forEach((n) => { if (!iconBodyCache.has(`${prefix}:${n}`)) iconBodyCache.set(`${prefix}:${n}`, null); });
      }
    }));
  }

  function getIconBody(prefix, name) {
    return iconBodyCache.get(`${prefix}:${name}`) || null;
  }

  // Тело иконки вставляется прямо в DOM через innerHTML (см. app.js) — это
  // нужно, чтобы currentColor подхватывал цвет темы, но значит и любой
  // <script>/on*-обработчик внутри выполнился бы. Iconify — курируемый
  // источник, но это дешёвая страховка на случай испорченных/подменённых
  // данных набора, поэтому вырезаем такие конструкции перед сборкой markup.
  function sanitizeSvgBody(body) {
    return (body || "")
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
  }

  // markup для конкретной иконки: <svg viewBox="0 0 W H" fill="currentColor">…</svg>.
  // fill на самой svg — это значение по умолчанию для одноцветных иконок;
  // многоцветные наборы (например, эмодзи-стиль) обычно задают цвета прямо
  // в теле, и оно переопределяет этот fill как и положено.
  function buildSvgMarkup(prefix, name) {
    const data = getIconBody(prefix, name);
    if (!data) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" fill="currentColor">${sanitizeSvgBody(data.body)}</svg>`;
  }

  function iconPageUrl(prefix, name) {
    return `https://icon-sets.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}/`;
  }

  global.IconSearch = {
    search,
    fetchIconBodies,
    getIconBody,
    buildSvgMarkup,
    getCollectionInfo,
    ensureCollectionsInfo: fetchCollectionsInfo,
    classifyIconLicense,
    iconPageUrl,
  };
})(window);
