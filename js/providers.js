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

  function stripHtml(str) {
    return (str || "").replace(/<[^>]*>/g, "").trim();
  }

  // Ориентация не поддерживается API напрямую — фильтруем то, что уже получили.
  function filterByOrientation(items, orientation) {
    if (orientation === "any") return items;
    return items.filter((it) => {
      if (!it.width || !it.height) return true;
      const ratio = it.width / it.height;
      if (orientation === "square") return Math.abs(ratio - 1) < 0.15;
      if (orientation === "horizontal") return ratio > 1.15;
      if (orientation === "vertical") return ratio < 0.87;
      return true;
    });
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

  const WikimediaProvider = {
    id: "wikimedia",
    label: "Wikimedia Commons",
    enabled: () => true, // ключ не нужен
    async search(query, { page = 1, orientation = "any" } = {}) {
      const limit = 24;
      const qs = buildQuery({
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: 6, // File:
        gsrlimit: limit,
        gsroffset: (page - 1) * limit,
        prop: "imageinfo",
        iiprop: "url|size|extmetadata|mime",
        iiurlwidth: 1200,
        format: "json",
        origin: "*",
      });
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${qs}`);
      if (!res.ok) throw new Error(`Wikimedia: ${res.status}`);
      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});
      let items = pages
        .filter((p) => p.imageinfo?.[0]?.mime?.startsWith("image/") && !p.imageinfo[0].mime.includes("svg"))
        .map((p) => {
          const info = p.imageinfo[0];
          const meta = info.extmetadata || {};
          const niceTitle = p.title.replace(/^File:/, "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/_/g, " ");
          return {
            id: `wikimedia-${p.pageid}`,
            provider: "wikimedia",
            thumb: info.thumburl || info.url,
            full: info.thumburl || info.url,
            width: info.thumbwidth || info.width,
            height: info.thumbheight || info.height,
            title: niceTitle,
            description: stripHtml(meta.ImageDescription?.value).slice(0, 400),
            tags: [],
            author: stripHtml(meta.Artist?.value) || undefined,
            authorUrl: undefined,
            pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
            download: { type: "direct", url: info.url },
          };
        });
      items = filterByOrientation(items, orientation);
      return { items, total: null };
    },
  };

  const OpenverseProvider = {
    id: "openverse",
    label: "Openverse",
    enabled: () => true, // ключ не нужен (анонимный доступ ограничен по частоте)
    async search(query, { page = 1, orientation = "any" } = {}) {
      const aspectMap = { any: undefined, horizontal: "wide", vertical: "tall", square: "square" };
      const qs = buildQuery({
        q: query,
        page,
        // Анонимные (без ключа) запросы Openverse разрешают максимум 20 на страницу —
        // больше отдаёт 401 Unauthorized.
        page_size: 20,
        aspect_ratio: aspectMap[orientation],
      });
      const res = await fetch(`https://api.openverse.org/v1/images/?${qs}`);
      if (!res.ok) throw new Error(`Openverse: ${res.status}`);
      const data = await res.json();
      const items = (data.results || []).map((p) => ({
        id: `openverse-${p.id}`,
        provider: "openverse",
        thumb: p.thumbnail || p.url,
        full: p.url,
        width: p.width,
        height: p.height,
        title: p.title || "",
        description: p.license ? `Лицензия: ${p.license.toUpperCase()}${p.license_version ? " " + p.license_version : ""}` : "",
        tags: (p.tags || []).map((t) => t.name).filter(Boolean),
        author: p.creator,
        authorUrl: p.creator_url,
        pageUrl: p.foreign_landing_url,
        download: { type: "direct", url: p.url },
      }));
      return { items, total: data.result_count ?? null };
    },
  };

  const FlickrProvider = {
    id: "flickr",
    label: "Flickr",
    enabled: () => Boolean(CONFIG.FLICKR_API_KEY),
    async search(query, { page = 1, orientation = "any", sort = "popular" } = {}) {
      const sortMap = { popular: "relevance", newest: "date-posted-desc" };
      const qs = buildQuery({
        method: "flickr.photos.search",
        api_key: CONFIG.FLICKR_API_KEY,
        text: query,
        sort: sortMap[sort] || "relevance",
        // только лицензии, допускающие свободное использование/переработку
        license: "1,2,3,4,5,6,7,8,9,10",
        content_type: 1,
        media: "photos",
        safe_search: 1,
        per_page: 24,
        page,
        extras: "url_c,url_l,url_o,o_dims,owner_name,description,tags",
        format: "json",
        nojsoncallback: 1,
      });
      const res = await fetch(`https://api.flickr.com/services/rest/?${qs}`);
      if (!res.ok) throw new Error(`Flickr: ${res.status}`);
      const data = await res.json();
      if (data.stat !== "ok") throw new Error(`Flickr: ${data.message || "error"}`);
      let items = (data.photos?.photo || []).map((p) => {
        const width = p.o_width ? Number(p.o_width) : undefined;
        const height = p.o_height ? Number(p.o_height) : undefined;
        return {
          id: `flickr-${p.id}`,
          provider: "flickr",
          thumb: p.url_c || p.url_l || p.url_o,
          full: p.url_l || p.url_c || p.url_o,
          width,
          height,
          title: p.title || "",
          description: stripHtml(p.description?._content).slice(0, 400),
          tags: (p.tags || "").split(" ").filter(Boolean),
          author: p.ownername,
          authorUrl: `https://www.flickr.com/photos/${p.owner}/`,
          pageUrl: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
          download: { type: "direct", url: p.url_o || p.url_l || p.url_c },
        };
      }).filter((it) => it.thumb);
      items = filterByOrientation(items, orientation);
      return { items, total: data.photos?.total ? Number(data.photos.total) : null };
    },
  };

  global.PROVIDERS = [
    PixabayProvider,
    PexelsProvider,
    UnsplashProvider,
    WikimediaProvider,
    OpenverseProvider,
    FlickrProvider,
  ];
  global.UNSPLASH_CONFIG = CONFIG;
})(window);
