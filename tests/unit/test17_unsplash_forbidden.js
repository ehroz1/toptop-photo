// Unsplash сообщает об исчерпанном часовом лимите ключа кодом 403 (а не
// 429). Сайт должен поставить источник на паузу и не обращаться к нему на
// каждом следующем поиске, а остальные источники — работать как обычно.
const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  setActiveSources(doc, win, ["pixabay", "unsplash"]);
  win.__providerBehavior = { unsplash: { delayMs: 5, status: 403 } };

  const search = async (q) => {
    doc.getElementById("searchInput").value = q;
    doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(120);
  };
  const unsplashCalls = () => win.__fetchLog.filter((u) => u.includes("/unsplash/search")).length;

  await search("cat");
  const warning = doc.getElementById("providerWarnings").textContent;
  console.log("Предупреждение:", warning);
  if (!/Unsplash/.test(warning) || !/30/.test(warning)) { console.error("FAIL: нет понятного сообщения о паузе Unsplash"); ok = false; }
  if (doc.querySelectorAll("#grid .card").length === 0) { console.error("FAIL: остальные источники тоже не показались"); ok = false; }
  const callsAfterFirst = unsplashCalls();

  await search("dog");
  console.log("Запросов к Unsplash: после 1-го поиска", callsAfterFirst, "| после 2-го", unsplashCalls());
  if (unsplashCalls() !== callsAfterFirst) { console.error("FAIL: Unsplash опрашивается снова, хотя должен быть на паузе"); ok = false; }
  if (doc.querySelectorAll("#grid .card").length === 0) { console.error("FAIL: второй поиск без результатов"); ok = false; }

  console.log(ok ? "\n=== TEST17 OK ===" : "\n=== TEST17 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
