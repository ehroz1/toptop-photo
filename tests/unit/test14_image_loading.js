// Регрессия: после поиска, стёртого посреди загрузки превью, новый поиск
// показывал только "скелетоны" — прежняя очередь превью (3 слота) теряла
// слоты удалённых со страницы картинок и переставала грузить новые.
// jsdom никогда не присылает load/error для картинок, то есть здесь каждая
// картинка ведёт себя ровно как "застрявшая" — старая очередь выдавала бы
// src только первым трём.
const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };

  const search = async (q) => {
    doc.getElementById("searchInput").value = q;
    doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  };

  for (const q of ["cat", "cow", "owl"]) {
    await search(q);
    await sleep(40); // карточки есть, превью "в пути"
    doc.getElementById("clearBtn").dispatchEvent(new win.Event("click", { bubbles: true }));
    await sleep(10);
  }

  await search("dog");
  await sleep(120);
  const imgs = Array.from(doc.querySelectorAll("#grid .card img"));
  const withSrc = imgs.filter((img) => img.getAttribute("src"));
  console.log(`Карточек: ${imgs.length}, превью начали грузиться: ${withSrc.length}`);
  if (imgs.length === 0) { console.error("FAIL: после нового поиска нет карточек"); ok = false; }
  if (withSrc.length !== imgs.length) { console.error("FAIL: часть превью так и не начала грузиться (очередь заклинило)"); ok = false; }

  console.log(ok ? "\n=== TEST14 OK ===" : "\n=== TEST14 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
