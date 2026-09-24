const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; ok = false; };

  // Попап должен быть СИБЛИНГОМ .toolbar-row-scroll, а не внутри него
  // (иначе overflow-x:auto на скролл-контейнере обрезает его по Y — это и
  // была причина бага "клик по Источники — попап не открывается").
  const wrap = doc.getElementById("sourcesMenuWrap");
  const scrollContainer = doc.querySelector(".toolbar-row-scroll");
  const isInsideScroll = scrollContainer.contains(wrap);
  console.log("sourcesMenuWrap внутри .toolbar-row-scroll:", isInsideScroll, "(должно быть false)");
  if (isInsideScroll) { console.error("FAIL: popover снова окажется обрезанным overflow скролл-контейнера"); ok = false; }

  const popover = doc.getElementById("sourcesMenuPopover");
  console.log("Popover изначально hidden:", popover.hidden, "(должно быть true)");
  if (!popover.hidden) { console.error("FAIL: popover не должен быть открыт по умолчанию"); ok = false; }

  // Клик по кнопке "Источники" открывает popover
  doc.getElementById("sourcesMenuToggle").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  console.log("Popover hidden после клика по 'Источники':", popover.hidden, "(должно быть false)");
  if (popover.hidden) { console.error("FAIL: popover не открылся по клику"); ok = false; }
  console.log("aria-expanded кнопки:", doc.getElementById("sourcesMenuToggle").getAttribute("aria-expanded"));
  if (doc.getElementById("sourcesMenuToggle").getAttribute("aria-expanded") !== "true") { console.error("FAIL: aria-expanded не обновился"); ok = false; }

  // Клик вне попапа закрывает его
  doc.body.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  console.log("Popover hidden после клика снаружи:", popover.hidden, "(должно быть true)");
  if (!popover.hidden) { console.error("FAIL: popover не закрылся по клику снаружи"); ok = false; }

  // Повторный клик по кнопке снова открывает
  doc.getElementById("sourcesMenuToggle").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (popover.hidden) { console.error("FAIL: повторный клик не открыл popover"); ok = false; }

  console.log(ok ? "\n=== TEST13 OK ===" : "\n=== TEST13 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
