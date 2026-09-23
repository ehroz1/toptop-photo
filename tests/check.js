// Быстрые статические проверки без браузера:
//  1) синтаксис всех JS-файлов;
//  2) каждый свой скрипт/стиль из index.html существует и лежит в офлайн-
//     кэше service worker'а (SHELL_FILES в sw.js);
//  3) адрес воркера в preconnect совпадает с WORKER_BASE_URL в config.js;
//  4) у каждой data-i18n-надписи в HTML и у каждого I18N.t("…") в скриптах
//     есть перевод и на русском, и на английском;
//  5) в стилях нет размытия (backdrop-filter / blur()).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const problems = [];

// 1. Синтаксис
const jsFiles = ["sw.js", "cloudflare-worker/worker.js", ...fs.readdirSync(path.join(ROOT, "js")).map((f) => `js/${f}`)]
  .filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" });
  } catch (err) {
    problems.push(`синтаксическая ошибка в ${f}: ${String(err.stderr).split("\n").slice(0, 4).join(" ")}`);
  }
}

// 2. Свои скрипты/стили index.html ↔ SHELL_FILES
const indexHtml = read("index.html");
const local = [...indexHtml.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="stylesheet"[^>]*\shref)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^https?:/.test(u));
const swSource = read("sw.js");
const shellFiles = vm.runInNewContext(`(${swSource.match(/const SHELL_FILES = (\[[\s\S]*?\]);/)[1]})`);
for (const u of local) {
  const file = u.split("?")[0];
  if (!fs.existsSync(path.join(ROOT, file))) problems.push(`index.html ссылается на несуществующий файл ${u}`);
  if (!shellFiles.includes(`./${u}`)) problems.push(`${u} подключён в index.html, но не добавлен в SHELL_FILES в sw.js (офлайн сайт сломается)`);
}

// 3. Адрес воркера
const workerUrl = (read("js/config.js").match(/WORKER_BASE_URL:\s*"([^"]*)"/) || [])[1];
if (workerUrl && !indexHtml.includes(`rel="preconnect" href="${workerUrl}"`)) {
  problems.push(`preconnect в index.html не совпадает с WORKER_BASE_URL (${workerUrl}) — первый запрос поиска не будет прогрет`);
}

// 3б. Для каждого фонового фото из js/background.js есть обе версии файла
const bgPhotos = vm.runInNewContext(`(${(read("js/background.js").match(/const PHOTOS = (\[[^\]]*\]);/) || [])[1] || "[]"})`);
for (const id of bgPhotos) {
  for (const variant of ["desktop", "mobile"]) {
    const f = `images/bg/${id}-${variant}.webp`;
    if (!fs.existsSync(path.join(ROOT, f))) problems.push(`нет фонового фото ${f} (указано в PHOTOS в js/background.js)`);
  }
}

// 4. Переводы
const sandbox = { window: {}, navigator: { language: "ru" }, document: { documentElement: {} } };
vm.runInNewContext(read("js/i18n.js").replace("global.I18N = {", "global.__DICT = DICT; global.I18N = {"), sandbox);
const DICT = sandbox.window.__DICT;
const i18nKeys = new Set([...indexHtml.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]));
for (const lang of ["ru", "en"]) {
  for (const k of i18nKeys) {
    if (!Object.prototype.hasOwnProperty.call(DICT[lang], k)) problems.push(`нет перевода "${k}" для языка ${lang} (используется в index.html)`);
  }
}

// 4б. Ключи, которые скрипты берут через I18N.t("…"), тоже есть в обоих языках
for (const f of jsFiles.filter((f) => f.startsWith("js/"))) {
  for (const [, k] of read(f).matchAll(/I18N\.t\("([a-z0-9_]+)"/g)) {
    for (const lang of ["ru", "en"]) {
      if (!Object.prototype.hasOwnProperty.call(DICT[lang], k)) problems.push(`нет перевода "${k}" для языка ${lang} (используется в ${f})`);
    }
  }
}

// 5. Размытия на сайте нет нигде (решение владельца): ни стеклянных
//    подложек (backdrop-filter), ни filter: blur().
const css = read("css/styles.css");
if (/backdrop-filter|blur\(/.test(css)) problems.push("в css/styles.css снова появилось размытие (backdrop-filter или blur()) — на сайте его быть не должно");

if (problems.length) {
  console.log(`✗ Найдено проблем: ${problems.length}`);
  problems.forEach((p) => console.log("  - " + p));
  process.exit(1);
}
console.log(`✓ Проверки пройдены: ${jsFiles.length} JS-файлов, ${local.length} файлов оболочки, переводы, адрес воркера`);
