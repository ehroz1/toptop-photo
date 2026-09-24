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
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp" };

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
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      body: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""),
      heading: getComputedStyle(document.querySelector("#noResults h1")).fontFamily.split(",")[0].replace(/"/g, ""),
      // Unbounded на главной не виден (там логотип) — грузим его явно, как
      // браузер сделает при первом заголовке "Ничего не найдено".
      unboundedFaces: (await document.fonts.load('900 40px "Unbounded"', "Ничего Nothing")).length,
      logo: getComputedStyle(document.querySelector(".home-logo")).maskImage || getComputedStyle(document.querySelector(".home-logo")).webkitMaskImage,
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
    };
  });
  check(fonts.body === "Manrope" && fonts.heading === "Unbounded" && fonts.loaded.includes("Manrope") && fonts.unboundedFaces > 0,
    `шрифты: текст — Manrope, заголовки — Unbounded, оба загружаются (${[...new Set(fonts.loaded)].join(", ") || "ничего"})`);
  check(/logo\.svg/.test(fonts.logo), `главная: вместо надписи — логотип (${fonts.logo})`);
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
    about: getComputedStyle(document.querySelector(".home-about")).display !== "none",
    firstCardTop: document.querySelector("#grid .card")?.getBoundingClientRect().top ?? null,
  }));
  let s = await state();
  check(s.home && s.formInHero && s.heroShown, "главная: строка поиска в центре главного экрана");
  check(s.about, "главная: под первым экраном есть текст о сервисе и частые вопросы");
  check(/Pixabay/.test(s.sources), `главная: строка активных источников (${s.sources})`);
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card");
  await page.waitForTimeout(200);
  s = await state();
  check(!s.home && s.formInTopbar && !s.heroShown, "после поиска: главный экран скрыт, поиск в шапке");
  check(!s.about, "после поиска: текста о сервисе в выдаче нет");
  check(s.firstCardTop !== null && s.firstCardTop < 800, `после поиска: выдача видна сразу (верх первой карточки ${Math.round(s.firstCardTop)} px)`);
  await page.click("#clearBtn");
  await page.waitForTimeout(200);
  s = await state();
  check(s.home && s.formInHero && s.heroShown, "после очистки: снова главная");
  await context.close();

  // Окно "Источники" на главной: поверх строк "Недавние"/"Попробуйте" и не
  // уходит за нижний край экрана (невысокий экран + заполненная история).
  const small = await browser.newContext({ serviceWorkers: "block", viewport: { width: 840, height: 700 } });
  await small.addInitScript(() => localStorage.setItem("photoseek-history", JSON.stringify(["sunset", "water", "sport", "run", "marathon", "soldier", "cats"])));
  const sp = await small.newPage();
  await installMocks(sp);
  await sp.goto(base);
  await sp.click("#sourcesMenuToggle");
  await sp.waitForTimeout(200);
  const pop = await sp.evaluate(() => {
    const popover = document.getElementById("sourcesMenuPopover");
    const rect = popover.getBoundingClientRect();
    const covered = [...popover.querySelectorAll(".source-check-row")].filter((row) => {
      const r = row.getBoundingClientRect();
      if (!row.offsetParent || r.bottom > rect.bottom || r.top < rect.top) return false;
      return !popover.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }).length;
    return { bottom: rect.bottom, vh: innerHeight, covered };
  });
  check(pop.covered === 0, `главная: окно «Источники» не перекрыто подсказками (перекрыто строк: ${pop.covered})`);
  check(pop.bottom <= pop.vh, `главная: окно «Источники» помещается на экране (низ ${Math.round(pop.bottom)} из ${pop.vh})`);
  await small.close();
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
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card");
  await page.waitForTimeout(600);
  const inResults = await page.evaluate(() => getComputedStyle(document.getElementById("bgPhoto")).opacity);
  check(inResults === "0", `тёмная тема: в результатах поиска фонового фото нет (прозрачность ${inResults})`);
  await page.click(".brand");
  const back = await page.waitForSelector("#bgPhoto.is-shown", { timeout: 4000 }).then(() => true).catch(() => false);
  check(back, "тёмная тема: на главной фон снова проявляется");
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

