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

  // Unsplash API Guidelines требуют помечать ссылки на автора/фото меткой
  // utm_source=<имя приложения>&utm_medium=referral — без этого заявку на
  // повышение лимита (Production, 5000 запросов/час вместо 50) отклонят.
  function withUnsplashUtm(url) {
    if (!url) return url;
    const appName = CONFIG.UNSPLASH_APP_NAME || "photoseek";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}utm_source=${encodeURIComponent(appName)}&utm_medium=referral`;
  }

  // Единая обёртка над fetch с понятными сообщениями об ошибках —
  // чтобы в интерфейсе было видно не просто "ошибка", а что именно случилось
  // (HTTP-код, текст ответа сервера или сетевой/CORS-сбой).
  async function fetchJson(url, opts) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw new Error(`сеть/CORS недоступны (${err.message})`);
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch { /* тело недоступно — не критично */ }
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? " — " + detail : ""}`);
    }
    return res.json();
  }

  // Единый список цветов для фильтра — используется в app.js для отрисовки
  // палитры и здесь для маппинга в параметры конкретных API (не все
  // провайдеры поддерживают все цвета — тогда параметр просто не отправляется).
  const COLOR_OPTIONS = [
    { id: "bw", label: "Чёрно-белое", hex: "#9aa0a6" },
    { id: "black", label: "Чёрный", hex: "#161616" },
    { id: "white", label: "Белый", hex: "#ffffff" },
    { id: "gray", label: "Серый", hex: "#9e9e9e" },
    { id: "red", label: "Красный", hex: "#e53935" },
    { id: "orange", label: "Оранжевый", hex: "#fb8c00" },
    { id: "yellow", label: "Жёлтый", hex: "#fdd835" },
    { id: "green", label: "Зелёный", hex: "#43a047" },
    { id: "turquoise", label: "Бирюзовый", hex: "#00acc1" },
    { id: "blue", label: "Синий", hex: "#1e88e5" },
    { id: "purple", label: "Фиолетовый", hex: "#8e24aa" },
    { id: "pink", label: "Розовый", hex: "#ec407a" },
    { id: "brown", label: "Коричневый", hex: "#6d4c41" },
  ];

  const PIXABAY_COLOR_MAP = { bw: "grayscale", purple: "lilac" };
  const PEXELS_COLOR_MAP = { purple: "violet", bw: undefined };
  const UNSPLASH_COLOR_MAP = { bw: "black_and_white", turquoise: "teal", pink: "magenta", gray: undefined, brown: undefined };

  function mapColor(map, color) {
    if (!color || color === "any") return undefined;
    return Object.prototype.hasOwnProperty.call(map, color) ? map[color] : color;
  }

  // Эвристический фильтр "с людьми / без людей" — ни один из подключённых
  // API не даёт настоящего разделения по наличию людей на фото, поэтому
  // смотрим на теги/описание/название на English и русском.
  const PEOPLE_KEYWORDS = [
    "person", "people", "man", "men", "woman", "women", "girl", "boy", "kid", "child", "children",
    "human", "portrait", "face", "model", "couple", "family", "crowd", "guy", "lady", "teen", "baby",
    "senior", "worker", "businessman", "businesswoman", "friends", "student",
    "человек", "люди", "мужчина", "женщина", "девушка", "парень", "ребёнок", "ребенок", "дети",
    "портрет", "лицо", "семья", "толпа", "дедушка", "бабушка", "малыш",
  ];
  const PEOPLE_REGEX = new RegExp(`\\b(${PEOPLE_KEYWORDS.join("|")})\\b`, "i");
  function matchesPeopleFilter(item, people) {
    if (!people || people === "any") return true;
    const haystack = [item.title, item.description, ...(item.tags || [])].join(" ").toLowerCase();
    const hasPeople = PEOPLE_REGEX.test(haystack);
    return people === "with" ? hasPeople : !hasPeople;
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
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", people = "any" } = {}) {
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
        colors: mapColor(PIXABAY_COLOR_MAP, color),
        // бонус: Pixabay поддерживает категорию "people" — сужаем прямо на сервере,
        // а окончательную сверку по тегам всё равно делаем в app.js для всех источников
        category: people === "with" ? "people" : undefined,
      });
      const data = await fetchJson(`https://pixabay.com/api/?${qs}`);
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
    async search(query, { page = 1, orientation = "any", color = "any" } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
        color: mapColor(PEXELS_COLOR_MAP, color),
      });
      const data = await fetchJson(`https://api.pexels.com/v1/search?${qs}`, {
        headers: { Authorization: CONFIG.PEXELS_KEY },
      });
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
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any" } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "squarish" };
      const orderMap = { popular: "relevant", newest: "latest" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
        order_by: orderMap[sort] || "relevant",
        color: mapColor(UNSPLASH_COLOR_MAP, color),
      });
      const data = await fetchJson(`https://api.unsplash.com/search/photos?${qs}`, {
        headers: { Authorization: `Client-ID ${CONFIG.UNSPLASH_ACCESS_KEY}` },
      });
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
        authorUrl: withUnsplashUtm(p.user?.links?.html),
        pageUrl: withUnsplashUtm(p.links?.html),
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
      const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${qs}`);
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
      const data = await fetchJson(`https://api.openverse.org/v1/images/?${qs}`);
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
      const data = await fetchJson(`https://api.flickr.com/services/rest/?${qs}`);
      if (data.stat !== "ok") throw new Error(data.message || "error");
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
  global.COLOR_OPTIONS = COLOR_OPTIONS;
  global.matchesPeopleFilter = matchesPeopleFilter;
})(window);
