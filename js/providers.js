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
  // label больше не хранится тут — заголовок цвета берётся из словаря
  // переводов (js/i18n.js) по ключу `color_${id}`, чтобы работать и на
  // русском, и на английском интерфейсе.
  const COLOR_OPTIONS = [
    { id: "bw", hex: "#9aa0a6" },
    { id: "black", hex: "#161616" },
    { id: "white", hex: "#ffffff" },
    { id: "gray", hex: "#9e9e9e" },
    { id: "red", hex: "#e53935" },
    { id: "orange", hex: "#fb8c00" },
    { id: "yellow", hex: "#fdd835" },
    { id: "green", hex: "#43a047" },
    { id: "turquoise", hex: "#00acc1" },
    { id: "blue", hex: "#1e88e5" },
    { id: "purple", hex: "#8e24aa" },
    { id: "pink", hex: "#ec407a" },
    { id: "brown", hex: "#6d4c41" },
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

  // Понятная информация по лицензии — item.license = { name, url, commercial,
  // attribution }. У Pixabay/Pexels/Unsplash лицензия одна на весь сток
  // (задаём статически), а у Wikimedia/Openverse/Flickr лицензия своя у
  // каждого файла — разбираем её из ответа API.
  const CC_CODE_NAMES = {
    cc0: "CC0",
    by: "CC BY",
    "by-sa": "CC BY-SA",
    "by-nc": "CC BY-NC",
    "by-nc-sa": "CC BY-NC-SA",
    "by-nd": "CC BY-ND",
    "by-nc-nd": "CC BY-NC-ND",
    pdm: "Public Domain",
  };
  function classifyLicenseCode(code, url) {
    const c = (code || "").toLowerCase();
    if (!CC_CODE_NAMES[c]) return null;
    return {
      name: CC_CODE_NAMES[c],
      url,
      commercial: !/nc/.test(c),
      attribution: c !== "cc0" && c !== "pdm",
    };
  }
  function parseWikimediaLicenseCode(shortName) {
    const s = (shortName || "").toLowerCase();
    if (/cc0|public domain|\bpd\b/.test(s)) return "cc0";
    if (/by-nc-nd/.test(s)) return "by-nc-nd";
    if (/by-nc-sa/.test(s)) return "by-nc-sa";
    if (/by-nc/.test(s)) return "by-nc";
    if (/by-sa/.test(s)) return "by-sa";
    if (/by-nd/.test(s)) return "by-nd";
    if (/\bby\b/.test(s)) return "by";
    return null;
  }
  // Числовые коды лицензий Flickr (1-10, 0="все права защищены" уже
  // отфильтрован на уровне запроса) — официально стабильные, не меняются.
  const FLICKR_LICENSE_MAP = {
    1: ["by-nc-sa", "https://creativecommons.org/licenses/by-nc-sa/2.0/"],
    2: ["by-nc", "https://creativecommons.org/licenses/by-nc/2.0/"],
    3: ["by-nc-nd", "https://creativecommons.org/licenses/by-nc-nd/2.0/"],
    4: ["by", "https://creativecommons.org/licenses/by/2.0/"],
    5: ["by-sa", "https://creativecommons.org/licenses/by-sa/2.0/"],
    6: ["by-nd", "https://creativecommons.org/licenses/by-nd/2.0/"],
    7: ["pdm", "https://www.flickr.com/commons/usage/"],
    8: ["pdm", "https://www.usa.gov/government-works"],
    9: ["cc0", "https://creativecommons.org/publicdomain/zero/1.0/"],
    10: ["pdm", "https://creativecommons.org/publicdomain/mark/1.0/"],
  };

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
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", people = "any" } = {}) {
      const orientationMap = { any: "all", horizontal: "horizontal", vertical: "vertical", square: "all" };
      const orderMap = { popular: "popular", newest: "latest" };
      const qs = buildQuery({
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
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pixabay?${qs}`);
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
        license: { name: "Pixabay License", url: "https://pixabay.com/service/license-summary/", commercial: true, attribution: false },
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
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", color = "any" } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
        color: mapColor(PEXELS_COLOR_MAP, color),
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pexels?${qs}`);
      const items = (data.photos || []).map((p) => ({
        id: `pexels-${p.id}`,
        provider: "pexels",
        // src.medium — 350px, с запасом хватает на карточку сетки шириной
        // ~280px; src.large (940px) грузился явно тяжелее, чем нужно для
        // превью, и заметно тормозил выдачу.
        thumb: p.src.medium || p.src.small,
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
        license: { name: "Pexels License", url: "https://www.pexels.com/license/", commercial: true, attribution: false },
      }));
      return { items, total: data.total_results ?? null };
    },
  };

  const UnsplashProvider = {
    id: "unsplash",
    label: "Unsplash",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
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
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/unsplash/search?${qs}`);
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
        license: { name: "Unsplash License", url: "https://unsplash.com/license", commercial: true, attribution: false },
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
        // 800px с запасом хватает и на карточку сетки, и на просмотр в
        // лайтбоксе (кнопка "Скачать" всё равно ведёт на оригинал через
        // info.url, а не на этот уменьшенный превью) — 1200px только зря
        // утяжелял каждую карточку Wikimedia в выдаче.
        iiurlwidth: 800,
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
            license: (() => {
              const shortName = stripHtml(meta.LicenseShortName?.value || "");
              const code = parseWikimediaLicenseCode(shortName);
              const classified = code && classifyLicenseCode(code, meta.LicenseUrl?.value);
              return classified || { name: shortName || null, url: meta.LicenseUrl?.value, commercial: undefined, attribution: undefined };
            })(),
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
        description: "",
        tags: (p.tags || []).map((t) => t.name).filter(Boolean),
        author: p.creator,
        authorUrl: p.creator_url,
        pageUrl: p.foreign_landing_url,
        download: { type: "direct", url: p.url },
        license: classifyLicenseCode(p.license, p.license_url)
          || { name: p.license ? p.license.toUpperCase() : null, url: p.license_url, commercial: undefined, attribution: undefined },
      }));
      return { items, total: data.result_count ?? null };
    },
  };

  const FlickrProvider = {
    id: "flickr",
    label: "Flickr",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL && CONFIG.FLICKR_ENABLED),
    async search(query, { page = 1, orientation = "any", sort = "popular" } = {}) {
      const sortMap = { popular: "relevance", newest: "date-posted-desc" };
      const qs = buildQuery({
        method: "flickr.photos.search",
        text: query,
        sort: sortMap[sort] || "relevance",
        // только лицензии, допускающие свободное использование/переработку
        license: "1,2,3,4,5,6,7,8,9,10",
        content_type: 1,
        media: "photos",
        safe_search: 1,
        per_page: 24,
        page,
        extras: "url_n,url_c,url_l,url_o,o_dims,owner_name,description,tags,license",
        format: "json",
        nojsoncallback: 1,
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/flickr?${qs}`);
      if (data.stat !== "ok") throw new Error(data.message || "error");
      let items = (data.photos?.photo || []).map((p) => {
        const width = p.o_width ? Number(p.o_width) : undefined;
        const height = p.o_height ? Number(p.o_height) : undefined;
        return {
          id: `flickr-${p.id}`,
          provider: "flickr",
          // url_n — 320px по длинной стороне, для карточки сетки достаточно;
          // раньше не запрашивали ничего мельче url_c (800px), а без него
          // превью иногда падало сразу на оригинал (может быть много МБ).
          thumb: p.url_n || p.url_c || p.url_l || p.url_o,
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
          license: (() => {
            const mapped = FLICKR_LICENSE_MAP[p.license];
            return mapped ? classifyLicenseCode(mapped[0], mapped[1]) : null;
          })(),
        };
      }).filter((it) => it.thumb);
      items = filterByOrientation(items, orientation);
      return { items, total: data.photos?.total ? Number(data.photos.total) : null };
    },
  };

  // Shutterstock — платный сток (см. cloudflare-worker/worker.js). Внимание:
  // поля ниже собраны по общему знанию их публичного v2 REST API
  // (api.shutterstock.com/v2/images/search) без сверки с живой
  // документацией — если после включения что-то не парсится, скорее всего
  // разошлось конкретное имя поля в ответе, а не сам подход. Поиск отдаёт
  // ТОЛЬКО превью с водяным знаком — реальный файл покупается на их сайте,
  // поэтому download здесь ведёт на страницу товара, а не на сам файл.
  const ShutterstockProvider = {
    id: "shutterstock",
    label: "Shutterstock",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL && CONFIG.SHUTTERSTOCK_ENABLED),
    async search(query, { page = 1, orientation = "any", sort = "popular" } = {}) {
      const orientationMap = { any: undefined, horizontal: "horizontal", vertical: "vertical", square: "square" };
      const sortMap = { popular: "popular", newest: "newest" };
      const qs = buildQuery({
        query,
        page,
        per_page: 24,
        sort: sortMap[sort] || "popular",
        orientation: orientationMap[orientation],
        image_type: "photo",
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/shutterstock?${qs}`);
      const items = (data.data || []).map((p) => {
        const assets = p.assets || {};
        const preview = assets.preview || assets.preview_1500 || assets.large_thumb || assets.huge_thumb;
        const thumb = assets.small_thumb || assets.preview || preview;
        if (!thumb?.url || !preview?.url) return null;
        const pageUrl = `https://www.shutterstock.com/image-photo/${p.id}`;
        return {
          id: `shutterstock-${p.id}`,
          provider: "shutterstock",
          thumb: thumb.url,
          full: preview.url,
          width: preview.width,
          height: preview.height,
          title: p.description || "",
          description: p.description || "",
          tags: (p.keywords || []).slice(0, 12),
          author: p.contributor?.name,
          authorUrl: undefined,
          pageUrl,
          // "external" — открываем страницу покупки лицензии, а не качаем
          // сам превью-файл как будто это готовое к использованию фото.
          download: { type: "external", url: pageUrl },
          license: { name: "Shutterstock License", url: "https://www.shutterstock.com/license", commercial: true, attribution: false },
        };
      }).filter(Boolean);
      return { items, total: data.total_count ?? null };
    },
  };

  global.PROVIDERS = [
    PixabayProvider,
    PexelsProvider,
    UnsplashProvider,
    WikimediaProvider,
    OpenverseProvider,
    FlickrProvider,
    ShutterstockProvider,
  ];
  global.COLOR_OPTIONS = COLOR_OPTIONS;
  global.matchesPeopleFilter = matchesPeopleFilter;
})(window);
