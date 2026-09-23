const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  win.__providerBehavior = {
    unsplash: { delayMs: 60, items: 3, total: 30 },
    pixabay: { delayMs: 10, items: 0, total: 0 },
    pexels: { delayMs: 10, items: 0, total: 0 },
    wikimedia: { delayMs: 10, items: 0, total: 0 },
    openverse: { delayMs: 10, items: 0, total: 0 },
    doodl: { delayMs: 20, items: 2, total: 20 }, // проверим AI-бейдж
    shutterstock: { delayMs: 10, items: 0, total: 0 },
    pexafy: { delayMs: 10, items: 0, total: 0 },
  };
  // Явно активны unsplash (обычные фото) и doodl (AI) — ни один из них не
  // входит в дефолтную тройку MAX_ACTIVE_SOURCES (pixabay/pexels/wikimedia).
  setActiveSources(doc, win, ["unsplash", "doodl"]);

  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(30); // источники ещё летят (unsplash 60мс)

  // Меняем фильтр ПОСРЕДИ загрузки (как реальный пользователь).
  const orientationBtn = doc.querySelector('.dropdown[data-dropdown="orientation"] .dropdown-item[data-val="horizontal"]');
  orientationBtn.dispatchEvent(new win.Event("click", { bubbles: true }));

  await sleep(150);

  let ok = true;
  console.log("WINDOW ERROR не было (иначе см. выше)");
  const cards = doc.getElementById("grid").querySelectorAll(".card");
  console.log("Карточек после смены фильтра посреди загрузки:", cards.length);
  if (cards.length === 0) { console.error("FAIL: смена фильтра посреди загрузки сломала выдачу"); ok = false; }

  // AI-бейдж у карточек Doodl
  const doodlCard = Array.from(cards).find((c) => c.dataset.id.startsWith("doodl-"));
  if (!doodlCard) {
    console.error("FAIL: карточка Doodl не найдена (возможно, дедуп/фильтр её съел)");
    ok = false;
  } else {
    const aiBadge = doodlCard.querySelector(".card-ai-badge");
    console.log("AI-бейдж на карточке Doodl:", aiBadge ? aiBadge.textContent : "ОТСУТСТВУЕТ");
    if (!aiBadge) { console.error("FAIL: у Doodl нет AI-бейджа на карточке"); ok = false; }

    // Открываем лайтбокс — проверяем бейдж и там
    doodlCard.dispatchEvent(new win.Event("click", { bubbles: true }));
    await sleep(10);
    const lbAi = doc.getElementById("lbAiBadge");
    console.log("AI-бейдж в лайтбоксе hidden:", lbAi.hidden, "(должно быть false)");
    if (lbAi.hidden) { console.error("FAIL: AI-бейдж не показан в лайтбоксе для Doodl"); ok = false; }
    doc.getElementById("lightbox").querySelector("[data-close]").dispatchEvent(new win.Event("click", { bubbles: true }));

    // Не-AI карточка (unsplash) не должна иметь бейджа
    const unsplashCard = Array.from(cards).find((c) => c.dataset.id.startsWith("unsplash-"));
    if (unsplashCard) {
      const badgeOnReal = unsplashCard.querySelector(".card-ai-badge");
      console.log("AI-бейдж на карточке Unsplash (не должно быть):", badgeOnReal ? "ЕСТЬ (ошибка!)" : "отсутствует, верно");
      if (badgeOnReal) { console.error("FAIL: обычное фото Unsplash помечено как AI"); ok = false; }
    }
  }

  console.log(ok ? "\n=== TEST7 OK ===" : "\n=== TEST7 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
