// Схлопывание похожих/одинаковых фото из разных стоков — двумя уровнями.
//
// Уровень 1 (дешёвый, синхронный, без сети): совпадение по нормализованному
// URL полноразмерного файла — если два источника отдают буквально один и тот
// же файл (например, оба зеркалят один файл с Wikimedia Commons), это уже
// 100% дубль, незачем тратить на него perceptual hash.
//
// Уровень 2 (дорогой, только для того, что прошло уровень 1): perceptual hash
// (average hash, 8x8) по самим байтам превью — ловит "разные файлы, одна и
// та же фотография" между разными стоками. Считается по уже загружаемым
// превью — без отдельного сервера и без ключей. Хеш каждого URL считается
// не больше одного раза за сессию (см. hashCache) — если это же превью
// встретится снова (следующая страница пагинации, другой поиск), хеш просто
// берётся из кэша, а не качается по новой.
(function (global) {
  "use strict";

  const SIZE = 8;

  // Нормализует URL для сравнения уровня 1 — отбрасывает query-параметры
  // (часто это просто размер/токен ресайза одного и того же файла) и хвостовой
  // слэш, оставляя origin+path как ключ.
  function normalizeUrlKey(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`.replace(/\/$/, "").toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  // Уровень 1: убирает точные повторы по URL полноразмерного файла (full/
  // download.url). seenUrls — Set нормализованных ключей, уже встреченных в
  // этом поиске (передаётся вызывающим кодом и мутируется — копится по всем
  // страницам одного поиска, как и hashes у уровня 2).
  function dedupeByUrl(items, seenUrls) {
    const kept = [];
    for (const it of items) {
      const key = normalizeUrlKey(it.download?.url || it.full);
      if (key && seenUrls.has(key)) continue; // точный повтор — отбрасываем без pHash
      if (key) seenUrls.add(key);
      kept.push(it);
    }
    return kept;
  }

  function computeHash(img) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const gray = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
    const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
    let hash = "";
    for (const v of gray) hash += v >= avg ? "1" : "0";
    return hash;
  }

  async function hashImageUrl(url) {
    // priority: "low" — фоновая проверка не должна отнимать канал у превью,
    // которые пользователь видит прямо сейчас (браузеры без поддержки просто
    // игнорируют этот параметр).
    const res = await fetch(url, { mode: "cors", priority: "low" });
    if (!res.ok) throw new Error("network");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });
      return computeHash(img);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function hammingDistance(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }

  // Кэш "URL превью -> хеш" на время сессии (не per-поиск) — то же превью,
  // встреченное снова (следующая страница, повторный поиск того же слова),
  // не должно качаться по новой только чтобы посчитать тот же самый хеш.
  const hashCache = new Map(); // thumbUrl -> hash|null

  async function hashWithCache(url) {
    if (hashCache.has(url)) return hashCache.get(url);
    let hash = null;
    try {
      hash = await hashImageUrl(url);
    } catch {
      hash = null; // не удалось посчитать — пропускаем сравнение, но фото оставляем
    }
    hashCache.set(url, hash);
    return hash;
  }

  // items: NormalizedItem[]; existingHashes: строки хешей уже принятых фото
  // (из предыдущих страниц этого же поиска). Возвращает { kept, hashes }.
  // concurrency — сколько превью хешируется параллельно; если пустить все
  // разом, сетевой всплеск случается ещё до того, как их кто-то увидел.
  async function dedupeItems(items, existingHashes = [], { threshold = 4, concurrency = 5 } = {}) {
    const computed = new Array(items.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const i = cursor++;
        computed[i] = await hashWithCache(items[i].thumb);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
    await Promise.all(workers);

    const keptHashes = existingHashes.slice();
    const newHashes = [];
    const kept = [];
    for (let i = 0; i < items.length; i++) {
      const h = computed[i];
      if (h) {
        const isDup = keptHashes.some((kh) => hammingDistance(h, kh) <= threshold);
        if (isDup) continue;
        keptHashes.push(h);
        newHashes.push(h);
      }
      kept.push(items[i]);
    }
    return { kept, hashes: newHashes };
  }

  global.dedupeByUrl = dedupeByUrl;
  global.dedupeItems = dedupeItems;
})(window);
