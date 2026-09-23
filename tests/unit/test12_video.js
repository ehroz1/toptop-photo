const { buildPage, sleep, setActiveSources } = require("../harness");

(async () => {
  let ok = true;
  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); process.exitCode = 1; ok = false; };

  // ---- 1. Переключение в режим "Видео" ----
  doc.querySelector('.mode-tab[data-mode="video"]').dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (doc.getElementById("videoSources").hidden) { console.error("FAIL: videoSources должен быть виден в режиме видео"); ok = false; }
  if (!doc.getElementById("sourcesRow").hidden) { console.error("FAIL: фото-sources должен быть скрыт в режиме видео"); ok = false; }
  if (!doc.getElementById("iconSources").hidden) { console.error("FAIL: iconSources должен быть скрыт в режиме видео"); ok = false; }
  if (doc.getElementById("videoFiltersRow").hidden) { console.error("FAIL: videoFiltersRow должен быть виден в режиме видео"); ok = false; }
  if (!doc.getElementById("favoritesToggle").hidden) { console.error("FAIL: избранное должно быть скрыто в режиме видео (как и у иконок)"); ok = false; }

  // ---- 2. Дефолтные активные источники видео = первые 3 видимых (pixabay/pexels/wikimedia); archive выключен, coverr скрыт (нет ключа) ----
  const videoChips = Array.from(doc.querySelectorAll('#videoSources .source-chip[data-video-source]'));
  console.log("Чипы источников видео:", videoChips.map((c) => `${c.dataset.videoSource}${c.hidden ? "(hidden)" : ""}`).join(", "));
  const coverrChip = videoChips.find((c) => c.dataset.videoSource === "coverr");
  if (!coverrChip || !coverrChip.hidden) { console.error("FAIL: Coverr должен быть скрыт по умолчанию (COVERR_ENABLED=false)"); ok = false; }
  const activeVideoDefault = videoChips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.videoSource);
  console.log("Активные видео-источники по умолчанию:", activeVideoDefault.join(", "));
  if (activeVideoDefault.join(",") !== "pixabay,pexels,wikimedia") { console.error("FAIL: ожидали активными по умолчанию pixabay,pexels,wikimedia"); ok = false; }

  // ---- 3. Лимит в 3 источника: попытка включить archive (4-й) блокируется тостом ----
  const archiveChip = videoChips.find((c) => c.dataset.videoSource === "archive");
  archiveChip.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (archiveChip.getAttribute("aria-pressed") === "true") { console.error("FAIL: 4-й видео-источник не должен был включиться"); ok = false; }
  if (!/3/.test(doc.getElementById("toast").textContent)) { console.error("FAIL: тост о лимите видео-источников не показан"); ok = false; }

  // ---- 4. Прогрессивный поиск по 3 активным источникам с разными задержками ----
  win.__providerBehavior = {
    "pixabay-video": { delayMs: 5, items: 2, total: 20 },
    "pexels-video": { delayMs: 40, items: 2, total: 20 },
    wikimedia: { delayMs: 20, items: 1, total: null, wikimediaVideo: true },
  };
  doc.getElementById("searchInput").value = "cat";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(10);
  const cardsEarly = doc.getElementById("videoGrid").querySelectorAll(".video-card:not([data-skeleton])").length;
  console.log("Карточек видео через 10мс (должен успеть только pixabay, 5мс):", cardsEarly);
  await sleep(80);
  const cards = Array.from(doc.getElementById("videoGrid").querySelectorAll(".video-card"));
  console.log("Всего карточек видео после всех ответов:", cards.length, "(ожидали 2+2+1=5)");
  if (cards.length !== 5) { console.error("FAIL: неверное число видео-карточек после прогрессивной загрузки"); ok = false; }
  if (doc.getElementById("videoGrid").hidden) { console.error("FAIL: videoGrid скрыт после успешного поиска"); ok = false; }

  const pixabayCard = cards.find((c) => c.dataset.id.startsWith("pixabay-"));
  if (!pixabayCard) { console.error("FAIL: не найдена карточка pixabay-video"); ok = false; }
  else {
    if (!pixabayCard.querySelector(".video-card-play")) { console.error("FAIL: нет иконки play на видео-карточке"); ok = false; }
    const durBadge = pixabayCard.querySelector(".video-card-duration");
    console.log("Бейдж длительности на карточке pixabay:", durBadge ? durBadge.textContent : "ОТСУТСТВУЕТ");
    if (!durBadge || durBadge.textContent !== "0:12") { console.error("FAIL: неверная/отсутствующая длительность на карточке pixabay (ожидали 0:12)"); ok = false; }
  }

  // ---- 5. Лайтбокс: открытие, src плеера, соседняя навигация ----
  pixabayCard.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (doc.getElementById("videoLightbox").hidden) { console.error("FAIL: видео-лайтбокс не открылся"); ok = false; }
  const playerSrc = doc.getElementById("vlPlayer").src;
  console.log("src видео-плеера:", playerSrc);
  if (!playerSrc || !playerSrc.includes(".mp4")) { console.error("FAIL: у видео-плеера не выставлен src"); ok = false; }
  const vlBadge = doc.getElementById("vlSourceBadge").textContent;
  console.log("Бейдж источника в лайтбоксе:", vlBadge);
  if (!vlBadge.includes("Pixabay")) { console.error("FAIL: неверный бейдж источника в лайтбоксе видео"); ok = false; }
  doc.getElementById("videoLightbox").querySelector("[data-video-close]").dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (!doc.getElementById("videoLightbox").hidden) { console.error("FAIL: видео-лайтбокс не закрылся"); ok = false; }

  // ---- 6. Быстрый повторный поиск не оставляет чужих карточек (тот же generation-механизм, что и у фото) ----
  win.__providerBehavior = {
    "pixabay-video": { delayMs: 60, items: 3, total: 30 },
    "pexels-video": { delayMs: 60, items: 3, total: 30 },
    wikimedia: { delayMs: 60, items: 3, total: null, wikimediaVideo: true },
  };
  doc.getElementById("searchInput").value = "dog";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(15);
  win.__providerBehavior = {
    "pixabay-video": { delayMs: 5, items: 1, total: 10 },
    "pexels-video": { delayMs: 5, items: 1, total: 10 },
    wikimedia: { delayMs: 5, items: 1, total: null, wikimediaVideo: true },
  };
  doc.getElementById("searchInput").value = "fish";
  doc.getElementById("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(150);
  const cardsAfterRace = doc.getElementById("videoGrid").querySelectorAll(".video-card").length;
  console.log("Карточек после гонки (dog отменён, только fish): ", cardsAfterRace, "(ожидали 1+1+1=3)");
  if (cardsAfterRace !== 3) { console.error("FAIL: гонка поисков видео дала неверный результат — race condition"); ok = false; }

  // ---- 7. Переключение обратно в "Фото" корректно скрывает видео-сетку ----
  doc.querySelector('.mode-tab[data-mode="photos"]').dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(10);
  if (!doc.getElementById("videoGrid").hidden) { console.error("FAIL: videoGrid должен скрыться при выходе из режима видео"); ok = false; }
  if (doc.getElementById("videoGrid").innerHTML !== "") { console.error("FAIL: videoGrid должен очищаться при выходе из режима видео"); ok = false; }

  console.log(ok ? "\n=== TEST12 OK ===" : "\n=== TEST12 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
