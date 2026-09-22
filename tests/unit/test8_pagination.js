const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  win.__providerBehavior = { unsplash: { delayMs: 5, items: 5, total: 100 } };
  setActiveSources(doc, win, ["unsplash"]);

  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(60);
  let ok = true;
  const cardsFirstPage = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("После 1-й страницы карточек:", cardsFirstPage, "(ожидали 5)");
  console.log("loadMoreWrap hidden:", doc.getElementById("loadMoreWrap").hidden, "(должно быть false — total=100, ещё есть)");
  if (cardsFirstPage !== 5) { console.error("FAIL: неверное число карточек после 1-й страницы (источник не изолирован?)"); ok = false; }

  // Явный клик "Показать ещё"
  doc.getElementById("loadMoreBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(60);
  const cardsSecondPage = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("После клика 'Показать ещё' карточек:", cardsSecondPage, "(ожидали 10)");
  if (cardsSecondPage !== 10) { console.error("FAIL: неверное число карточек после 2-й страницы"); ok = false; }

  // Автоподгрузка через IntersectionObserver-заглушку: имитируем "рядом с экраном"
  win.__nearViewport = true;
  doc.getElementById("loadMoreBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(200);
  const cardsAfterAuto = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("После включения 'near viewport' + ещё один клик (автопродолжение до 3 раз) карточек:", cardsAfterAuto);
  console.log("(ожидали от 15 до 15+3*5=30, т.к. autoDepth ограничен тремя самозапусками)");

  const idsAll = Array.from(doc.getElementById("grid").querySelectorAll(".card")).map((c) => c.dataset.id);
  const uniqueAll = new Set(idsAll);
  console.log("Всего карточек:", idsAll.length, "уникальных:", uniqueAll.size);
  if (uniqueAll.size !== idsAll.length) { console.error("FAIL: дублирующиеся карточки между страницами пагинации"); ok = false; }
  if (cardsAfterAuto < 15) { console.error("FAIL: похоже пагинация вообще не сработала"); ok = false; }

  console.log(ok ? "\n=== TEST8 OK ===" : "\n=== TEST8 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
