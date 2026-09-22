const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };
  // Кросс-провайдерный дедуп именно между unsplash и pexels — оба должны
  // быть активны явно (unsplash не входит в дефолтную тройку MAX_ACTIVE_SOURCES).
  setActiveSources(doc, win, ["unsplash", "pexels"]);

  // Патчим fetch ещё раз, чтобы pexels отдавал ФОТО С ТЕМ ЖЕ САМЫМ full-URL,
  // что и unsplash — чистый тест дедупа уровня 1 (без canvas/pHash).
  const origFetch = win.fetch;
  win.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes("/pexels")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          photos: [
            { id: 1, src: { medium: "https://x/shared/0.jpg", original: "https://x/shared/0-full.jpg" }, width: 1200, height: 800, alt: "dup", photographer: "p", photographer_url: "https://x", url: "https://x" },
            { id: 2, src: { medium: "https://x/pexels/uniq.jpg", original: "https://x/pexels/uniq-full.jpg" }, width: 1200, height: 800, alt: "uniq", photographer: "p", photographer_url: "https://x", url: "https://x" },
          ],
          total_results: 2,
        }),
        text: async () => "{}",
      });
    }
    if (u.includes("/unsplash/search")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          results: [
            { id: "u1", urls: { small: "https://x/shared/0-t.jpg", regular: "https://x/shared/0-full.jpg", full: "https://x/shared/0-full.jpg" }, width: 1200, height: 800, description: "dup", user: { name: "u", links: { html: "https://x" } }, links: { html: "https://x", download_location: "https://api.unsplash.com/dl" } },
          ],
          total: 1,
        }),
        text: async () => "{}",
      });
    }
    return origFetch(url, opts);
  };

  win.__providerBehavior = {
    unsplash: { delayMs: 10 },
    pixabay: { delayMs: 10, items: 0, total: 0 },
    pexels: { delayMs: 20 },
    wikimedia: { delayMs: 10, items: 0, total: 0 },
    openverse: { delayMs: 10, items: 0, total: 0 },
    doodl: { delayMs: 10, items: 0, total: 0 },
    shutterstock: { delayMs: 10, items: 0, total: 0 },
    pexafy: { delayMs: 10, items: 0, total: 0 },
  };

  doc.getElementById("searchInput").value = "dup test";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(150);

  const cards = doc.getElementById("grid").querySelectorAll(".card");
  console.log("Карточек (unsplash 1 + pexels 2, из них 1 с ИДЕНТИЧНЫМ full-URL что у unsplash):", cards.length);
  console.log("Ожидали 2 (дедуп уровня 1 должен убрать один из двух с https://x/shared/0-full.jpg)");

  let ok = true;
  if (cards.length !== 2) { console.error("FAIL: дедуп уровня 1 не сработал (или убрал лишнее)"); ok = false; }
  else console.log("OK: дедуп уровня 1 (точный URL) сработал корректно");

  // Проверим, что уровень 2 (pHash, без canvas в jsdom) не роняет страницу —
  // он просто не сможет посчитать хеш и должен тихо оставить фото как есть.
  await sleep(300);
  console.log("После доп. паузы (даём шанс фоновому pHash-проходу) карточек:", doc.getElementById("grid").querySelectorAll(".card").length);
  console.log("(страница не должна была упасть/выбросить необработанную ошибку — см. WINDOW ERROR выше, если была)");

  console.log(ok ? "\n=== TEST5 OK ===" : "\n=== TEST5 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
