// Тесты в настоящем Chromium (Playwright): сайт раздаётся локальным
// сервером со сжатием (как на GitHub Pages), все внешние API и превью —
// синтетические (tests/e2e/mock.js). Проверяет то, что jsdom не умеет:
// реальную загрузку картинок, скачивание, какие файлы грузятся при
// открытии, и замеряет скорость на "мобильном" профиле.
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");
const { installMocks } = require("./mock");

const ROOT = path.resolve(__dirname, "../..");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(ROOT, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    let body = fs.readFileSync(file);
    const headers = { "Content-Type": type, "Cache-Control": "max-age=0" };
    if (/gzip/.test(req.headers["accept-encoding"] || "") && !type.startsWith("image/")) {
      body = zlib.gzipSync(body); headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, headers); res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const failures = [];
function check(cond, msg) { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures.push(msg); }

async function testNoHeavyThirdPartyOnLoad(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await installMocks(page);
  const thirdParty = [];
  page.on("request", (r) => { if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(r.url())) thirdParty.push(r.url()); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  check(thirdParty.length === 0, `при открытии не грузятся сторонние библиотеки (${thirdParty.join(", ") || "нет"})`);
  check(errors.length === 0, `нет JS-ошибок при загрузке (${errors.join("; ") || "нет"})`);
  await context.close();
}

async function testThumbnailsAfterInterruptedSearches(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 1200 });
  await page.goto(base);
  for (const q of ["cat", "cow", "owl"]) {
    await page.fill("#searchInput", q);
    await page.press("#searchInput", "Enter");
    await page.waitForSelector("#grid .card", { timeout: 5000 });
    await page.waitForTimeout(300); // превью ещё в пути
    await page.click("#clearBtn");
  }
  await page.fill("#searchInput", "dog");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card", { timeout: 5000 });
  await page.waitForTimeout(3500);
  const stuck = await page.evaluate(() => [...document.querySelectorAll("#grid .card.is-img-loading")]
    .filter((c) => c.getBoundingClientRect().top < innerHeight).length);
  check(stuck === 0, `после прерванных поисков видимые превью загрузились (висит: ${stuck})`);
  await context.close();
}

async function testLightboxDownload(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 50 });
  await page.goto(base);
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.click("#grid .card");
  await page.waitForSelector("#lightbox:not([hidden])");
  const download = page.waitForEvent("download", { timeout: 5000 }).then(() => true).catch(() => false);
  await page.click("#lbDownload");
  check(await download, "кнопка «Скачать» в окне фото скачивает файл");
  await context.close();
}

// На телефоне после Enter поле поиска теряет фокус — экранная клавиатура
// прячется и не закрывает результаты. На компьютере фокус остаётся.
async function testKeyboardHidesOnMobile(browser, base) {
  for (const mobile of [true, false]) {
    const context = await browser.newContext({ serviceWorkers: "block", isMobile: mobile, hasTouch: mobile, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
    const page = await context.newPage();
    await installMocks(page, { imgDelay: 10 });
    await page.goto(base);
    await page.fill("#searchInput", "cat");
    await page.waitForTimeout(900);
    const cardsBeforeEnter = await page.locator("#grid .card").count();
    await page.press("#searchInput", "Enter");
    await page.waitForSelector("#grid .card");
    const focused = await page.evaluate(() => document.activeElement === document.getElementById("searchInput"));
    const label = mobile ? "телефон" : "компьютер";
    check(cardsBeforeEnter === 0, `${label}: набор текста без Enter не запускает поиск`);
    check(mobile ? !focused : focused, `${label}: после Enter ${mobile ? "клавиатура прячется (поле без фокуса)" : "фокус остаётся в поле"}`);
    await context.close();
  }
}

// Главный экран ↔ выдача: пока нет результатов, поиск в центре главного
// экрана; после поиска главный экран реально скрыт (а не остаётся поверх
// выдачи), поиск в шапке, первая карточка видна; очистка — снова главная.
async function testHomeLayout(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 20 });
  await page.goto(base);
  const state = () => page.evaluate(() => ({
    home: document.body.classList.contains("is-home"),
    formInHero: !!document.querySelector("#homeSearchSlot #searchForm"),
    formInTopbar: !!document.querySelector(".topbar #searchForm"),
    heroShown: getComputedStyle(document.getElementById("emptyState")).display !== "none",
    sources: document.getElementById("homeSourcesList").textContent,
    firstCardTop: document.querySelector("#grid .card")?.getBoundingClientRect().top ?? null,
  }));
  let s = await state();
  check(s.home && s.formInHero && s.heroShown, "главная: строка поиска в центре главного экрана");
  check(/Pixabay/.test(s.sources), `главная: строка активных источников (${s.sources})`);
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card");
  await page.waitForTimeout(200);
  s = await state();
  check(!s.home && s.formInTopbar && !s.heroShown, "после поиска: главный экран скрыт, поиск в шапке");
  check(s.firstCardTop !== null && s.firstCardTop < 800, `после поиска: выдача видна сразу (верх первой карточки ${Math.round(s.firstCardTop)} px)`);
  await page.click("#clearBtn");
  await page.waitForTimeout(200);
  s = await state();
  check(s.home && s.formInHero && s.heroShown, "после очистки: снова главная");
  await context.close();
}

