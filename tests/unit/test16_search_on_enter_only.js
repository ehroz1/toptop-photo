// Поиск стартует только по Enter/кнопке поиска, а не по мере ввода.
const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  const input = doc.getElementById("searchInput");

  for (const partial of ["c", "ca", "cat"]) {
    input.value = partial;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await sleep(20);
  }
  await sleep(900); // дольше прежнего таймера (550 мс) — поиск не должен стартовать сам
  const cardsAfterTyping = doc.querySelectorAll("#grid .card").length;
  console.log("Запросов после набора текста:", win.__fetchLog.length, "| карточек:", cardsAfterTyping);
  if (win.__fetchLog.length !== 0 || cardsAfterTyping !== 0) { console.error("FAIL: поиск запустился без нажатия Enter"); ok = false; }
  if (doc.getElementById("clearBtn").hidden) { console.error("FAIL: кнопка очистки должна появиться при вводе"); ok = false; }

  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(100);
  const cards = doc.querySelectorAll("#grid .card").length;
  console.log("Карточек после Enter:", cards);
  if (cards === 0) { console.error("FAIL: Enter не запустил поиск"); ok = false; }

  console.log(ok ? "\n=== TEST16 OK ===" : "\n=== TEST16 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
