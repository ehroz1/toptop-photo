// Провайдеры фотостоков. Каждый provider.search(query, {page, orientation, sort})
// возвращает { items: NormalizedItem[], total: number|null }.
// NormalizedItem: { id, provider, thumb, full, width, height, title, description,
//                    tags, author, authorUrl, pageUrl, download }
// download описывает, как скачать файл: { type: 'direct', url } или
// { type: 'unsplash', locationUrl, url }.

(function (global) {
  const CONFIG = global.APP_CONFIG || {};

  function buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  const PixabayProvider = {
    id: "pixabay",
    label: "Pixabay",
    enabled: () => Boolean(CONFIG.PIXABAY_KEY),
    async search(query, { page = 1, orientation = "any", sort = "popular" } = {}) {
      const orientationMap = { any: "all", horizontal: "horizontal", vertical: "vertical", square: "all" };
      const orderMap = { popular: "popular", newest: "latest" };
      const qs = buildQuery({
        key: CONFIG.PIXABAY_KEY,
        q: query,
        image_type: "photo",
        safesearch: "true",
        per_page: 24,
        page,
        orientation: orientationMap[orientation] || "all",
        order: orderMap[sort] || "popular",
      });
      const res = await fetch(`https://pixabay.com/api/?${qs}`);
      if (!res.ok) throw new Error(`Pixabay: ${res.status}`);
      const data = await res.json();
      let items = (data.hits || []).map((hit) => ({
        id: `pixabay-${hit.id}`,
        provider: "pixabay",
        thumb: hit.webformatURL,
        full: hit.largeImageURL || hit.webformatURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        title: hit.tags,
        description: "",
        tags: (hit.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
        author: hit.user,
        authorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
        pageUrl: hit.pageURL,
        download: { type: "direct", url: hit.largeImageURL || hit.webformatURL },
      }));
      if (orientation === "square") {
        items = items.filter((it) => it.width && it.height && Math.abs(it.width / it.height - 1) < 0.15);
      }
      return { items, total: data.totalHits ?? null };
    },
  };

  const PexelsProvider = {
    id: "pexels",
    label: "Pexels",
    enabled: () => Boolean(CONFIG.PEXELS_KEY),
    async search(query, { page = 1, orientation = "any" } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
      });
      const res = await fetch(`https://api.pexels.com/v1/search?${qs}`, {
        headers: { Authorization: CONFIG.PEXELS_KEY },
      });
      if (!res.ok) throw new Error(`Pexels: ${res.status}`);
      const data = await res.json();
      const items = (data.photos || []).map((p) => ({
        id: `pexels-${p.id}`,
        provider: "pexels",
        thumb: p.src.large || p.src.medium,
        full: p.src.original,
        width: p.width,
        height: p.height,
        title: p.alt || "",
        description: p.alt || "",
        tags: [],
        author: p.photographer,
        authorUrl: p.photographer_url,
        pageUrl: p.url,
        download: { type: "direct", url: p.src.original },
      }));
      return { items, total: data.total_results ?? null };
    },
  };

  const UnsplashProvider = {
    id: "unsplash",
    label: "Unsplash",
    enabled: () => Boolean(CONFIG.UNSPLASH_ACCESS_KEY),
    async search(query, { page = 1, orientation = "any", sort = "popular" } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "squarish" };
      const orderMap = { popular: "relevant", newest: "latest" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
        order_by: orderMap[sort] || "relevant",
      });
      const res = await fetch(`https://api.unsplash.com/search/photos?${qs}`, {
        headers: { Authorization: `Client-ID ${CONFIG.UNSPLASH_ACCESS_KEY}` },
      });
      if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
      const data = await res.json();
      const items = (data.results || []).map((p) => ({
        id: `unsplash-${p.id}`,
        provider: "unsplash",
        thumb: p.urls.small,
        full: p.urls.regular,
        width: p.width,
        height: p.height,
        title: p.description || p.alt_description || "",
        description: p.description || p.alt_description || "",
        tags: (p.tags || []).map((t) => t.title).filter(Boolean),
        author: p.user?.name,
        authorUrl: p.user?.links?.html,
        pageUrl: p.links?.html,
        download: { type: "unsplash", locationUrl: p.links?.download_location, url: p.urls.full },
      }));
      return { items, total: data.total ?? null };
    },
  };

  global.PROVIDERS = [PixabayProvider, PexelsProvider, UnsplashProvider];
  global.UNSPLASH_CONFIG = CONFIG;
})(window);
