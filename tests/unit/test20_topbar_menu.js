// Шапка справа: «молния» (об авторе и контакты), профиль и меню.
//  - окна открываются по кнопке, одновременно открыто только одно, клик
//    мимо и Esc закрывают;
//  - в меню есть сохранённые фото, статистика, тема, донат; «выйти» видно
//    только вошедшему (пока вход выключен — никогда);
//  - «Сохранённые фото» работают из любого режима: из «Видео» переключают
//    на фото и открывают избранное;
//  - профиль при выключенном входе говорит, что регистрация скоро появится.
const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const fail = (msg) => { console.error("FAIL:", msg); ok = false; };
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  const $ = (id) => doc.getElementById(id);
  const click = (node) => node.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const openIds = () => ["aboutPopover", "authPopover", "mainMenu"].filter((id) => !$(id).hidden);

  // «Молния»
  click($("aboutToggle"));
  if (openIds().join() !== "aboutPopover") fail(`после клика по «молнии» открыто: ${openIds().join() || "ничего"}`);
  const contacts = [...doc.querySelectorAll("#aboutContacts a")].map((a) => `${a.textContent} ${a.href}`);
  console.log("Контакты:", contacts.join(" | "));
  for (const want of ["t.me/ehroz_dsgn", "instagram.com/ehroz1", "mailto:ehrozbekisharifzoda@gmail.com"]) {
    if (!contacts.some((c) => c.includes(want))) fail(`в контактах нет ${want} (APP_CONFIG.CONTACTS)`);
  }
  if (contacts.some((c) => c.includes("github.com"))) fail("GitHub должен быть убран из контактов");
  if (!/Picta/.test($("aboutPopover").textContent)) fail("в тексте «об авторе» нет названия Picta");

  // Профиль: второе окно закрывает первое
  click($("authToggle"));
  if (openIds().join() !== "authPopover") fail(`окно профиля должно заменить «молнию», открыто: ${openIds().join()}`);
  if ($("authSoon").hidden || !$("authLoggedOut").hidden) fail("при выключенном входе профиль должен говорить «скоро», без формы входа");

  // Клик мимо закрывает
  click(doc.body);
  if (openIds().length) fail(`клик мимо не закрыл окно: ${openIds().join()}`);

  // Меню
  click($("mainMenuToggle"));
  if (openIds().join() !== "mainMenu") fail("меню не открылось");
  if ($("mainMenuToggle").getAttribute("aria-expanded") !== "true") fail("у кнопки меню aria-expanded не true");
  for (const id of ["favoritesToggle", "insightsToggle", "themeToggle", "donateLink"]) {
    if ($(id).hidden || !$("mainMenu").contains($(id))) fail(`в меню нет пункта #${id}`);
  }
  if (!$("authSignOutBtn").hidden) fail("«Выйти из аккаунта» видно, хотя никто не вошёл");
  if (!$("themeModeLabel").textContent) fail("у пункта «Тема» не подписан текущий режим");

  // Статистика раскрывается внутри меню, меню при этом не закрывается
  click($("insightsToggle"));
  if ($("insightsPanel").hidden || !/Unsplash/.test($("insightsPanel").textContent)) fail("статистика не раскрылась в меню");
  if ($("mainMenu").hidden) fail("клик по «Статистике» закрыл меню");

  // Тема: пункт меню переключает режим и меню не закрывает
  const modeBefore = doc.documentElement.getAttribute("data-theme-mode");
  click($("themeToggle"));
  await sleep(20);
  const modeAfter = doc.documentElement.getAttribute("data-theme-mode");
  console.log("Тема:", modeBefore, "→", modeAfter, "| подпись:", $("themeModeLabel").textContent);
  if (modeBefore === modeAfter) fail("пункт «Тема» не переключил режим");
  if ($("mainMenu").hidden) fail("переключение темы закрыло меню");

  // Донат без ссылки — понятное сообщение, а не переход по "#"
  click($("donateLink"));
  await sleep(20);
  if (!/скоро|soon/i.test($("toast").textContent)) fail(`донат без ссылки: нет сообщения «скоро» (тост: "${$("toast").textContent}")`);

  // Esc закрывает меню, статистика сворачивается вместе с ним
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  if (!$("mainMenu").hidden) fail("Esc не закрыл меню");
  if (!$("insightsPanel").hidden) fail("статистика осталась раскрытой после закрытия меню");

  // «Сохранённые фото» из режима «Видео»
  click(doc.querySelector('.mode-tab[data-mode="video"]'));
  await sleep(10);
  click($("mainMenuToggle"));
  click($("favoritesToggle"));
  await sleep(10);
  const photosActive = doc.querySelector('.mode-tab[data-mode="photos"]').classList.contains("is-active");
  console.log("После «Сохранённые фото» из видео: фото-режим", photosActive, "| избранное", $("favoritesToggle").getAttribute("aria-pressed"));
  if (!photosActive) fail("«Сохранённые фото» из режима «Видео» не переключили на фото");
  if ($("favoritesToggle").getAttribute("aria-pressed") !== "true") fail("избранное не открылось");
  if ($("favoritesEmpty").hidden) fail("пустое избранное: нет подсказки «Пока пусто»");
  if (!$("mainMenu").hidden) fail("меню не закрылось после выбора «Сохранённые фото»");

  // «Наверх» по умолчанию невидима и не ловит фокус
  if ($("backToTop").classList.contains("is-visible") || $("backToTop").tabIndex !== -1) fail("кнопка «Наверх» видна без прокрутки");

  console.log(ok ? "\n=== TEST20 OK ===" : "\n=== TEST20 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
