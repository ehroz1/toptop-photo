// Регрессия: кнопка "Скачать" в окне просмотра фото (и клавиша D) ничего не
// делала — её обработчик был случайно удалён при редизайне.
const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  const opened = [];
  win.open = (url) => { opened.push(url); };

  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(80);
  const card = doc.querySelector("#grid .card");
  if (!card) { console.error("FAIL: нет карточек"); process.exit(1); }
  card.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (doc.getElementById("lightbox").hidden) { console.error("FAIL: лайтбокс не открылся"); ok = false; }

  const before = win.__fetchLog.length;
  doc.getElementById("lbDownload").click();
  await sleep(80);
  const newRequests = win.__fetchLog.slice(before);
  console.log("Запросы после клика 'Скачать':", newRequests);
  console.log("Открыто вкладок (запасной путь):", opened.length, "| toast:", doc.getElementById("toast").textContent);
  if (newRequests.length === 0 && opened.length === 0) { console.error("FAIL: кнопка 'Скачать' в лайтбоксе ничего не сделала"); ok = false; }

  const beforeKey = win.__fetchLog.length;
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "d", bubbles: true }));
  await sleep(80);
  if (win.__fetchLog.length === beforeKey && opened.length < 2) { console.error("FAIL: клавиша D в лайтбоксе ничего не сделала"); ok = false; }

  console.log(ok ? "\n=== TEST15 OK ===" : "\n=== TEST15 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
