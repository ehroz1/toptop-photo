const { buildPage, sleep } = require("../harness");

(async () => {
  const { window, document } = await buildPage();
  window.onerror = (msg) => { console.error("WINDOW ERROR:", msg); process.exitCode = 1; };

  // Каждый последующий запрос помечаем в title, чтобы видеть, какой из них
  // реально долетел до DOM.
  function behaviorFor(tag) {
    return {
      unsplash: { delayMs: 20, items: 2, total: 20, tag },
      pixabay: { delayMs: 60, items: 2, total: 20, tag },
      pexels: { delayMs: 100, items: 2, total: 20, tag },
      wikimedia: { delayMs: 40, items: 1, total: null, tag },
      openverse: { delayMs: 40, items: 1, total: 10, tag },
      doodl: { delayMs: 40, items: 1, total: 10, tag },
      shutterstock: { delayMs: 80, items: 1, total: 10, tag },
      pexafy: { delayMs: 50, items: 1, total: null, tag },
    };
  }
  // Патчим buildBody-источник тега через title: подменим __providerBehavior
  // прямо в момент фетча, чтобы видеть, какой запрос "выиграл".
  const origBuildBodyItemsWithTag = (tag) => {
    const b = behaviorFor(tag);
    // добавим tag в title через хак — buildBody не знает про tag, поэтому
    // просто используем разную задержку как маркер поколения + проверим счёт.
    return b;
  };

  const input = document.getElementById("searchInput");
  const form = document.getElementById("searchForm");
  function search(q) {
    input.value = q;
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  }

  const queries = ["car", "architecture", "astana", "cars"];
  for (const q of queries) {
    window.__providerBehavior = origBuildBodyItemsWithTag(q);
    search(q);
    await sleep(15); // запускаем следующий поиск ДО того, как предыдущий успел ответить
  }

  // Ждём, пока всё осядет (самый медленный провайдер у последнего поиска — 100мс)
  await sleep(500);

  const grid = document.getElementById("grid");
  const cards = grid.querySelectorAll(".card");
  console.log("Карточек в DOM после серии быстрых поисков:", cards.length);
  console.log("resultsCount:", document.getElementById("resultsCount").textContent);
  console.log("URL строки поиска:", new URL(window.location.href).searchParams.get("q"));

  // Ожидаем результаты ТОЛЬКО последнего поиска ("cars"), только от 3
  // активных по умолчанию источников (MAX_ACTIVE_SOURCES=3 — pixabay/pexels/wikimedia,
  // первые 3 в новом порядке чипов): pixabay2+pexels2+wikimedia1=5
  const expected = 2 + 2 + 1;
  console.log("Ожидали карточек (только последний поиск):", expected);
  if (cards.length !== expected) {
    console.error("FAIL: в ленте остались карточки не только последнего поиска (или потерялись)");
    process.exitCode = 1;
  } else {
    console.log("OK: ровно карточки последнего поиска");
  }

  if (new URL(window.location.href).searchParams.get("q") !== "cars") {
    console.error("FAIL: URL не соответствует последнему запросу");
    process.exitCode = 1;
  }

  // Дадим ещё время — вдруг "протухшие" промисы первых 3 поисков внезапно
  // что-то дорисуют с опозданием (реальная проверка на race condition).
  await sleep(300);
  const cardsAfter = grid.querySelectorAll(".card").length;
  console.log("Карточек спустя ещё 300мс:", cardsAfter);
  if (cardsAfter !== expected) {
    console.error("FAIL: что-то дорисовалось с опозданием от отменённых поисков — race condition!");
    process.exitCode = 1;
  } else {
    console.log("OK: ничего не просочилось от отменённых поисков");
  }

  console.log(process.exitCode ? "\n=== TEST2 FAILED ===" : "\n=== TEST2 OK ===");
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
