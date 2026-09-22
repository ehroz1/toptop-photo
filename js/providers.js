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

  function withAuthHeader(url, opts) {
    if (!CONFIG.WORKER_BASE_URL || !url.startsWith(CONFIG.WORKER_BASE_URL)) return opts;
    const token = global.PhotoSeekAuth && global.PhotoSeekAuth.getAccessToken();
    if (!token) return opts;
    return { ...opts, headers: { ...(opts && opts.headers), Authorization: `Bearer ${token}` } };
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
  // (HTTP-код, текст ответа сервера или сетевой/CORS-сбой). Запросам к
  // воркеру дополнительно подставляет токен сессии Supabase (если
  // пользователь вошёл) — так воркер снимает с него дневной лимит гостя.
  async function fetchJson(url, opts) {
    let res;
    const finalOpts = withAuthHeader(url, opts);
    try {
      res = await fetch(url, finalOpts);
    } catch (err) {
      // AbortError (запрос отменён через signal — новый поиск стартовал раньше,
      // чем ответил этот) — пробрасываем как есть, не заворачивая в обычную
      // "сетевую" ошибку: вызывающему коду (app.js) важно отличить намеренную
      // отмену от настоящего сбоя, чтобы не показывать по ней предупреждение.
      if (err.name === "AbortError") throw err;
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
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", people = "any", signal } = {}) {
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
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pixabay?${qs}`, { signal });
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
    async search(query, { page = 1, orientation = "any", color = "any", signal } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
        color: mapColor(PEXELS_COLOR_MAP, color),
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pexels?${qs}`, { signal });
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
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", signal } = {}) {
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
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/unsplash/search?${qs}`, { signal });
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
    async search(query, { page = 1, orientation = "any", signal } = {}) {
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
      const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${qs}`, { signal });
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
    async search(query, { page = 1, orientation = "any", signal } = {}) {
      const aspectMap = { any: undefined, horizontal: "wide", vertical: "tall", square: "square" };
      const qs = buildQuery({
        q: query,
        page,
        // Анонимные (без ключа) запросы Openverse разрешают максимум 20 на страницу —
        // больше отдаёт 401 Unauthorized.
        page_size: 20,
        aspect_ratio: aspectMap[orientation],
      });
      const data = await fetchJson(`https://api.openverse.org/v1/images/?${qs}`, { signal });
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

  // Doodl — каталог AI-сгенерированных стоковых фото, публичный CORS-API без
  // ключа (сделан специально для встраивания в сторонние приложения — плагины
  // для Figma/Canva/Framer и т.п.), поэтому обращаемся напрямую с клиента,
  // без Cloudflare Worker. Пагинация обычная (page), но чтобы результаты не
  // "плавали" между страницами одного поиска, сервер использует случайный
  // seed — сохраняем его с первой страницы и передаём на следующих (как и
  // курсор у Pexafy, но без ограничения по времени жизни).
  const doodlSeeds = new Map();
  const DoodlProvider = {
    id: "doodl",
    label: "Doodl",
    enabled: () => true, // ключ не нужен
    async search(query, { page = 1, orientation = "any", signal } = {}) {
      if (page === 1) doodlSeeds.delete(query);
      const qs = buildQuery({
        q: query,
        page,
        per_page: 24,
        seed: page > 1 ? doodlSeeds.get(query) : undefined,
      });
      const data = await fetchJson(`https://www.doodl.co/api/plugin/search?${qs}`, { signal });
      if (data.seed) doodlSeeds.set(query, data.seed);
      let items = (data.results || []).map((p) => ({
        id: `doodl-${p.id}`,
        provider: "doodl",
        thumb: p.urls?.small || p.urls?.thumbnail,
        full: p.urls?.large || p.urls?.medium,
        width: p.width,
        height: p.height,
        title: p.title || "",
        description: p.description || "",
        tags: p.tags || [],
        author: p.creator?.name,
        authorUrl: p.creator?.profile_url,
        pageUrl: p.page_url,
        download: { type: "direct", url: p.urls?.download ? `${p.urls.download}?resolution=large` : p.urls?.large },
        // Весь каталог Doodl — AI-сгенерированные изображения, а не фотографии
        // (см. описание сервиса) — явный флаг, чтобы UI не выдавал их за
        // обычные фото (см. рендер бейджа "AI" в app.js).
        aiGenerated: true,
        license: {
          name: "Doodl License",
          url: p.license?.url,
          commercial: p.license?.commercial_use,
          attribution: p.license?.attribution_required,
        },
      })).filter((it) => it.thumb);
      items = filterByOrientation(items, orientation);
      return { items, total: typeof data.total === "number" ? data.total : null };
    },
  };

  const FlickrProvider = {
    id: "flickr",
    label: "Flickr",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL && CONFIG.FLICKR_ENABLED),
    async search(query, { page = 1, orientation = "any", sort = "popular", signal } = {}) {
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
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/flickr?${qs}`, { signal });
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

  // Shutterstock Content Search API v2 — в отличие от остальных источников,
  // бесплатный тариф не даёт прав на полноразмерное фото: превью в выдаче и
  // "скачивание" — это одна и та же водяная картинка со знаком Shutterstock,
  // настоящий файл открывается только после покупки лицензии на их сайте
  // (см. license.requiresPurchase — отдельная плашка в лайтбоксе).
  const SHUTTERSTOCK_ORIENTATION_MAP = { any: undefined, horizontal: "horizontal", vertical: "vertical", square: "square" };
  const SHUTTERSTOCK_SORT_MAP = { popular: "popular", newest: "newest" };
  // Общий хелпер: цвет в нашем UI задан именем ("bw"/"red"/…), а не hex —
  // переиспользуем hex из COLOR_OPTIONS и там, где API просит именно hex
  // (Shutterstock, Pexafy), а не свой список именованных цветов.
  function hexForColor(color) {
    if (!color || color === "any") return undefined;
    const opt = COLOR_OPTIONS.find((c) => c.id === color);
    return opt ? opt.hex : undefined;
  }
  const ShutterstockProvider = {
    id: "shutterstock",
    label: "Shutterstock",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", signal } = {}) {
      const qs = buildQuery({
        query,
        page,
        per_page: 24,
        image_type: "photo",
        sort: SHUTTERSTOCK_SORT_MAP[sort] || "popular",
        orientation: SHUTTERSTOCK_ORIENTATION_MAP[orientation],
        color: hexForColor(color)?.replace("#", ""),
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/shutterstock?${qs}`, { signal });
      const items = (data.data || []).map((p) => {
        const assets = p.assets || {};
        const previewFull = assets.preview_1500 || assets.preview_1000 || assets.preview || assets.huge_thumb;
        const previewThumb = assets.large_thumb || assets.preview || previewFull;
        const pageUrl = `https://www.shutterstock.com/image-photo/-${p.id}`;
        return {
          id: `shutterstock-${p.id}`,
          provider: "shutterstock",
          thumb: previewThumb?.url,
          full: previewFull?.url,
          width: previewFull?.width,
          height: previewFull?.height,
          title: p.description || "",
          description: p.description || "",
          tags: Array.isArray(p.keywords) ? p.keywords.slice(0, 20) : [],
          author: undefined,
          authorUrl: undefined,
          pageUrl,
          download: { type: "direct", url: previewFull?.url },
          license: { name: "Shutterstock", url: pageUrl, requiresPurchase: true },
        };
      }).filter((it) => it.thumb);
      return { items, total: typeof data.total_count === "number" ? data.total_count : null };
    },
  };

  // Pexafy — семантический поиск по девяти бесплатным фотостокам сразу
  // (Unsplash/Pexels/Pixabay/Kaboompics/Burst/StockSnap/Picjumbo/Skitterphoto/
  // NegativeSpace), свой собственный free-to-use агрегатор, без требования
  // атрибуции (см. docs.pexafy.com). Пагинация курсорная, а не по номеру
  // страницы — pexafyCursors хранит next_cursor на время текущего поиска по
  // ключу параметров запроса; курсор живёт у Pexafy ~5 минут, поэтому если
  // его нет (новый поиск/протух) — просто считаем, что страниц больше нет.
  const pexafyCursors = new Map();
  const PEXAFY_ORIENTATION_MAP = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
  const PEXAFY_SORT_MAP = { popular: "relevance", newest: "newest" };
  const PexafyProvider = {
    id: "pexafy",
    label: "Pexafy",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", sort = "popular", color = "any", signal } = {}) {
      const cursorKey = JSON.stringify({ query, orientation, sort, color });
      if (page === 1) pexafyCursors.delete(cursorKey);
      const cursor = page > 1 ? pexafyCursors.get(cursorKey) : undefined;
      if (page > 1 && !cursor) return { items: [], total: null }; // курсор закончился/протух — дальше страниц нет

      const qs = buildQuery({
        q: query,
        per_page: 24,
        orientation: PEXAFY_ORIENTATION_MAP[orientation],
        sort_by: PEXAFY_SORT_MAP[sort] || "relevance",
        color_hex: color !== "bw" ? hexForColor(color) : undefined,
        cursor,
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pexafy?${qs}`, { signal });
      if (data.pagination?.next_cursor) pexafyCursors.set(cursorKey, data.pagination.next_cursor);
      else pexafyCursors.delete(cursorKey);

      const items = (data.data || []).map((p) => ({
        id: `pexafy-${p.photo_id}`,
        provider: "pexafy",
        thumb: p.urls?.small || p.urls?.thumb,
        full: p.urls?.regular || p.urls?.large || p.urls?.full,
        width: p.width,
        height: p.height,
        title: p.description || "",
        description: p.alt_description || p.description || "",
        tags: [],
        author: p.photographer_username,
        authorUrl: undefined,
        pageUrl: p.source_image_url || p.urls?.full,
        download: { type: "direct", url: p.urls?.full || p.urls?.large || p.urls?.regular },
        // Pexafy сама заявляет весь свой каталог как free-to-use без обязательной
        // атрибуции (агрегирует Unsplash/Pexels/Pixabay и другие бесплатные стоки) —
        // как и у Pixabay/Pexels/Unsplash, лицензия одна на источник, не на файл.
        license: { name: "Pexafy (free, no attribution)", url: "https://pexafy.com/pricing", commercial: true, attribution: false },
      })).filter((it) => it.thumb);
      return { items, total: null };
    },
  };

  global.PROVIDERS = [
    PixabayProvider,
    PexelsProvider,
    WikimediaProvider,
    OpenverseProvider,
    DoodlProvider,
    UnsplashProvider,
    ShutterstockProvider,
    PexafyProvider,
    FlickrProvider,
  ];
  global.COLOR_OPTIONS = COLOR_OPTIONS;
  global.matchesPeopleFilter = matchesPeopleFilter;
})(window);