// Смена темы: новая тема проявляется кругом от кнопки (View Transitions),
// "авто", совпадающее с текущей темой, меняет только иконку, а при
// "уменьшить движение" тема меняется сразу, без анимации.
async function testThemeSwitch(browser, base) {
  const spy = () => {
    window.__vtCalls = 0;
    const orig = Document.prototype.startViewTransition;
    if (orig) Document.prototype.startViewTransition = function (...args) { window.__vtCalls++; return orig.apply(this, args); };
  };
  const context = await browser.newContext({ serviceWorkers: "block", colorScheme: "light", viewport: { width: 1280, height: 800 } });
  await context.addInitScript(spy);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installMocks(page);
  await page.goto(base, { waitUntil: "load" });
  const theme = () => page.evaluate(() => ({
    mode: document.documentElement.getAttribute("data-theme-mode"),
    theme: document.documentElement.getAttribute("data-theme"),
    reveal: document.documentElement.classList.contains("theme-reveal"),
    vt: window.__vtCalls,
  }));

  await page.click("#mainMenuToggle"); // тема — пункт меню в шапке
  await page.click('#themeSeg [data-theme-set="light"]'); // авто (светлая) → светлая
  let s = await theme();
  check(s.mode === "light" && s.vt === 0, `тема: «авто» → «светлая» при светлой системе меняет только иконку (переходов: ${s.vt})`);

  await page.click('#themeSeg [data-theme-set="dark"]'); // светлая → тёмная
  // Анимация стартует на следующем кадре после клика — ждём её появления.
  const anim = await page.waitForFunction(() => {
    const a = document.getAnimations().find((x) => x.effect && x.effect.pseudoElement === "::view-transition-new(root)");
    return a && { sizes: a.effect.getKeyframes().map((k) => k.maskSize), fill: a.effect.getTiming().fill, reveal: document.documentElement.classList.contains("theme-reveal") };
  }, null, { timeout: 2000 }).then((h) => h.jsonValue()).catch(() => null);
  check(!!anim && anim.fill === "forwards", `тема: последний кадр круга держится до конца перехода — без мигания (fill: ${anim && anim.fill})`);
  check(!!anim && anim.reveal && anim.sizes[0] === "0px 0px" && parseInt(anim.sizes[1], 10) > 1280,
    `тема: светлая → тёмная — новая тема растёт кругом от кнопки (${anim ? anim.sizes.join(" → ") : "анимации нет"})`);
  await page.waitForTimeout(1200);
  s = await theme();
  check(s.theme === "dark" && !s.reveal && s.vt === 1, `тема: после анимации тёмная тема применена, служебный класс снят (${JSON.stringify(s)})`);
  check(errors.length === 0, `тема: без JS-ошибок (${errors.join("; ") || "нет"})`);
  await context.close();

  const calm = await browser.newContext({ serviceWorkers: "block", colorScheme: "light", reducedMotion: "reduce" });
  await calm.addInitScript(spy);
  const cp = await calm.newPage();
  await installMocks(cp);
  await cp.goto(base, { waitUntil: "load" });
  await cp.click("#mainMenuToggle");
  await cp.click('#themeSeg [data-theme-set="dark"]');
  const c = await cp.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), vt: window.__vtCalls }));
  check(c.theme === "dark" && c.vt === 0, `тема: при «уменьшить движение» меняется сразу, без анимации (переходов: ${c.vt})`);
  await calm.close();
}

