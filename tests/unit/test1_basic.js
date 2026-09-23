const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window, document } = await buildPage();
  window.onerror = (msg) => { console.error("WINDOW ERROR:", msg); process.exitCode = 1; };

  // Разный вес/задержка у источников — Unsplash отвечает почти мгновенно,
  // Pexels медленно, чтобы проверить прогрессивный рендер. С MAX_ACTIVE_SOURCES=3
  // одновременно может быть активно не больше трёх источников — явно
  // выбираем именно эти три (клики, как настоящий пользователь).
  window.__providerBehavior = {
    unsplash: { delayMs: 5, items: 4, total: 40 },
    pixabay: { delayMs: 50, items: 4, total: 40 },
    pexels: { delayMs: 100, items: 4, total: 40 },
    wikimedia: { delayMs: 30, items: 2, total: null },
    openverse: { delayMs: 30, items: 2, total: 20 },
    doodl: { delayMs: 30, items: 2, total: 20 },
    flickr: { delayMs: 30, items: 0, total: 0 }, // выключен по умолчанию (нет ключа)
    shutterstock: { delayMs: 60, items: 3, total: 30 },
    pexafy: { delayMs: 40, items: 3, total: null },
  };
  setActiveSources(document, window, ["unsplash", "pixabay", "pexels"]);

  document.getElementById("searchInput").value = "cat";
  // app.js — замкнутая IIFE, внутренних функций снаружи нет: как реальный
  // пользователь, отправляем форму (submit) — тот же путь, что Enter/клик.
  document.getElementById("searchForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await sleep(400); // с запасом больше самого медленного (100мс) + таймауты

  const grid = document.getElementById("grid");
  const cards = grid.querySelectorAll(".card");
  console.log("Карточек в DOM:", cards.length);
  console.log("resultsCount:", document.getElementById("resultsCount").textContent);
  console.log("noResults hidden:", document.getElementById("noResults").hidden);
  console.log("loadMoreWrap hidden:", document.getElementById("loadMoreWrap").hidden);
  console.log("providerWarnings:", JSON.stringify(document.getElementById("providerWarnings").textContent));

  // Ожидаем карточки только от явно выбранных 3 источников: unsplash4+pixabay4+pexels4
  const expected = 4 + 4 + 4;
  console.log("Ожидали карточек:", expected);

  if (cards.length !== expected) {
    console.error("FAIL: неверное число карточек");
    process.exitCode = 1;
  } else {
    console.log("OK: число карточек совпало");
  }

  // Проверка на дубликаты data-id
  const ids = Array.from(cards).map((c) => c.dataset.id);
  const uniqueIds = new Set(ids);
  console.log("Уникальных id:", uniqueIds.size, "из", ids.length);
  if (uniqueIds.size !== ids.length) {
    console.error("FAIL: дублирующиеся id в DOM");
    process.exitCode = 1;
  }

  // Проверка порядка DOM == state.items (доступ к state не экспортирован, но
  // проверим через клик по карточке -> лайтбокс открывает верное фото)
  const firstCard = cards[0];
  const firstId = firstCard.dataset.id;
  firstCard.dispatchEvent(new window.Event("click", { bubbles: true }));
  await sleep(10);
  const lbTitle = document.getElementById("lbTitle").textContent;
  console.log("Клик по первой карточке (id=" + firstId + "), лайтбокс title:", lbTitle);
  const expectedTitlePrefix = firstId.split("-")[0];
  if (!lbTitle.includes(expectedTitlePrefix) && !lbTitle.includes("item")) {
    console.warn("Заголовок не похож на ожидаемый (не обязательно фатально):", lbTitle);
  }
  console.log(document.getElementById("lightbox").hidden ? "FAIL: лайтбокс не открылся" : "OK: лайтбокс открылся");
  if (document.getElementById("lightbox").hidden) process.exitCode = 1;

  console.log(process.exitCode ? "\n=== TEST1 FAILED ===" : "\n=== TEST1 OK ===");
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
