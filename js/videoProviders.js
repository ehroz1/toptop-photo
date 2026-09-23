// Провайдеры видео — отдельный от фото/иконок пайплайн (см. runVideoSearch
// в app.js), но по архитектуре (прогрессивный независимый опрос каждого
// источника, ранжирование, дедуп по URL, AbortController) — точная копия
// фото-пайплайна, просто с другим набором полей у элемента.
//
// NormalizedVideoItem: { id, provider, thumb, videoUrl, full, fileExt,
//   width, height, duration (сек, может быть null), title, description,
//   tags, author, authorUrl, pageUrl, download, license }
// full === videoUrl — так downloadItem()/filenameFor() в app.js работают
// с видео без отдельной ветки кода (они написаны для фото и ссылаются на
// item.full как "то, что скачивать/открывать по умолчанию").
(function (global) {
  "use strict";

  const CONFIG = global.APP_CONFIG || {};

  function buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }

  function withAuthHeader(url, opts) {
    if (!CONFIG.WORKER_BASE_URL || !url.startsWith(CONFIG.WORKER_BASE_URL)) return opts;
    const token = global.PhotoSeekAuth && global.PhotoSeekAuth.getAccessToken();
    if (!token) return opts;
    return { ...opts, headers: { ...(opts && opts.headers), Authorization: `Bearer ${token}` } };
  }

  async function fetchJson(url, opts) {
    let res;
    const finalOpts = withAuthHeader(url, opts);
    try {
      res = await fetch(url, finalOpts);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      // Запрос не дошёл или браузер не пустил ответ (CORS) — в обоих случаях
      // это TypeError без подробностей. Помечаем, чтобы app.js показал
      // одну понятную строку на все такие источники сразу.
      const netErr = new Error(`сеть/CORS недоступны (${err.message})`);
      netErr.isNetwork = true;
      throw netErr;
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 200); } catch { /* тело недоступно */ }
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? " — " + detail : ""}`);
    }
    return res.json();
  }

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

  // ---------- Pixabay Video ----------
  // Тот же ключ (PIXABAY_KEY), что и у фото-Pixabay — их API просто отдаёт
  // видео вместо фото на отдельном эндпоинте /api/videos/.
  const PixabayVideoProvider = {
    id: "pixabay",
    label: "Pixabay",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", sort = "popular", signal } = {}) {
      const orderMap = { popular: "popular", newest: "latest" };
      const qs = buildQuery({
        q: query,
        per_page: 24,
        page,
        safesearch: "true",
        order: orderMap[sort] || "popular",
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pixabay-video?${qs}`, { signal });
      let items = (data.hits || []).map((hit) => {
        const v = hit.videos || {};
        const best = v.large || v.medium || v.small || v.tiny || {};
        // Pixabay не всегда кладёт готовый JPG-превью прямо в videos.*.thumbnail —
        // на этот случай строим его по документированному шаблону их CDN из
        // picture_id (не проверено вживую из этой песочницы, см. README).
        const thumb = best.thumbnail || v.medium?.thumbnail
          || (hit.picture_id ? `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg` : null);
        return {
          id: `pixabay-${hit.id}`,
          provider: "pixabay",
          thumb,
          videoUrl: best.url,
          full: best.url,
          fileExt: "mp4",
          width: best.width,
          height: best.height,
          duration: hit.duration || null,
          title: hit.tags || "",
          description: "",
          tags: (hit.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
          author: hit.user,
          authorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
          pageUrl: hit.pageURL,
          download: { type: "direct", url: best.url },
          license: { name: "Pixabay License", url: "https://pixabay.com/service/license-summary/", commercial: true, attribution: false },
        };
      }).filter((it) => it.videoUrl && it.thumb);
      items = filterByOrientation(items, orientation);
      return { items, total: data.totalHits ?? null };
    },
  };

  // ---------- Pexels Video ----------
  const PexelsVideoProvider = {
    id: "pexels",
    label: "Pexels",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL),
    async search(query, { page = 1, orientation = "any", signal } = {}) {
      const orientationMap = { any: undefined, horizontal: "landscape", vertical: "portrait", square: "square" };
      const qs = buildQuery({
        query,
        per_page: 24,
        page,
        orientation: orientationMap[orientation],
      });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/pexels-video?${qs}`, { signal });
      const items = (data.videos || []).map((v) => {
        // video_files — несколько вариантов качества сразу; берём самый
        // тяжёлый HD-вариант не выше 1080p (4K/8K оригиналы Pexels отдаёт
        // тоже, но для карточки/лайтбокса это лишние десятки МБ на файл).
        const files = (v.video_files || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
        const hd = files.find((f) => (f.width || 0) <= 1920 && (f.width || 0) >= 640) || files[files.length - 1] || files[0];
        if (!hd) return null;
        return {
          id: `pexels-${v.id}`,
          provider: "pexels",
          thumb: v.image,
          videoUrl: hd.link,
          full: hd.link,
          fileExt: "mp4",
          width: hd.width || v.width,
          height: hd.height || v.height,
          duration: v.duration || null,
          title: "",
          description: "",
          tags: [],
          author: v.user?.name,
          authorUrl: v.user?.url,
          pageUrl: v.url,
          download: { type: "direct", url: hd.link },
          license: { name: "Pexels License", url: "https://www.pexels.com/license/", commercial: true, attribution: false },
        };
      }).filter(Boolean);
      return { items, total: data.total_results ?? null };
    },
  };

  // ---------- Wikimedia Commons (видео-файлы) ----------
  // Тот же MediaWiki API, что и у фото-Wikimedia, но mime video/* вместо
  // image/* — ключ не нужен, обращаемся напрямую с клиента.
  const WikimediaVideoProvider = {
    id: "wikimedia",
    label: "Wikimedia Commons",
    enabled: () => true,
    async search(query, { page = 1, orientation = "any", signal } = {}) {
      const limit = 24;
      const qs = buildQuery({
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: 6,
        gsrlimit: limit,
        gsroffset: (page - 1) * limit,
        prop: "imageinfo",
        iiprop: "url|size|extmetadata|mime",
        iiurlwidth: 800, // помогает MediaWiki сгенерировать кадр-превью (thumburl) и для видео
        format: "json",
        origin: "*",
      });
      const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${qs}`, { signal });
      const pages = Object.values(data.query?.pages || {});
      let items = pages
        .filter((p) => p.imageinfo?.[0]?.mime?.startsWith("video/"))
        .map((p) => {
          const info = p.imageinfo[0];
          const meta = info.extmetadata || {};
          const niceTitle = p.title.replace(/^File:/, "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/_/g, " ");
          const code = parseWikimediaLicenseCode(String(meta.LicenseShortName?.value || "").toLowerCase());
          return {
            id: `wikimedia-${p.pageid}`,
            provider: "wikimedia",
            // thumburl для видео Wikimedia не всегда отдаёт — если его нет,
            // карточка просто останется без превью (см. обработку ошибки
            // загрузки картинки в app.js), это не крашит рендер.
            thumb: info.thumburl || null,
            videoUrl: info.url,
            full: info.url,
            fileExt: (info.url || "").split(".").pop() || "webm",
            width: info.width,
            height: info.height,
            duration: null, // MediaWiki не отдаёт длительность в этом запросе стабильным образом
            title: niceTitle,
            description: (meta.ImageDescription?.value || "").replace(/<[^>]*>/g, "").trim().slice(0, 400),
            tags: [],
            author: (meta.Artist?.value || "").replace(/<[^>]*>/g, "").trim() || undefined,
            authorUrl: undefined,
            pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
            download: { type: "direct", url: info.url },
            license: code
              ? { name: code.toUpperCase(), url: meta.LicenseUrl?.value, commercial: !/nc/.test(code), attribution: code !== "cc0" }
              : { name: meta.LicenseShortName?.value || null, url: meta.LicenseUrl?.value, commercial: undefined, attribution: undefined },
          };
        })
        .filter((it) => it.thumb); // без превью карточка видео нечитаема — не показываем
      items = filterByOrientation(items, orientation);
      return { items, total: null };

      function parseWikimediaLicenseCode(s) {
        if (/cc0|public domain|\bpd\b/.test(s)) return "cc0";
        if (/by-nc-nd/.test(s)) return "by-nc-nd";
        if (/by-nc-sa/.test(s)) return "by-nc-sa";
        if (/by-nc/.test(s)) return "by-nc";
        if (/by-sa/.test(s)) return "by-sa";
        if (/by-nd/.test(s)) return "by-nd";
        if (/\bby\b/.test(s)) return "by";
        return null;
      }
    },
  };

  // ---------- Internet Archive ----------
  // Ключ не нужен, но плейлист найти в одном запросе нельзя: advancedsearch
  // отдаёт только карточки (identifier/title/...), реальный файл видео надо
  // отдельно искать в /metadata/{identifier} среди files[] — поэтому на
  // каждую страницу уходит 1 + N запросов (N — число найденных элементов).
  // Это самый "тяжёлый" по числу запросов источник видео, но он изолирован
  // от остальных как любой другой провайдер (свой таймаут, свои ошибки не
  // трогают других) — см. loadVideoPage в app.js.
  const ArchiveVideoProvider = {
    id: "archive",
    label: "Internet Archive",
    enabled: () => true,
    async search(query, { page = 1, signal } = {}) {
      const rows = 24;
      const qs = buildQuery({
        q: `${query} AND mediatype:(movies)`,
        "fl[]": "identifier",
        rows,
        page,
        output: "json",
      });
      // advancedsearch.php поддерживает несколько fl[] — buildQuery выше
      // выдаёт только один по ключу "fl[]"; добавляем остальные вручную.
      const url = `https://archive.org/advancedsearch.php?${qs}&fl[]=title&fl[]=description&fl[]=runtime&fl[]=licenseurl&fl[]=creator`;
      const data = await fetchJson(url, { signal });
      const docs = data.response?.docs || [];
      const withMeta = await Promise.all(docs.map(async (doc) => {
        try {
          const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, { signal });
          const files = meta.files || [];
          // Предпочитаем лёгкий веб-совместимый MPEG4-дериватив, который
          // Archive.org обычно сам генерирует для загруженных видео; полные
          // оригиналы (.mov/.mkv/огромные .mp4) пропускаем — это гигабайты.
          const file = files.find((f) => /mpeg4|h\.264/i.test(f.format || "") && /512kb|mpeg4/i.test(f.name || ""))
            || files.find((f) => /mpeg4|h\.264/i.test(f.format || ""))
            || files.find((f) => /\.mp4$/i.test(f.name || ""));
          if (!file) return null;
          const videoUrl = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`;
          return {
            id: `archive-${doc.identifier}`,
            provider: "archive",
            thumb: `https://archive.org/services/img/${doc.identifier}`,
            videoUrl,
            full: videoUrl,
            fileExt: "mp4",
            width: Number(file.width) || null,
            height: Number(file.height) || null,
            duration: doc.runtime ? parseRuntimeToSeconds(doc.runtime) : (file.length ? Math.round(Number(file.length)) : null),
            title: doc.title || doc.identifier,
            description: (doc.description || "").toString().replace(/<[^>]*>/g, "").trim().slice(0, 400),
            tags: [],
            author: Array.isArray(doc.creator) ? doc.creator[0] : (doc.creator || undefined),
            authorUrl: undefined,
            pageUrl: `https://archive.org/details/${doc.identifier}`,
            download: { type: "direct", url: videoUrl },
            // Internet Archive — общественное достояние/открытые лицензии в
            // подавляющем большинстве, но не поголовно; когда licenseurl не
            // указан явно в метаданных, честно помечаем лицензию неизвестной,
            // а не выдаём её за CC0.
            license: doc.licenseurl
              ? { name: "Internet Archive", url: doc.licenseurl, commercial: undefined, attribution: undefined }
              : { name: null, url: `https://archive.org/details/${doc.identifier}`, commercial: undefined, attribution: undefined },
          };
        } catch {
          return null; // не удалось получить метаданные конкретного ролика — просто пропускаем его, не весь поиск
        }
      }));
      const items = withMeta.filter(Boolean);
      return { items, total: data.response?.numFound ?? null };

      function parseRuntimeToSeconds(runtime) {
        const m = String(runtime).match(/(\d+):(\d+):(\d+)|(\d+):(\d+)/);
        if (!m) return null;
        if (m[1] !== undefined) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        return (+m[4]) * 60 + (+m[5]);
      }
    },
  };

  // ---------- Coverr ----------
  // ⚠️ Схема ответа Coverr Search API здесь реконструирована по памяти и
  // НЕ проверена вживую (из этой песочницы нет сети наружу вообще, а ключа
  // Coverr на момент подключения ещё не существовало). Источник отключён по
  // умолчанию (см. COVERR_ENABLED в config.js) — включайте только после
  // того, как добавите COVERR_API_KEY в воркер и вручную проверите в
  // devtools, что /coverr действительно отдаёт непустой список и что поля
  // ниже (hits/urls.mp4/urls.poster и т.д.) совпадают с реальным ответом;
  // если нет — поправьте маппинг под настоящие имена полей.
  const CoverrVideoProvider = {
    id: "coverr",
    label: "Coverr",
    enabled: () => Boolean(CONFIG.WORKER_BASE_URL) && Boolean(CONFIG.COVERR_ENABLED),
    async search(query, { page = 1, orientation = "any", signal } = {}) {
      const qs = buildQuery({ query, page, page_size: 24 });
      const data = await fetchJson(`${CONFIG.WORKER_BASE_URL}/coverr?${qs}`, { signal });
      const rawList = data.hits || data.videos || data.results || [];
      let items = rawList.map((v) => {
        const urls = v.urls || {};
        const videoUrl = urls.mp4 || urls.mp4_download || v.video_url || v.download_url;
        const thumb = urls.poster || urls.thumbnail || v.poster || v.thumbnail;
        if (!videoUrl || !thumb) return null;
        return {
          id: `coverr-${v.id || v.slug || videoUrl}`,
          provider: "coverr",
          thumb,
          videoUrl,
          full: videoUrl,
          fileExt: "mp4",
          width: v.width || null,
          height: v.height || null,
          duration: v.duration || null,
          title: v.title || "",
          description: v.description || "",
          tags: Array.isArray(v.tags) ? v.tags : [],
          author: v.user?.name || v.author || undefined,
          authorUrl: v.user?.url || undefined,
          pageUrl: v.page_url || v.url || `https://coverr.co/videos/${v.id || v.slug || ""}`,
          download: { type: "direct", url: urls.mp4_download || videoUrl },
          license: { name: "Coverr License", url: "https://coverr.co/license", commercial: true, attribution: false },
        };
      }).filter(Boolean);
      items = filterByOrientation(items, orientation);
      return { items, total: data.pagination?.total_hits ?? data.total ?? null };
    },
  };

  global.VIDEO_PROVIDERS = [
    PixabayVideoProvider,
    PexelsVideoProvider,
    WikimediaVideoProvider,
    ArchiveVideoProvider,
    CoverrVideoProvider,
  ];
})(window);
