const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  win.__providerBehavior = {
    unsplash: { delayMs: 10, items: 2, total: 20 }, // отвечает сразу
    pixabay: { hang: true },                         // зависает — должен сработать таймаут (12с)
    pexels: { delayMs: 10, items: 0, total: 0 },
    wikimedia: { delayMs: 10, items: 0, total: 0 },
    openverse: { delayMs: 10, items: 0, total: 0 },
    doodl: { delayMs: 10, items: 0, total: 0 },
    shutterstock: { delayMs: 10, items: 0, total: 0 },
    pexafy: { delayMs: 10, items: 0, total: 0 },
  };
  // Явно активны именно unsplash (быстрый) и pixabay (зависает) — с
  // MAX_ACTIVE_SOURCES=3 unsplash больше не входит в дефолтную тройку.
  setActiveSources(doc, win, ["unsplash", "pixabay"]);

  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));

  await sleep(300);
  console.log("+300мс: карточек уже показано (не ждём Pixabay):", doc.getElementById("grid").querySelectorAll(".card").length, "(ожидали 2 — unsplash)");
  console.log("+300мс: loadMoreBtn всё ещё disabled (страница формально не 'settled', ждём Pixabay):", doc.getElementById("loadMoreBtn").disabled);

  console.log("Ждём ~12.5с реального таймаута Pixabay...");
  await sleep(12500);

  const warn = doc.getElementById("providerWarnings").textContent;
  console.log("providerWarnings после таймаута:", warn);
  console.log("loadMoreBtn disabled теперь:", doc.getElementById("loadMoreBtn").disabled);

  let ok = true;
  if (!warn.includes("Pixabay")) { console.error("FAIL: нет предупреждения о таймауте Pixabay"); ok = false; }
  if (doc.getElementById("loadMoreBtn").disabled) { console.error("FAIL: страница так и не 'settled' после таймаута — loading завис"); ok = false; }

  // Убедимся, что после таймаута поиск снова полностью работоспособен
  win.__providerBehavior = { unsplash: { delayMs: 5, items: 1, total: 10 } };
  setActiveSources(doc, win, ["unsplash"]);
  doc.getElementById("searchInput").value = "dog";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  const cardsAfter = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("Поиск после таймаута ('dog'):", cardsAfter, "карточек (ожидали 1)");
  if (cardsAfter !== 1) { console.error("FAIL: поиск после таймаута не работает"); ok = false; }

  console.log(ok ? "\n=== TEST6 OK ===" : "\n=== TEST6 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
