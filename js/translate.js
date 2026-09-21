// Автоперевод запроса на английский — большинство фотостоков находят
// заметно больше и точнее по английским словам. Бесплатный MyMemory API,
// ключ не нужен. Работает только для явно русского текста (кириллица).
(function (global) {
  "use strict";

  function hasCyrillic(text) {
    return /[а-яё]/i.test(text);
  }

  async function translateQuery(text) {
    if (!text || !hasCyrillic(text)) {
      return { translated: text, original: text, wasTranslated: false };
    }
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|en`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translated = data?.responseData?.translatedText;
      if (!translated || typeof translated !== "string") throw new Error("пустой ответ переводчика");
      const cleaned = translated.trim();
      const same = cleaned.toLowerCase() === text.trim().toLowerCase();
      return { translated: cleaned, original: text, wasTranslated: !same };
    } catch (err) {
      console.warn("Перевод запроса не удался, ищем как есть:", err);
      return { translated: text, original: text, wasTranslated: false, error: err.message };
    }
  }

  // Переводит запрос сразу на несколько языков (кроме английского — тот уже
  // даёт translateQuery). Используется только для источников с многоязычными
  // описаниями (Wikimedia/Openverse) — там, где на неанглийском языке
  // реально может найтись что-то, чего нет в английской версии запроса.
  // Ошибки по отдельным языкам просто пропускаются — это "бонусные"
  // результаты, а не обязательная часть поиска.
  async function translateQueryToLangs(text, langs) {
    if (!text || !hasCyrillic(text)) return [];
    const results = await Promise.all(langs.map(async (lang) => {
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|${lang}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (!translated || typeof translated !== "string") throw new Error("пустой ответ переводчика");
        return translated.trim();
      } catch {
        return null;
      }
    }));
    return results.filter(Boolean);
  }

  global.translateQuery = translateQuery;
  global.translateQueryToLangs = translateQueryToLangs;
})(window);
