// Главный цвет картинки — для режима «Цвета» (как picular.co): по запросу
// берём первые фото из источников и показываем вместо них их цвет.
// Превью уменьшаем до 32×32 и раскладываем пиксели по корзинам (8 уровней
// на канал). Побеждает самая «тяжёлая» корзина: насыщенные пиксели весят
// больше, почти чёрные — меньше, иначе тени и серый фон забивали бы цвет
// предмета. Итог — средний цвет пикселей этой корзины.
(function (global) {
  "use strict";

  const SIZE = 32;

  function dominantColor(data) {
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      let w = 1 + sat * 2;
      if (max < 40) w *= 0.4;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      let bin = bins.get(key);
      if (!bin) { bin = { w: 0, r: 0, g: 0, b: 0 }; bins.set(key, bin); }
      bin.w += w;
      bin.r += r * w;
      bin.g += g * w;
      bin.b += b * w;
    }
    let best = null;
    for (const bin of bins.values()) if (!best || bin.w > best.w) best = bin;
    if (!best) return null;
    return { r: Math.round(best.r / best.w), g: Math.round(best.g / best.w), b: Math.round(best.b / best.w) };
  }

  function toHex({ r, g, b }) {
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  // Светлый ли фон — чтобы подпись на плитке была тёмной или светлой.
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4;
  }

  // Расстояние между цветами: меньше ~16 — на глаз один и тот же оттенок.
  function distance(a, b) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const dr = ((x >> 16) & 255) - ((y >> 16) & 255);
    const dg = ((x >> 8) & 255) - ((y >> 8) & 255);
    const db = (x & 255) - (y & 255);
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  const cache = new Map(); // url -> hex

  async function colorFromImageUrl(url, { signal } = {}) {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url, { mode: "cors", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const rgb = dominantColor(ctx.getImageData(0, 0, SIZE, SIZE).data);
      if (!rgb) throw new Error("transparent image");
      const hex = toHex(rgb);
      cache.set(url, hex);
      return hex;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  global.PictaColors = { dominantColor, toHex, isLight, distance, colorFromImageUrl };
})(window);