// Фоновое фото: в тёмной теме проявляется и не меняется в рамках сеанса
// (перезагрузка), в светлой — не скачивается вовсе.
async function testDarkThemeBackground(browser, base) {
  const dark = await browser.newContext({ serviceWorkers: "block", colorScheme: "dark" });
  const page = await dark.newPage();
  await installMocks(page);
  await page.goto(base);
  const shown = await page.waitForSelector("#bgPhoto.is-shown", { timeout: 8000 }).then(() => true).catch(() => false);
  check(shown, "тёмная тема: фоновое фото появляется");
  const first = await page.getAttribute("#bgPhoto", "data-photo");
  await page.reload();
  await page.waitForSelector("#bgPhoto.is-shown", { timeout: 8000 }).catch(() => {});
  check(first && first === await page.getAttribute("#bgPhoto", "data-photo"), `тёмная тема: в рамках сеанса фон один и тот же (${first})`);
  await dark.close();

  const light = await browser.newContext({ serviceWorkers: "block", colorScheme: "light" });
  const lp = await light.newPage();
  await installMocks(lp);
  const requested = [];
  lp.on("request", (r) => { if (r.url().includes("/images/bg/")) requested.push(r.url()); });
  await lp.goto(base, { waitUntil: "load" });
  await lp.waitForTimeout(1500);
  check(requested.length === 0, `светлая тема: фоновое фото не скачивается (запросов: ${requested.length})`);
  await light.close();
}

// Иконки рисуются CSS-маской (.icon + mask: var(--icon-…)). Если для
// конкретной кнопки правило маски забыли, вместо иконки виден сплошной
// чёрный квадрат — ищем такие во всех режимах и в окне просмотра.
async function testIconsHaveMasks(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 10 });
  await page.goto(base);
  const found = new Set();
  const scan = async () => (await page.evaluate(() => [...document.querySelectorAll(".icon")].filter((n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && cs.maskImage === "none" && cs.webkitMaskImage === "none";
  }).map((n) => `${n.className} (#${n.closest("[id]")?.id})`))).forEach((x) => found.add(x));
  await scan();
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card");
  await scan();
  await page.click("#grid .card");
  await page.waitForSelector("#lightbox:not([hidden])");
  await scan();
  await page.keyboard.press("Escape");
  for (const mode of ["icons", "video"]) {
    await page.click(`.mode-tab[data-mode="${mode}"]`);
    await page.waitForTimeout(400);
    await scan();
  }
  check(found.size === 0, `у всех видимых иконок есть маска, нет «чёрных квадратов» (${[...found].join(", ") || "нет"})`);
  await context.close();
}

async function measure(browser, base, runs = 5) {
  const RTT = 150;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: RTT, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await installMocks(page, { imgDelay: RTT * 2, apiDelay: RTT * 2 });
    await page.goto(base, { waitUntil: "load" });
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { fcp: fcp ? fcp.startTime : 0, ready: n.domContentLoadedEventEnd };
    });
    const t0 = Date.now();
    await page.fill("#searchInput", "cat");
    await page.press("#searchInput", "Enter");
    await page.waitForSelector("#grid .card:not(.is-img-loading)", { timeout: 20000 });
    samples.push({ ...nav, firstThumb: Date.now() - t0 });
    await context.close();
  }
  const med = (k) => { const v = samples.map((s) => s[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]); };
  return { fcp: med("fcp"), ready: med("ready"), firstThumb: med("firstThumb") };
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    await testNoHeavyThirdPartyOnLoad(browser, base);
    await testThumbnailsAfterInterruptedSearches(browser, base);
    await testLightboxDownload(browser, base);
    await testIconsHaveMasks(browser, base);
    await testKeyboardHidesOnMobile(browser, base);
    await testDarkThemeBackground(browser, base);
    await testHomeLayout(browser, base);
    const m = await measure(browser, base);
    console.log(`\nСкорость (мобильный 4G, процессор x4, медиана из 5):`);
    console.log(`  первая отрисовка ${m.fcp} мс · сайт готов ${m.ready} мс · первое превью после Enter ${m.firstThumb} мс`);
    // Щедрый бюджет — ловит грубые регрессии (например, вернувшуюся
    // блокирующую библиотеку), а не шум измерений.
    check(m.ready < 2500, `сайт готов к работе быстрее 2.5 с на мобильном профиле (${m.ready} мс)`);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} проверок не прошло` : "\nВсе проверки прошли");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
