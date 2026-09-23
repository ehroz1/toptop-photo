// Воркер не смог получить токен у источника (так было с Shutterstock:
// "HTTP 502 — shutterstock auth failed: oauth 400 {...}"). Вместо сырого
// JSON посетитель должен увидеть короткую понятную фразу, источник — уйти
// на паузу, а остальные источники — работать как обычно.
const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  setActiveSources(doc, win, ["pixabay", "shutterstock"]);
  win.__providerBehavior = {
    shutterstock: {
      delayMs: 5,
      status: 502,
      errorBody: { error: 'shutterstock auth failed: oauth 400 { "message": "Validation failed", "errors": [{ "code": "VALIDATION_OBJECT_REQUIRED" }] }' },
    },
  };

  const search = async (q) => {
    doc.getElementById("searchInput").value = q;
    doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(120);
  };
  const shutterstockCalls = () => win.__fetchLog.filter((u) => u.includes("/shutterstock")).length;

  await search("cat");
  const warning = doc.getElementById("providerWarnings").textContent;
  console.log("Предупреждение:", warning);
  if (!/Shutterstock/.test(warning) || !/30/.test(warning)) { console.error("FAIL: нет понятного сообщения о паузе Shutterstock"); ok = false; }
  if (/Validation|oauth|\{/.test(warning)) { console.error("FAIL: на экран попал сырой ответ сервера"); ok = false; }
  if (doc.querySelectorAll("#grid .card").length === 0) { console.error("FAIL: остальные источники тоже не показались"); ok = false; }
  const callsAfterFirst = shutterstockCalls();

  await search("dog");
  console.log("Запросов к Shutterstock: после 1-го поиска", callsAfterFirst, "| после 2-го", shutterstockCalls());
  if (shutterstockCalls() !== callsAfterFirst) { console.error("FAIL: Shutterstock опрашивается снова, хотя должен быть на паузе"); ok = false; }
  if (doc.querySelectorAll("#grid .card").length === 0) { console.error("FAIL: второй поиск без результатов"); ok = false; }

  console.log(ok ? "\n=== TEST18 OK ===" : "\n=== TEST18 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
