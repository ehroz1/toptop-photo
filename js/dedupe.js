// Схлопывание похожих/одинаковых фото из разных стоков по perceptual hash
// (average hash, 8x8). Считается по уже загружаемым превью — без отдельного
// сервера и без ключей.
(function (global) {
  "use strict";

  const SIZE = 8;

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
    const res = await fetch(url, { mode: "cors" });
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

  // items: NormalizedItem[]; existingHashes: строки хешей уже принятых фото
  // (из предыдущих страниц этого же поиска). Возвращает { kept, hashes }.
  // concurrency — это, по сути, самая первая настоящая загрузка байтов
  // каждого превью (для хеша качаем сам файл); если пустить все разом,
  // сетевой всплеск случается ещё до отрисовки карточек, и последующее
  // ограничение при показе (см. buildCard в app.js) уже ничего не сглаживает,
  // потому что браузер отдаёт эти же URL из кэша почти мгновенно. Раньше
  // было 3 — с ростом числа источников (сейчас их 9, до ~24 фото с каждого
  // на страницу) это стало заметно тормозить первую отрисовку: 5 держит
  // всплеск умеренным, но почти вдвое сокращает число последовательных раундов.
  async function dedupeItems(items, existingHashes = [], { threshold = 4, concurrency = 5 } = {}) {
    const computed = new Array(items.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          computed[i] = await hashImageUrl(items[i].thumb);
        } catch {
          computed[i] = null; // не удалось посчитать — пропускаем сравнение, но фото оставляем
        }
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

  global.dedupeItems = dedupeItems;
})(window);