// Прокрутка выдачи: подложка шапки — градиент цвета фона на всю ширину
// экрана (без размытия), появляется кнопка «Наверх» и возвращает наверх.
// Наведение на фото — ровная тёмная заливка, карточка не двигается.
async function testScrollHeaderAndCards(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 10 });
  await page.goto(base);
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card:not(.is-img-loading)");
  // В моках все превью одинаковые (1×1 px), и склейка дублей оставляет одну
  // карточку — страницу удлиняем сами, чтобы было что прокручивать.
  await page.evaluate(() => { const d = document.createElement("div"); d.style.height = "4000px"; document.querySelector("main").append(d); });

  const sizes = await page.evaluate(() => [...document.querySelectorAll("#grid .card")].map((c) => ({
    // offsetHeight — размер по разметке, без transform (пока превью
    // грузится, оно нарисовано на 96% и getBoundingClientRect занизил бы его).
    card: c.offsetHeight, img: c.querySelector("img").offsetHeight,
  })));
  const gaps = sizes.filter((x) => x.card > x.img + 0.5);
  check(sizes.length > 0 && gaps.length === 0, `карточки без полоски под фото (выше картинки: ${gaps.length} из ${sizes.length})`);

  await page.hover("#grid .card");
  await page.waitForTimeout(350);
  const hover = await page.evaluate(() => {
    const card = document.querySelector("#grid .card");
    const overlay = getComputedStyle(card.querySelector(".card-overlay"));
    return {
      cardTransform: getComputedStyle(card).transform,
      imgTransform: getComputedStyle(card.querySelector("img")).transform,
      overlayBg: overlay.backgroundColor, overlayImage: overlay.backgroundImage, overlayOpacity: overlay.opacity,
    };
  });
  check(hover.cardTransform === "none" && (hover.imgTransform === "none" || hover.imgTransform === "matrix(1, 0, 0, 1, 0, 0)"),
    `наведение на фото: карточка не подпрыгивает и не увеличивается (${hover.cardTransform} / ${hover.imgTransform})`);
  check(hover.overlayImage === "none" && /rgba\(0, 0, 0, 0\.\d+\)/.test(hover.overlayBg) && hover.overlayOpacity === "1",
    `наведение на фото: ровная тёмная заливка без градиента (${hover.overlayBg}, ${hover.overlayImage})`);

  const before = await page.evaluate(() => document.getElementById("backToTop").classList.contains("is-visible"));
  await page.mouse.wheel(0, 2600);
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => {
    const bar = document.getElementById("topbar");
    const cs = getComputedStyle(bar, "::before");
    const blurred = [...document.querySelectorAll("*")].filter((n) => n.id !== "bgPhoto").filter((n) => {
      const c = getComputedStyle(n);
      return (c.backdropFilter && c.backdropFilter !== "none") || /blur/.test(c.filter);
    }).map((n) => n.id || n.className);
    return {
      scrolled: bar.classList.contains("is-scrolled"),
      width: parseFloat(cs.width), vw: document.documentElement.clientWidth,
      opacity: cs.opacity, image: cs.backgroundImage, blurred,
      btt: document.getElementById("backToTop").classList.contains("is-visible"),
    };
  });
  check(s.scrolled && s.width >= s.vw && s.opacity === "1" && /linear-gradient/.test(s.image),
    `шапка при прокрутке: градиент на всю ширину экрана (${s.width} из ${s.vw} px)`);
  check(s.blurred.length === 0, `на странице нет размытия, кроме появления фонового фото (${s.blurred.join(", ") || "нет"})`);
  check(!before && s.btt, "кнопка «Наверх» появляется только после прокрутки");
  await page.click("#backToTop");
  await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => window.scrollY === 0), "кнопка «Наверх» возвращает в начало страницы");
  await context.close();
}

