// Режим «Цвета» (как picular.co): палитра из главных цветов первых фото.
const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  let ok = true;
  const fail = (msg) => { console.error("FAIL:", msg); ok = false; };
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  const C = win.PictaColors;

  // ---- 1. Выбор главного цвета ----
  function pixels(parts) {
    const out = [];
    for (const [n, rgb] of parts) for (let i = 0; i < n; i++) out.push(...rgb, 255);
    return out;
  }
  const red = C.toHex(C.dominantColor(pixels([[600, [220, 30, 40]], [424, [128, 128, 128]]])));
  if (red !== "#DC1E28") fail(`ожидали красный #DC1E28, получили ${red}`);
  // Насыщенный цвет предмета побеждает чуть больший по площади серый фон.
  const banana = C.toHex(C.dominantColor(pixels([[400, [240, 210, 50]], [550, [200, 200, 200]], [74, [5, 5, 5]]])));
  if (banana !== "#F0D232") fail(`ожидали жёлтый #F0D232, получили ${banana}`);
  // Но белый снег, занимающий почти всё фото, остаётся белым.
  const snow = C.toHex(C.dominantColor(pixels([[900, [250, 250, 250]], [124, [60, 120, 200]]])));
  if (snow !== "#FAFAFA") fail(`ожидали белый #FAFAFA, получили ${snow}`);
  if (C.dominantColor(pixels([[10, [1, 2, 3]]]).map((v, i) => (i % 4 === 3 ? 0 : v))) !== null) fail("полностью прозрачная картинка должна давать null");
  if (!C.isLight("#F0D232") || C.isLight("#1A2B6C")) fail("isLight ошибается");
  if (!(C.distance("#CAA327", "#CAA328") < 16) || !(C.distance("#CAA327", "#E3B505") > 16)) fail("distance ошибается");

  // ---- 2. Переключение в режим «Цвета» ----
  setActiveSources(doc, win, ["pixabay", "pexels"]);
  doc.querySelector('.mode-tab[data-mode="colors"]').dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  for (const id of ["sourcesMenuWrap", "filtersRow", "iconSources", "videoSources", "selectModeToggle"]) {
    if (!doc.getElementById(id).hidden) fail(`#${id} должен быть скрыт в режиме «Цвета»`);
  }
  if (doc.getElementById("heroP").textContent !== win.I18N.t("home_tagline_colors")) fail("подзаголовок главной не сменился");
  const chips = Array.from(doc.querySelectorAll("#suggestions .suggestion-chip")).map((c) => c.textContent);
  if (chips.join() !== win.I18N.t("suggestions_colors").join()) fail("подсказки не для режима «Цвета»");

  // ---- 3. Поиск: плитки по одной на фото, без неудачных и повторов цвета ----
  const calls = [];
  C.colorFromImageUrl = async (url) => {
    calls.push(url);
    await sleep(5);
    if (url.endsWith("/1.jpg") || url.includes("/1/")) throw new Error("cors");
    if (url.includes("/2/") || url.endsWith("/2.jpg")) return "#112233";
    const h = url.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return "#" + (h % 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  };
  let clipboard = null;
  Object.defineProperty(win.navigator, "clipboard", { value: { writeText: async (t) => { clipboard = t; } }, configurable: true });

  doc.getElementById("searchInput").value = "банан";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(200);
  const grid = doc.getElementById("colorGrid");
  const tiles = Array.from(grid.querySelectorAll(".color-tile:not([data-skeleton])"));
  const failed = calls.filter((u) => u.endsWith("/1.jpg") || u.includes("/1/")).length;
  const dupColor = calls.filter((u) => u.includes("/2/") || u.endsWith("/2.jpg")).length;
  console.log("Превью проверено:", calls.length, "| плиток:", tiles.length, "| не скачалось:", failed, "| того же цвета:", dupColor);
  if (grid.hidden) fail("сетка цветов скрыта после поиска");
  if (calls.length === 0) fail("цвета не считались");
  if (tiles.length !== calls.length - failed - Math.max(0, dupColor - 1)) fail("неверное число плиток");
  if (grid.querySelector('[data-skeleton="1"]')) fail("остались заглушки после загрузки");
  if (!doc.getElementById("emptyState").hidden) fail("главный экран не скрылся");
  if (!/\d/.test(doc.getElementById("resultsCount").textContent)) fail("нет счётчика цветов");
  if (!win.location.search.includes("mode=colors")) fail(`в адресе нет mode=colors: ${win.location.search}`);
  const hexes = tiles.map((t) => t.dataset.hex);
  if (hexes.some((h, i) => hexes.some((g, j) => j !== i && C.distance(h, g) < 16))) fail("почти одинаковые цвета не схлопнуты");

  // ---- 4. Клик копирует код цвета ----
  tiles[0].dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (clipboard !== tiles[0].dataset.hex) fail(`скопировано ${clipboard}, ожидали ${tiles[0].dataset.hex}`);
  if (!doc.getElementById("toast").textContent.includes(tiles[0].dataset.hex)) fail("тост не показал код цвета");
  if (tiles[0].querySelector(".color-tile-hex").textContent !== win.I18N.t("color_copied")) fail("плитка не показала «Скопировано»");

  // ---- 5. Устаревший поиск не дописывает плитки в новый ----
  C.colorFromImageUrl = async (url) => { await sleep(url.includes("pixabay") ? 80 : 5); return "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0"); };
  doc.getElementById("searchInput").value = "лес";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(30);
  win.__providerBehavior = { pixabay: { delayMs: 10, items: 0, total: 0 }, pexels: { delayMs: 10, items: 0, total: 0 } };
  doc.getElementById("searchInput").value = "пустота";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(250);
  const leftover = grid.querySelectorAll(".color-tile:not([data-skeleton])").length;
  if (leftover !== 0) fail(`после пустого поиска остались плитки старого: ${leftover}`);
  if (doc.getElementById("colorNoResults").hidden) fail("не показано «Ничего не найдено»");

  // ---- 6. Возврат в «Фото» убирает палитру ----
  win.__providerBehavior = {};
  doc.querySelector('.mode-tab[data-mode="photos"]').dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(100);
  if (!grid.hidden || grid.children.length) fail("палитра не убрана при переходе в «Фото»");
  if (!doc.getElementById("colorNoResults").hidden) fail("«Ничего не найдено» цветов осталось в «Фото»");
  if (doc.querySelectorAll("#grid .card").length === 0) fail("фото-поиск не запустился после смены режима");

  console.log(ok ? "\n=== TEST23 OK ===" : "\n=== TEST23 FAILED ===");
  if (!ok) process.exitCode = 1;
  process.exit();
})();
