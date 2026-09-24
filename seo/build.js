// Собирает страницы подборок (см. seo/pages.js) из index.html, ссылки на них
// на главной и sitemap.xml.
//   npm run pages          — пересобрать и записать файлы;
//   (из tests/check.js)    — build({ check: true }) только сравнивает и
//                            возвращает список устаревших файлов.
// Страница подборки — это та же главная (все стили и скрипты те же), но:
//   - свои title/description/canonical/og и разметка BreadcrumbList;
//   - <base href="/">, чтобы относительные пути к css/js/иконкам работали из
//     папки /foto/priroda/;
//   - window.PICTA_PAGE = { q, mode } — app.js сразу выполнит этот поиск;
//   - вместо блока «о сервисе» главной — свой текст и ссылки на подборки.
// Файлы подборок НЕ редактировать руками: после правок index.html или
// seo/pages.js запустите npm run pages (иначе npm run check упадёт).
const fs = require("fs");
const path = require("path");
const { SITE, UPDATED, PAGES } = require("./pages");

const ROOT = path.resolve(__dirname, "..");
const GENERATED_NOTE = "<!-- Сгенерировано seo/build.js из index.html и seo/pages.js — не редактировать вручную, запустите npm run pages. -->";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceOnce(html, from, to, what) {
  const i = html.indexOf(from);
  if (i === -1 || html.indexOf(from, i + 1) !== -1) throw new Error(`seo/build.js: в index.html не найдено (или найдено дважды) место для «${what}»`);
  return html.slice(0, i) + to + html.slice(i + from.length);
}
function replaceRe(html, re, to, what) {
  if (!re.test(html)) throw new Error(`seo/build.js: в index.html не найдено место для «${what}»`);
  return html.replace(re, to);
}
function between(html, start, end, inner, what) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`seo/build.js: в index.html нет меток ${start} … ${end} (${what})`);
  return html.slice(0, a + start.length) + inner + html.slice(b);
}

function linksHtml(exceptPath, indent) {
  return PAGES.filter((p) => p.path !== exceptPath)
    .map((p) => `${indent}<a href="${p.path}">${esc(p.name)}</a>`)
    .join("\n");
}

// Главная: ссылки «Популярные подборки» между метками seo:links.
function buildIndex(index) {
  return between(index, "<!-- seo:links:start -->", "<!-- seo:links:end -->",
    `\n${linksHtml(null, "        ")}\n`, "ссылки на подборки");
}

function buildPage(index, page) {
  const url = SITE + page.path;
  let html = index;

  html = replaceOnce(html, "<head>\n", `<head>\n${GENERATED_NOTE}\n`, "пометка о генерации");
  html = replaceOnce(html, '<meta charset="UTF-8">\n', '<meta charset="UTF-8">\n<base href="/">\n', "base");
  html = replaceRe(html, /<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`, "title");
  html = replaceRe(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(page.description)}">`, "description");
  html = replaceRe(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, "canonical");
  html = replaceRe(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, "og:url");
  html = replaceRe(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(page.title)}">`, "og:title");
  html = replaceRe(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(page.description)}">`, "og:description");

  // Разметка для поисковиков: вместо WebSite/FAQ главной — «хлебные крошки».
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Picta", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: page.h1, item: url },
    ],
  };
  const ldRe = /<script type="application\/ld\+json">[\s\S]*?<\/script>\n/g;
  if (!ldRe.test(html)) throw new Error("seo/build.js: в index.html нет JSON-LD");
  let first = true;
  html = html.replace(ldRe, () => {
    if (!first) return "";
    first = false;
    return `<script type="application/ld+json">\n${JSON.stringify(crumbs)}\n</script>\n`;
  });

  const pageCfg = { q: page.q || "", mode: page.mode || "photos" };
  html = replaceOnce(html, '<script src="js/config.js"></script>',
    `<script>window.PICTA_PAGE = ${JSON.stringify(pageCfg)};</script>\n<script src="js/config.js"></script>`, "PICTA_PAGE");

  const aboutStart = "<!-- seo:about:start -->";
  const aboutEnd = "<!-- seo:about:end -->";
  const paragraphs = (indent) => page.text.map((t) => `${indent}<p>${esc(t)}</p>`).join("\n");

  if (page.q) {
    // Подборка с поиском: главный экран сразу сменится выдачей, поэтому h1 и
    // первая фраза — над выдачей, а текст и ссылки — под ней.
    html = replaceRe(html, /<h1 class="home-wordmark">([\s\S]*?)<\/h1>/,
      '<div class="home-wordmark"><span class="home-logo" aria-hidden="true"></span><span class="visually-hidden">Picta</span></div>', "h1 главной");
    html = between(html, aboutStart, aboutEnd, "\n", "блок о сервисе");
    html = replaceOnce(html, '  <div class="toolbar">', `  <section class="landing-intro">
    <nav class="landing-crumbs" aria-label="Навигация"><a href="/">Picta</a><span aria-hidden="true">/</span><span>${esc(page.name)}</span></nav>
    <h1>${esc(page.h1)}</h1>
    <p>${esc(page.intro)}</p>
  </section>

  <div class="toolbar">`, "вступление над выдачей");
    html = replaceOnce(html, "  </main>", `    <section class="landing-more">
      <h2>${esc(page.h1)}: как искать</h2>
${paragraphs("      ")}
      <h2>Другие подборки</h2>
      <nav class="landing-links" aria-label="Другие подборки">
${linksHtml(page.path, "        ")}
        <a href="/">Все источники</a>
      </nav>
    </section>
  </main>`, "текст под выдачей");
  } else {
    // Подборка-режим (иконки, видео): главный экран в нужном режиме, текст —
    // на месте блока «о сервисе».
    html = replaceRe(html, /<span class="visually-hidden" data-i18n="home_h1">[^<]*<\/span>/,
      `<span class="visually-hidden">${esc(page.h1)}</span>`, "h1 главной");
    html = between(html, aboutStart, aboutEnd, `
    <section class="home-about" aria-labelledby="homeAboutTitle">
      <h2 id="homeAboutTitle">${esc(page.h2 || page.h1)}</h2>
${paragraphs("      ")}
      <h2>Другие подборки</h2>
      <nav class="landing-links" aria-label="Другие подборки">
${linksHtml(page.path, "        ")}
        <a href="/">Все источники</a>
      </nav>
    </section>
`, "блок о сервисе");
  }
  return html;
}

function buildSitemap() {
  const urls = [{ loc: `${SITE}/`, priority: "1.0" }, ...PAGES.map((p) => ({ loc: SITE + p.path, priority: "0.8" }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${UPDATED}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

// Все файлы, которые должны лежать в репозитории: { rel, content }.
function outputs() {
  const index = buildIndex(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
  const files = [{ rel: "index.html", content: index }];
  for (const page of PAGES) {
    files.push({ rel: path.join(page.path.replace(/^\/|\/$/g, ""), "index.html"), content: buildPage(index, page) });
  }
  files.push({ rel: "sitemap.xml", content: buildSitemap() });
  return files;
}

function build({ check = false } = {}) {
  const stale = [];
  for (const { rel, content } of outputs()) {
    const file = path.join(ROOT, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current === content) continue;
    stale.push(rel);
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  return stale;
}

module.exports = { build, PAGES };

if (require.main === module) {
  const changed = build();
  console.log(changed.length ? `Обновлено: ${changed.join(", ")}` : "Всё уже актуально");
}
