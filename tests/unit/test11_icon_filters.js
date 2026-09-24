const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; ok = false; };

  // Сервер (мок) намеренно НЕ уважает prefixes/palette по умолчанию —
  // проверяем именно клиентский safety-net фильтр в loadIconPage.
  win.__iconifyBehavior = { delayMs: 5 };

  // ---- Переключаемся в режим "Иконки" ----
  doc.querySelector('.mode-tab[data-mode="icons"]').dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (doc.getElementById("iconSources").hidden) { console.error("FAIL: iconSources должен быть виден в режиме иконок"); ok = false; }
  if (doc.getElementById("sourcesRow").hidden !== true) { console.error("FAIL: фото-sources должен быть скрыт в режиме иконок"); ok = false; }
  if (doc.getElementById("iconFiltersRow").hidden) { console.error("FAIL: iconFiltersRow должен быть виден в режиме иконок"); ok = false; }

  function cardPrefixes() {
    return Array.from(doc.getElementById("iconGrid").querySelectorAll(".icon-card-source-badge")).map((n) => n.textContent);
  }

  // ---- 1. Базовый поиск иконок без фильтров — должны прийти все наборы ----
  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(60);
  console.log("Без фильтров, наборы карточек в гриде:", cardPrefixes().join(", "));
  if (doc.getElementById("iconGrid").hidden) { console.error("FAIL: iconGrid скрыт после успешного поиска"); ok = false; }
  if (new Set(cardPrefixes()).size < 2) { console.error("FAIL: без фильтра ожидали иконки из нескольких разных наборов"); ok = false; }

  // ---- 2. Выбираем источник (набор) mdi — сужает выдачу ----
  const mdiChip = doc.querySelector('#iconSources [data-icon-source="mdi"]');
  mdiChip.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(60);
  if (mdiChip.getAttribute("aria-pressed") !== "true") { console.error("FAIL: чип mdi не стал активным по клику"); ok = false; }
  const prefixesAfterMdi = cardPrefixes();
  console.log("После выбора набора mdi, наборы карточек:", prefixesAfterMdi.join(", "));
  // Мок НЕ уважает prefixes на сервере -> если бы клиентский safety-net
  // фильтр (см. loadIconPage в app.js) не работал, тут были бы и другие
  // наборы, а не только mdi.
  if (prefixesAfterMdi.length === 0 || prefixesAfterMdi.some((p) => p !== "mdi")) {
    console.error("FAIL: клиентский фильтр по выбранному набору mdi не сработал"); ok = false;
  }

  // ---- 3. Пытаемся выбрать ещё 3 набора (итого 4-й клик должен блокироваться тостом) ----
  ["tabler", "ph", "bi"].forEach((id) => {
    doc.querySelector(`#iconSources [data-icon-source="${id}"]`).dispatchEvent(new win.Event("click", { bubbles: true }));
  });
  await sleep(60);
  let activeIconChips = Array.from(doc.querySelectorAll('#iconSources [data-icon-source]')).filter((c) => c.getAttribute("aria-pressed") === "true");
  console.log("Активные наборы иконок после 4 кликов подряд:", activeIconChips.map((c) => c.dataset.iconSource).join(", "));
  if (activeIconChips.length !== 3) { console.error("FAIL: должно остаться ровно 3 активных набора (лимит), а не", activeIconChips.length); ok = false; }
  const toastText = doc.getElementById("toast").textContent;
  if (!/3/.test(toastText)) { console.error("FAIL: тост о лимите источников иконок не показан"); ok = false; }

  // ---- 4. Снимаем выбор источников — снова "все наборы" (0 = valid) ----
  activeIconChips.forEach((c) => c.dispatchEvent(new win.Event("click", { bubbles: true })));
  await sleep(60);
  const stillActive = Array.from(doc.querySelectorAll('#iconSources [data-icon-source]')).filter((c) => c.getAttribute("aria-pressed") === "true");
  console.log("После снятия всех чипов наборов, активно:", stillActive.length, "(0 — валидно для иконок, не как у фото)");
  if (stillActive.length !== 0) { console.error("FAIL: должно быть можно снять все чипы иконок (0 = без ограничения)"); ok = false; }

  // ---- 5. Фильтр стиля: выбираем "Цветные" — twemoji:cat (palette:true) должен остаться, mdi/tabler/ph/simple-icons (palette:false) отсеяны ----
  doc.getElementById("iconFiltersToggle").dispatchEvent(new win.Event("click", { bubbles: true }));
  const styleDropdownBtn = doc.querySelector('.dropdown[data-dropdown="iconStyle"] .dropdown-btn');
  styleDropdownBtn.dispatchEvent(new win.Event("click", { bubbles: true }));
  const colorItem = doc.querySelector('.dropdown[data-dropdown="iconStyle"] .dropdown-item[data-val="color"]');
  colorItem.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(80);
  const prefixesAfterColor = cardPrefixes();
  console.log("После фильтра 'Цветные', наборы карточек:", prefixesAfterColor.join(", "), "(ожидали только twemoji — единственный цветной в тестовом пуле)");
  if (prefixesAfterColor.length === 0 || prefixesAfterColor.some((p) => p !== "twemoji")) {
    console.error("FAIL: фильтр стиля 'Цветные' не отсеял одноцветные наборы"); ok = false;
  }
  const badgeShown = !doc.getElementById("iconFiltersBadge").hidden;
  console.log("Бейдж фильтров иконок показан:", badgeShown, ", текст:", doc.getElementById("iconFiltersBadge").textContent);
  if (!badgeShown) { console.error("FAIL: бейдж активных фильтров иконок должен быть виден после выбора стиля"); ok = false; }

  // ---- 6. Persisted: перезагрузка должна вспомнить iconStyle=color ----
  const savedIconFilters = JSON.parse(win.localStorage.getItem("photoseek-icon-filters") || "null");
  console.log("Сохранённые iconFilters:", JSON.stringify(savedIconFilters));
  if (!savedIconFilters || savedIconFilters.iconStyle !== "color") { console.error("FAIL: iconStyle=color не сохранился в localStorage"); ok = false; }

  console.log(ok ? "\n=== TEST11 OK ===" : "\n=== TEST11 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
