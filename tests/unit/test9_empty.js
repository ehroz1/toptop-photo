const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; };

  win.__providerBehavior = { unsplash: { delayMs: 40, items: 3, total: 30 } };
  setActiveSources(doc, win, ["unsplash"]);

  // 1. Пустой запрос сразу (ничего не должно упасть)
  doc.getElementById("searchInput").value = "";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(20);
  console.log("Пустой запрос сразу: карточек =", doc.getElementById("grid").querySelectorAll(".card").length, ", emptyState hidden =", doc.getElementById("emptyState").hidden);

  // 2. Запрос без результатов
  win.__providerBehavior = { unsplash: { delayMs: 10, items: 0, total: 0 } };
  doc.getElementById("searchInput").value = "zzznonexistentzzz";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
  console.log("Запрос без результатов: noResults hidden =", doc.getElementById("noResults").hidden, "(должно быть false)");

  // 3. Поиск, потом очистка ПОСРЕДИ загрузки (клик по clearBtn)
  win.__providerBehavior = { unsplash: { delayMs: 100, items: 3, total: 30 } };
  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(20); // источник ещё не ответил (100мс)
  doc.getElementById("clearBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(150); // даём шанс "старому" fetch долететь, если бы не был отменён

  let ok = true;
  const cardsAfterClear = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("После очистки посреди загрузки: карточек =", cardsAfterClear, "(должно быть 0)");
  console.log("grid hidden =", doc.getElementById("grid").hidden, ", emptyState hidden =", doc.getElementById("emptyState").hidden);
  if (cardsAfterClear !== 0) { console.error("FAIL: после очистки посреди загрузки всё равно прилетели карточки"); ok = false; }
  if (doc.getElementById("loadMoreBtn").disabled) { console.error("FAIL: loading завис после очистки"); ok = false; }

  // 4. И поиск после всего этого всё ещё работает
  win.__providerBehavior = { unsplash: { delayMs: 5, items: 2, total: 20 } };
  doc.getElementById("searchInput").value = "final";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(50);
  const finalCards = doc.getElementById("grid").querySelectorAll(".card").length;
  console.log("Финальный поиск после всей серии: карточек =", finalCards, "(ожидали 2)");
  if (finalCards !== 2) { console.error("FAIL: финальный поиск не работает"); ok = false; }

  console.log(ok ? "\n=== TEST9 OK ===" : "\n=== TEST9 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
