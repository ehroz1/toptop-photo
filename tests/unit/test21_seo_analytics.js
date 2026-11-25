// SEO и счётчики:
//  1) на главной есть текст о сервисе и частые вопросы; вопросы в разметке
//     для поисковиков (FAQPage JSON-LD) совпадают с видимыми на странице;
//  2) счётчики (js/analytics.js) без номера ничего не грузят, а с номером
//     Метрики — грузят её скрипт после загрузки страницы и считают поиски.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "../..");
let ok = true;
const fail = (msg) => { console.error("FAIL:", msg); ok = false; };

// 1. Разметка
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const doc = new JSDOM(html).window.document;
const about = doc.querySelector(".home-about");
if (!about) fail("нет блока с текстом о сервисе (.home-about)");
const h1 = doc.querySelector("h1.home-wordmark")?.textContent.trim();
console.log("h1:", h1);
if (!h1 || !/Picta/.test(h1) || h1.length < 20) fail("h1 главной должен описывать сайт, а не быть просто «Picta»");
const visibleQs = [...doc.querySelectorAll(".home-faq-item summary")].map((n) => n.textContent.trim());
const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
const faq = ld.find((x) => x["@type"] === "FAQPage");
const ldQs = faq ? faq.mainEntity.map((q) => q.name) : [];
console.log("Вопросов на странице:", visibleQs.length, "| в разметке:", ldQs.length);
if (visibleQs.length < 3) fail("мало частых вопросов на странице");
if (JSON.stringify(visibleQs) !== JSON.stringify(ldQs)) fail("вопросы в FAQPage JSON-LD не совпадают с видимыми на странице");
if (!ld.some((x) => x["@type"] === "WebSite")) fail("пропала разметка WebSite");
const words = about ? about.textContent.replace(/\s+/g, " ").trim().split(" ").length : 0;
console.log("Слов в тексте о сервисе:", words);
if (words < 150) fail("текста о сервисе слишком мало для поисковиков");

// 1б. Sitemap, robots, .nojekyll, защита от ложных 404 (?q= -> noindex), подборки, admin.html
if (!fs.existsSync(path.join(ROOT, ".nojekyll"))) fail("нет файла .nojekyll для GitHub Pages");
const robotsTxt = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
if (!robotsTxt.includes("Sitemap: https://picta.cc/sitemap.xml")) fail("в robots.txt нет ссылки на sitemap.xml");

const sitemapXml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length < 20) fail(`в sitemap.xml слишком мало страниц (${locs.length})`);
for (const loc of locs) {
  if (!loc.startsWith("https://picta.cc/") || !loc.endsWith("/")) {
    fail(`некорректный URL в sitemap.xml: ${loc}`);
    continue;
  }
  const relPath = loc.slice("https://picta.cc/".length);
  const filePath = relPath ? path.join(ROOT, relPath, "index.html") : path.join(ROOT, "index.html");
  if (!fs.existsSync(filePath)) fail(`sitemap.xml ссылается на несуществующую страницу: ${loc}`);
}

// ?q=... должен ставить noindex, follow; главная и /foto/priroda/ — без noindex
const noindexCheck = (file, url) => {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const head = src.match(/<head>([\s\S]*?)<\/head>/)[1];
  const dom = new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`, { runScripts: "dangerously", url });
  return dom.window.document.querySelector('meta[name="robots"]')?.getAttribute("content") || null;
};
if (noindexCheck("index.html", "https://picta.cc/") !== null) fail("на главной не должно быть meta robots=noindex");
if (noindexCheck("index.html", "https://picta.cc/?q=test") !== "noindex, follow") fail("поисковая ссылка ?q= должна получать meta robots=noindex, follow");
if (noindexCheck("foto/priroda/index.html", "https://picta.cc/foto/priroda/") !== null) fail("на странице подборки не должно быть meta robots=noindex");

const prirodaHtml = fs.readFileSync(path.join(ROOT, "foto/priroda/index.html"), "utf8");
const prirodaDoc = new JSDOM(prirodaHtml).window.document;
const prirodaLd = [...prirodaDoc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
if (!prirodaLd.some((x) => x["@type"] === "BreadcrumbList")) fail("на подборке пропала разметка BreadcrumbList");
if (!prirodaLd.some((x) => x["@type"] === "CollectionPage")) fail("на подборке нет разметки CollectionPage");
if (!/"qEn":"nature"/.test(prirodaHtml)) fail("на подборке нет предпереведённого qEn");

const adminDoc = new JSDOM(fs.readFileSync(path.join(ROOT, "admin.html"), "utf8")).window.document;
if (adminDoc.querySelectorAll('meta[name="robots"]').length !== 1) fail("в admin.html должен быть ровно один тег meta robots");
if (adminDoc.querySelector(".admin-brand")?.getAttribute("href") !== "/") fail("ссылка из admin.html должна вести на /");

// 2. Счётчики
function runAnalytics(analyticsCfg) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { runScripts: "outside-only", url: "https://picta.cc/" });
  const w = dom.window;
  w.APP_CONFIG = { ANALYTICS: analyticsCfg };
  w.eval(fs.readFileSync(path.join(ROOT, "js/analytics.js"), "utf8"));
  return w;
}
(async () => {
  const off = runAnalytics({ YANDEX_METRIKA_ID: "", CLOUDFLARE_BEACON_TOKEN: "" });
  await new Promise((r) => setTimeout(r, 50));
  if (off.document.querySelectorAll("script[src]").length) fail("без номера счётчика скрипты всё равно грузятся");
  if (off.PictaAnalytics.enabled) fail("без номера счётчик считается включённым");
  off.PictaAnalytics.goal("search"); // не должно падать

  const on = runAnalytics({ YANDEX_METRIKA_ID: "12345678", CLOUDFLARE_BEACON_TOKEN: "abc" });
  await new Promise((r) => setTimeout(r, 50));
  const srcs = [...on.document.querySelectorAll("script[src]")].map((s) => s.src);
  console.log("Подключены:", srcs.join(", "));
  if (!srcs.some((s) => s.includes("mc.yandex.ru/metrika/tag.js"))) fail("Метрика не подключилась при указанном номере");
  if (!srcs.some((s) => s.includes("cloudflareinsights.com"))) fail("Cloudflare Web Analytics не подключился при указанном токене");
  on.PictaAnalytics.goal("search", { mode: "photos" });
  const calls = (on.ym.a || []).map((a) => [...a]);
  if (!calls.some((c) => c[0] === 12345678 && c[1] === "init")) fail("Метрика не инициализирована");
  if (!calls.some((c) => c[1] === "reachGoal" && c[2] === "search")) fail("поиск не отправляется целью в Метрику");

  console.log(ok ? "\n=== TEST21 OK ===" : "\n=== TEST21 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
