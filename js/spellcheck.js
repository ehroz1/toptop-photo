// Исправление опечаток в запросе через бесплатный Yandex Speller API
// (ключ не нужен). Работает только для обычного текста без наших
// собственных операторов (-слово, "фраза", ИЛИ) — их спеллер не поймёт.
(function (global) {
  "use strict";

  async function checkSpelling(text, { signal } = {}) {
    if (!text || !text.trim()) return null;
    try {
      const url = `https://speller.yandex.net/services/spellservice.json/checkText?text=${encodeURIComponent(text)}&lang=ru,en`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const errors = await res.json();
      if (!Array.isArray(errors) || errors.length === 0) return null;

      let corrected = text;
      // Применяем исправления с конца строки, чтобы не сбить позиции остальных.
      const sorted = errors.slice().sort((a, b) => b.pos - a.pos);
      for (const err of sorted) {
        if (!err.s || !err.s.length) continue;
        corrected = corrected.slice(0, err.pos) + err.s[0] + corrected.slice(err.pos + err.len);
      }
      return corrected !== text ? corrected : null;
    } catch (err) {
      if (err.name !== "AbortError") console.warn("Спеллчекер недоступен:", err);
      return null;
    }
  }

  global.checkSpelling = checkSpelling;
})(window);
