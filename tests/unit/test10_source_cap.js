const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;

  // ---- 1. Свежий пользователь: порядок чекбоксов + дефолт "первые 3 включённых" ----
  {
    const { window: win, document: doc } = await buildPage();
    win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; ok = false; };

    // Фото-источники теперь чекбоксы в popover "Источники" (id="sources"),
    // а не отдельные всегда видимые кнопки-пилюли.
    const chips = Array.from(doc.querySelectorAll('#sources input.source-checkbox[data-source]'));
    const order = chips.map((c) => c.dataset.source);
    const expectedOrder = ["pixabay", "pexels", "wikimedia", "openverse", "doodl", "unsplash", "shutterstock", "pexafy", "flickr"];
    console.log("Порядок чекбоксов:", order.join(", "));
    if (order.join(",") !== expectedOrder.join(",")) { console.error("FAIL: порядок чекбоксов источников не совпадает с требуемым"); ok = false; }

    const active = chips.filter((c) => c.checked).map((c) => c.dataset.source);
    console.log("Активные по умолчанию:", active.join(", "), "(ожидали ровно 3, первые в порядке чипов)");
    if (active.length !== 3) { console.error("FAIL: по умолчанию должно быть активно ровно 3 источника, а не", active.length); ok = false; }
    if (active.join(",") !== expectedOrder.slice(0, 3).join(",")) { console.error("FAIL: активны не те 3 источника"); ok = false; }

    // Бейдж на кнопке "Источники" отражает число активных
    const badge = doc.getElementById("sourcesMenuBadge").textContent;
    console.log("Бейдж на кнопке 'Источники':", badge, "(ожидали 3)");
    if (badge !== "3") { console.error("FAIL: бейдж кнопки 'Источники' не совпадает с числом активных"); ok = false; }

    // ---- 2. Попытка включить 4-й — блокируется, показывается тост ----
    const fourthChip = chips.find((c) => c.dataset.source === "openverse");
    fourthChip.click();
    await sleep(10);
    const activeAfter = chips.filter((c) => c.checked).map((c) => c.dataset.source);
    console.log("После попытки включить 4-й (openverse):", activeAfter.join(", "));
    if (activeAfter.length !== 3 || activeAfter.includes("openverse")) { console.error("FAIL: разрешило включить больше 3 источников"); ok = false; }
    if (fourthChip.checked) { console.error("FAIL: чекбокс 4-го источника остался отмеченным после блокировки"); ok = false; }
    const toastText = doc.getElementById("toast").textContent;
    console.log("Текст тоста:", JSON.stringify(toastText));
    if (!/3/.test(toastText)) { console.error("FAIL: тост не объясняет лимит"); ok = false; }

    // ---- 3. Выключить один, включить другой — должно сработать ----
    const pexelsChip = chips.find((c) => c.dataset.source === "pexels");
    pexelsChip.click(); // выключаем pexels
    await sleep(10);
    fourthChip.click(); // включаем openverse
    await sleep(10);
    const activeNow = chips.filter((c) => c.checked).map((c) => c.dataset.source);
    console.log("После замены pexels -> openverse:", activeNow.join(", "));
    if (activeNow.length !== 3 || !activeNow.includes("openverse") || activeNow.includes("pexels")) {
      console.error("FAIL: замена активного источника не сработала как надо"); ok = false;
    }

    // ---- 4. Нельзя выключить последний активный источник (старое правило min 1) ----
    const remaining = chips.filter((c) => c.checked);
    remaining.forEach((c) => c.click());
    await sleep(10);
    const activeMin = chips.filter((c) => c.checked);
    console.log("После попытки выключить все активные источники подряд: осталось", activeMin.length, "(должно быть >= 1)");
    if (activeMin.length < 1) { console.error("FAIL: можно было выключить все источники разом"); ok = false; }
  }

  // ---- 5. Миграция: старый localStorage с 8 активными источниками подрезается до 3 ----
  {
    const { window: win, document: doc } = await buildPage({
      seedLocalStorage: { "photoseek-filters": { disabledSources: ["flickr"] } },
    });
    win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; ok = false; };
    const chips = Array.from(doc.querySelectorAll('#sources input.source-checkbox[data-source]'));
    const active = chips.filter((c) => c.checked).map((c) => c.dataset.source);
    console.log("Миграция со старого (8 активных) localStorage -> активны:", active.join(", "));
    if (active.length !== 3) { console.error("FAIL: миграция не подрезала до 3 активных источников"); ok = false; }
    const saved = JSON.parse(win.localStorage.getItem("photoseek-filters"));
    const disabledCount = (saved.disabledSources || []).length;
    // FLICKR_ENABLED=false в js/config.js этой песочницы -> чекбокс Flickr
    // скрыт и вообще не участвует в подсчёте видимых/активных источников
    // (см. "источник без ключа — недоступен, не трогаем" в loadPersistedFilters).
    // Видимых источников 8, значит после подрезки до 3 отключённых будет 5.
    console.log("Пересохранённых disabledSources:", disabledCount, "(ожидали 5 = 8 видимых - 3)");
    if (disabledCount !== 5) { console.error("FAIL: исправленный список отключённых источников не пересохранился"); ok = false; }
  }

  console.log(ok ? "\n=== TEST10 OK ===" : "\n=== TEST10 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
