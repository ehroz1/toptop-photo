// Автоперевод запроса на английский — большинство фотостоков находят
// заметно больше и точнее по английским словам. Бесплатный MyMemory API,
// ключ не нужен. Работает только для явно русского текста (кириллица).
//
// Удачные переводы кэшируются в localStorage: перевод стоит перед опросом
// всех источников, поэтому повторный запрос (история, "кот" в сотый раз)
// стартует сразу, без похода к переводчику, и не тратит его дневной лимит.
(function (global) {
  "use strict";

  const CACHE_KEY = "photoseek-translate-cache";
  const CACHE_MAX = 300;
  let cache = null;

  function getCache() {
    if (cache) return cache;
    try {
      cache = new Map(JSON.parse(global.localStorage.getItem(CACHE_KEY) || "[]"));
    } catch {
      cache = new Map();
    }
    return cache;
  }

  function remember(key, value) {
    const c = getCache();
    c.delete(key);
    c.set(key, value);
    while (c.size > CACHE_MAX) c.delete(c.keys().next().value);
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify([...c]));
    } catch { /* переполнен/запрещён localStorage — просто без кэша */ }
  }

  function hasCyrillic(text) {
    return /[а-яё]/i.test(text);
  }

  async function translateQuery(text, { signal } = {}) {
    if (!text || !hasCyrillic(text)) {
      return { translated: text, original: text, wasTranslated: false };
    }
    const key = text.trim().toLowerCase();
    const cached = getCache().get(key);
    if (cached) {
      return { translated: cached, original: text, wasTranslated: cached.toLowerCase() !== key };
    }
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|en`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // При исчерпании лимита MyMemory отвечает HTTP 200, но с responseStatus
      // 403/429 и текстом "MYMEMORY WARNING…" вместо перевода.
      if (data?.responseStatus && Number(data.responseStatus) !== 200) throw new Error(`MyMemory ${data.responseStatus}`);
      const translated = data?.responseData?.translatedText;
      if (!translated || typeof translated !== "string") throw new Error("пустой ответ переводчика");
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) throw new Error("лимит переводчика");
      const cleaned = translated.trim();
      remember(key, cleaned);
      const same = cleaned.toLowerCase() === key;
      return { translated: cleaned, original: text, wasTranslated: !same };
    } catch (err) {
      if (err.name !== "AbortError") console.warn("Перевод запроса не удался, ищем как есть:", err);
      return { translated: text, original: text, wasTranslated: false, error: err.message };
    }
  }

  global.translateQuery = translateQuery;
})(window);