// Курсор-точка: только на главном экране и только с мышью. Догоняет
// указатель, над полем ввода уступает место обычному текстовому курсору,
// после поиска — обычная стрелка.
async function testMagicCursor(browser, base) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await installMocks(page, { imgDelay: 10 });
  await page.goto(base);
  await page.mouse.move(300, 620);
  await page.mouse.move(900, 640, { steps: 5 });
  await page.waitForTimeout(700);
  const home = await page.evaluate(() => {
    const n = document.querySelector(".magic-cursor");
    const m = n && new DOMMatrix(getComputedStyle(n).transform);
    return n && { visible: n.classList.contains("is-visible"), x: m.m41, y: m.m42, cursor: getComputedStyle(document.body).cursor };
  });
  check(!!home && home.visible && home.cursor === "none" && Math.abs(home.x - 900) < 2 && Math.abs(home.y - 640) < 2,
    `курсор-точка на главной: видна и догоняет указатель (${home ? `${Math.round(home.x)},${Math.round(home.y)}` : "нет точки"})`);
  const inp = await page.locator("#searchInput").boundingBox();
  await page.mouse.move(inp.x + 80, inp.y + inp.height / 2, { steps: 3 });
  await page.waitForTimeout(400);
  const overInput = await page.evaluate(() => {
    const dot = getComputedStyle(document.querySelector(".magic-cursor-dot"));
    return {
      text: document.querySelector(".magic-cursor").classList.contains("is-text"),
      cursor: getComputedStyle(document.getElementById("searchInput")).cursor,
      w: parseFloat(dot.width), h: parseFloat(dot.height),
    };
  });
  check(overInput.text && overInput.cursor === "none" && overInput.w <= 3 && overInput.h >= 20,
    `курсор-точка: над полем поиска превращается в свой текстовый курсор (${overInput.w}×${overInput.h}, системный: ${overInput.cursor})`);
  await page.fill("#searchInput", "cat");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector("#grid .card");
  await page.waitForTimeout(200);
  const results = await page.evaluate(() => ({
    on: document.body.classList.contains("magic-cursor-on"),
    visible: document.querySelector(".magic-cursor").classList.contains("is-visible"),
  }));
  check(!results.on && !results.visible, "курсор-точка: в выдаче выключена, обычная стрелка");
  await context.close();

  const phone = await browser.newContext({ serviceWorkers: "block", isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  await installMocks(pp);
  await pp.goto(base);
  const cdp = await phone.newCDPSession(pp);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", 200, 640);
  for (let i = 1; i <= 5; i++) await touch("touchMove", 200 + i * 20, 640 - i * 12);
  await pp.waitForTimeout(400);
  const held = await pp.evaluate(() => {
    const n = document.querySelector(".magic-cursor");
    const m = new DOMMatrix(getComputedStyle(n).transform);
    return { cls: n.className, x: m.m41, y: m.m42, dot: document.querySelector(".magic-cursor-dot").getBoundingClientRect().width, native: document.body.classList.contains("magic-cursor-on") };
  });
  check(/is-visible/.test(held.cls) && /is-touch/.test(held.cls) && Math.abs(held.x - 300) < 3 && Math.abs(held.y - 580) < 3 && held.dot > 14 && !held.native,
    `курсор-точка на телефоне: появляется под пальцем, крупнее и тянется за ним (${Math.round(held.x)},${Math.round(held.y)}, ${Math.round(held.dot)} px)`);
  await touch("touchEnd");
  await pp.waitForTimeout(1300);
  check(await pp.evaluate(() => !document.querySelector(".magic-cursor").classList.contains("is-visible")),
    "курсор-точка на телефоне: после отпускания гаснет");
  await phone.close();
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
  // Иконки окон шапки: меню (с раскрытой статистикой), «молния», профиль.
  for (const [toggle, extra] of [["#mainMenuToggle", "#insightsToggle"], ["#aboutToggle"], ["#authToggle"]]) {
    await page.click(toggle);
    if (extra) await page.click(extra);
    await scan();
    await page.keyboard.press("Escape");
  }
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
    await testThemeSwitch(browser, base);
    await testScrollHeaderAndCards(browser, base);
    await testMagicCursor(browser, base);
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
