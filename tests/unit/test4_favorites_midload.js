const { buildPage, sleep } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  // Источники с заметной задержкой — есть время переключиться на "Избранное"
  // прямо посреди загрузки. По умолчанию активны только первые 3 источника
  // (MAX_ACTIVE_SOURCES) в новом порядке чипов — pixabay/pexels/wikimedia —
  // остальные behavior-записи ниже не задействованы, но оставлены для
  // наглядности/на случай ручного дебага.
  win.__providerBehavior = {
    unsplash: { delayMs: 30, items: 3, total: 30 },
    pixabay: { delayMs: 70, items: 3, total: 30 },
    pexels: { delayMs: 100, items: 3, total: 30 },
    wikimedia: { delayMs: 15, items: 1, total: null },
    openverse: { delayMs: 40, items: 1, total: 10 },
    doodl: { delayMs: 40, items: 1, total: 10 },
    shutterstock: { delayMs: 50, items: 1, total: 10 },
    pexafy: { delayMs: 45, items: 1, total: null },
  };

  // Добавим фото в избранное кликом по сердечку на реальной карточке — это
  // по-настоящему пишет в state (а не подсовывает localStorage мимо кода).
  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(45); // wikimedia (15мс) давно отрисовался, pixabay/pexels (70/100мс) ещё в пути

  const gridEarly = doc.getElementById("grid");
  console.log("Карточек сразу после первого (самого быстрого) источника:", gridEarly.querySelectorAll(".card").length);

  const firstHeart = gridEarly.querySelector(".card-heart");
  if (firstHeart) firstHeart.dispatchEvent(new win.Event("click", { bubbles: true }));
  else console.warn("Не нашлось сердечка — возможно unsplash ещё не отрисовался");

  // Переключаемся в "Избранное" ПОСРЕДИ загрузки остальных источников (pexels
  // придёт только через 90мс, мы сейчас на 35мс).
  doc.getElementById("favoritesToggle").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(5);
  console.log("view после переключения — favoritesToggle pressed:", doc.getElementById("favoritesToggle").getAttribute("aria-pressed"));
  const gridInFavorites = doc.getElementById("grid").innerHTML;
  const favCardsNow = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("Карточек в сетке сразу после перехода в избранное:", favCardsNow, "(должно быть 1 — то самое лайкнутое фото)");

  // Ждём, пока ВСЕ источники исходного поиска доотвечают (в фоне)
  await sleep(150);

  const stillInFavorites = doc.getElementById("favoritesToggle").getAttribute("aria-pressed") === "true";
  const cardsAfterBackgroundSettle = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("Всё ещё в избранном:", stillInFavorites);
  console.log("Карточек в сетке избранного ПОСЛЕ того, как поиск в фоне доехал:", cardsAfterBackgroundSettle, "(должно остаться 1 — чужие карточки поиска не должны были влезть)");

  let ok = true;
  if (favCardsNow !== 1) { console.error("FAIL: сразу после перехода должна быть ровно 1 карточка избранного"); ok = false; }
  if (cardsAfterBackgroundSettle !== 1) { console.error("FAIL: фоновые карточки поиска просочились в сетку избранного!"); ok = false; }

  console.log("providerWarnings (не должны были перезаписаться поиском, т.к. вид не 'search'):", JSON.stringify(doc.getElementById("providerWarnings").textContent));

  // Возвращаемся в поиск — там должны быть ВСЕ карточки исходного поиска
  doc.getElementById("favoritesToggle").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(20);
  const cardsBackInSearch = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("Карточек после возврата в поиск:", cardsBackInSearch, "(ожидали pixabay3+pexels3+wikimedia1=7)");
  if (cardsBackInSearch !== 7) { console.error("FAIL: при возврате в поиск не все фоновые результаты оказались на месте"); ok = false; }
  else console.log("OK: все фоновые результаты корректно оказались в state.items и отрисовались при возврате");

  console.log(ok ? "\n=== TEST4 OK ===" : "\n=== TEST4 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
