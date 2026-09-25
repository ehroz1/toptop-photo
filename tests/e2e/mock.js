// Общие сетевые моки для Playwright: сайт реальный (localhost), все внешние
// API и превью — синтетические, с настраиваемой задержкой.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function pixabayBody(q, n) {
  return { totalHits: 500, hits: Array.from({ length: n }, (_, i) => ({
    id: `${q}${i}`.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0,
    webformatURL: `https://img.test/pixabay/${q}/${i}.png`, largeImageURL: `https://img.test/pixabay/${q}/${i}-l.png`,
    imageWidth: 1200, imageHeight: 800 + (i % 3) * 200, tags: `${q}, animal`, user: "u", user_id: 1, pageURL: "https://x.test",
  })) };
}
function pexelsBody(q, n) {
  return { total_results: 500, photos: Array.from({ length: n }, (_, i) => ({
    id: 900000 + i + q.length * 1000, src: { medium: `https://img.test/pexels/${q}/${i}.png`, original: `https://img.test/pexels/${q}/${i}-o.png` },
    width: 1200, height: 900, alt: q, photographer: "p", photographer_url: "https://x.test", url: "https://x.test",
  })) };
}

async function installMocks(page, opts = {}) {
  const imgDelay = opts.imgDelay ?? 1500;
  const apiDelay = opts.apiDelay ?? 100;
  const stats = { imgRequested: 0, imgServed: 0 };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname === "img.test") {
      stats.imgRequested++;
      await new Promise((r) => setTimeout(r, imgDelay));
      stats.imgServed++;
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1, headers: { "access-control-allow-origin": "*" } }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, apiDelay));
    const q = (url.searchParams.get("q") || url.searchParams.get("query") || "x").replace(/\W/g, "");
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } }).catch(() => {});
    if (url.pathname === "/pixabay") return json(pixabayBody(q, 20));
    if (url.pathname === "/pexels") return json(pexelsBody(q, 20));
    if (url.hostname.includes("mymemory")) return json({ responseData: { translatedText: url.searchParams.get("q") } });
    if (url.hostname.includes("speller")) return json([]);
    if (url.hostname.includes("wikimedia")) return json({ query: { pages: {} } });
    if (url.hostname.includes("openverse")) return json({ results: [], result_count: 0 });
    if (url.hostname.includes("doodl")) return json({ results: [], total: 0 });
    if (url.pathname.endsWith("/log-search")) return json({ ok: true });
    if (url.pathname.endsWith("/stats/downloads")) return json({ downloads: 1234 });
    return route.abort();
  });
  return stats;
}

module.exports = { installMocks };
