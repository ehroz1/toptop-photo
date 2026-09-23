const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window, document } = await buildPage();
  window.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  window.__providerBehavior = {
    unsplash: { delayMs: 10, items: 3, total: 30 },       // OK
    pixabay: { delayMs: 10, status: 429, items: 0 },       // rate limit
    pexels: { delayMs: 10, status: 401, items: 0 },        // auth error
    wikimedia: { delayMs: 10, status: 500, items: 0 },     // server error
    openverse: { delayMs: 10, throwNetwork: true },        // network error
    doodl: { delayMs: 10, items: 0, total: 0 },            // пустой ответ, без ошибки
    shutterstock: { delayMs: 10, items: 0, total: 0 },     // тоже пустой (таймаут — отдельный тест, см. test4)
    pexafy: { delayMs: 10, items: 2, total: 20 },          // OK
  };

  // MAX_ACTIVE_SOURCES=3 — одновременно активны не больше трёх источников,
  // поэтому ошибки проверяем в двух раундах по 3 разных провайдера вместо
  // одного захода на все 8 (раньше, до лимита, это было возможно одним).
  let ok = true;

  setActiveSources(document, window, ["unsplash", "pixabay", "pexels"]);
  document.getElementById("searchInput").value = "cat";
  document.getElementById("searchForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(200);
  let cards = document.getElementById("grid").querySelectorAll(".card").length;
  let warn = document.getElementById("providerWarnings").textContent;
  console.log("Раунд 1 (unsplash OK, pixabay 429, pexels 401) — карточек:", cards, "(ожидали 3)");
  console.log("providerWarnings:", warn);
  if (cards !== 3) { console.error("FAIL: ожидали 3 карточки (только unsplash)"); ok = false; }
  if (!warn.includes("Pixabay")) { console.error("FAIL: нет предупреждения про Pixabay (429)"); ok = false; }
  if (!warn.includes("Pexels")) { console.error("FAIL: нет предупреждения про Pexels (401)"); ok = false; }

  setActiveSources(document, window, ["wikimedia", "openverse", "doodl"]);
  document.getElementById("searchInput").value = "cat2";
  document.getElementById("searchForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(200);
  cards = document.getElementById("grid").querySelectorAll(".card").length;
  warn = document.getElementById("providerWarnings").textContent;
  console.log("Раунд 2 (wikimedia 500, openverse network, doodl пусто) — карточек:", cards, "(ожидали 0)");
  console.log("providerWarnings:", warn);
  if (cards !== 0) { console.error("FAIL: ожидали 0 карточек во втором раунде"); ok = false; }
  if (!warn.includes("Wikimedia")) { console.error("FAIL: нет предупреждения про Wikimedia (500)"); ok = false; }
  if (!warn.includes("Openverse")) { console.error("FAIL: нет предупреждения про Openverse (network)"); ok = false; }
  // Сетевой сбой — понятной фразой, без технического "сеть/CORS (Load failed)"
  if (/CORS|network down/.test(warn)) { console.error("FAIL: на экран попал технический текст сетевой ошибки"); ok = false; }
  if (!/нет связи|can't reach/.test(warn)) { console.error("FAIL: нет понятной фразы про отсутствие связи"); ok = false; }
  console.log(warn.includes("Doodl") ? "странно: Doodl тоже в предупреждениях (не должно, это просто пусто)" : "OK: Doodl (пустой ответ без ошибки) не считается предупреждением");

  console.log(ok ? "\n=== TEST3 OK (раунды с ошибками) ===" : "\n=== TEST3 FAILED (раунды с ошибками) ===");
  if (!ok) process.exitCode = 1;

  // Теперь проверим, что поиск после этого всё ещё работает (не залип)
  window.__providerBehavior = { unsplash: { delayMs: 5, items: 1, total: 10 } };
  setActiveSources(document, window, ["unsplash"]);
  document.getElementById("searchInput").value = "dog";
  document.getElementById("searchForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  const cardsAfter = document.getElementById("grid").querySelectorAll(".card").length;
  console.log("После серии ошибок — новый поиск ('dog', только unsplash) карточек:", cardsAfter, "(ожидали 1)");
  if (cardsAfter !== 1) { console.error("FAIL: поиск после ошибок предыдущего не работает — похоже на deadlock"); process.exitCode = 1; }
  else console.log("OK: поиск после серии ошибок не залип");
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
