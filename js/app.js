(function () {
  "use strict";

  const SUGGESTIONS = I18N.t("suggestions");
  const ICON_SUGGESTIONS = I18N.t("suggestions_icons");
  const FAVORITES_KEY = "photoseek-favorites";
  const FILTERS_KEY = "photoseek-filters";
  const HISTORY_KEY = "photoseek-history";
  const ICON_HISTORY_KEY = "photoseek-icon-history";
  const STATS_KEY = "photoseek-stats";
  const THEME_KEY = "photoseek-theme";
  const MODE_KEY = "photoseek-mode";
  const ICON_COLORS = ["#e5484d", "#f5a623", "#2fb344", "#2e7bf6", "#8b5cf6", "#ec4899"];
  const UNSPLASH_LOG_KEY = "photoseek-unsplash-log";
  const MAX_FAVORITES = 300;
  const MAX_HISTORY = 8;
  const UNSPLASH_HOURLY_LIMIT = 50;
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 минут паузы для источника при 429
  const QUALITY_THRESHOLDS = { any: 0, "2k": 2048, "4k": 3840, "8k": 7680 };
  // Доп. языки для многоязычного поиска (см. описание у loadPage) — только
  // для источников с multiLang: true (Wikimedia/Openverse).
  const MULTI_LANG_TARGETS = ["es", "de"];
  // Условный вес "качества" источника для более умного чередования в ленте —
  // не более чем эвристика, не претендует на объективность.
  const SOURCE_WEIGHTS = { pixabay: 1, pexels: 1.1, unsplash: 1.25, wikimedia: 0.7, openverse: 0.8, flickr: 1 };

  const el = {
    topbar: document.getElementById("topbar"),
    form: document.getElementById("searchForm"),
    input: document.getElementById("searchInput"),
    clearBtn: document.getElementById("clearBtn"),
    themeToggle: document.getElementById("themeToggle"),
    favoritesToggle: document.getElementById("favoritesToggle"),
    selectModeToggle: document.getElementById("selectModeToggle"),
    translatedHint: document.getElementById("translatedHint"),
    translatedHintText: document.getElementById("translatedHintText"),
    translatedHintUndo: document.getElementById("translatedHintUndo"),
    spellHint: document.getElementById("spellHint"),
    spellHintText: document.getElementById("spellHintText"),
    spellHintApply: document.getElementById("spellHintApply"),
    micBtn: document.getElementById("micBtn"),
    insightsToggle: document.getElementById("insightsToggle"),
    insightsPanel: document.getElementById("insightsPanel"),
    recentSearches: document.getElementById("recentSearches"),
    sources: document.getElementById("sources"),
    yandexBtn: document.getElementById("yandexBtn"),
    googleBtn: document.getElementById("googleBtn"),
    pinterestBtn: document.getElementById("pinterestBtn"),
    cosmosBtn: document.getElementById("cosmosBtn"),
    colorMenu: document.getElementById("colorMenu"),
    resultsCount: document.getElementById("resultsCount"),
    providerWarnings: document.getElementById("providerWarnings"),
    emptyState: document.getElementById("emptyState"),
    favoritesEmpty: document.getElementById("favoritesEmpty"),
    suggestions: document.getElementById("suggestions"),
    grid: document.getElementById("grid"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    noResults: document.getElementById("noResults"),
    toast: document.getElementById("toast"),
    bulkBar: document.getElementById("bulkBar"),
    bulkCount: document.getElementById("bulkCount"),
    bulkCancel: document.getElementById("bulkCancel"),
    bulkDownload: document.getElementById("bulkDownload"),
    lightbox: document.getElementById("lightbox"),
    lbImage: document.getElementById("lbImage"),
    lbSpinner: document.getElementById("lbSpinner"),
    lbHeart: document.getElementById("lbHeart"),
    lbSourceBadge: document.getElementById("lbSourceBadge"),
    lbCopy: document.getElementById("lbCopy"),
    lbCopyImage: document.getElementById("lbCopyImage"),
    lbShare: document.getElementById("lbShare"),
    lbDownload: document.getElementById("lbDownload"),
    lbTitle: document.getElementById("lbTitle"),
    lbDescription: document.getElementById("lbDescription"),
    lbTags: document.getElementById("lbTags"),
    lbAuthor: document.getElementById("lbAuthor"),
    lbSourceLink: document.getElementById("lbSourceLink"),
    lbLicense: document.getElementById("lbLicense"),
    lbPrev: document.getElementById("lbPrev"),
    lbNext: document.getElementById("lbNext"),
    modeSwitch: document.getElementById("modeSwitch"),
    filtersRow: document.getElementById("filtersRow"),
    filtersToggle: document.getElementById("filtersToggle"),
    filtersPopover: document.getElementById("filtersPopover"),
    filtersBadge: document.getElementById("filtersBadge"),
    heroH1Before: document.getElementById("heroH1Before"),
    heroH1Underline: document.getElementById("heroH1Underline"),
    heroP: document.getElementById("heroP"),
    iconGrid: document.getElementById("iconGrid"),
    iconLoadMoreWrap: document.getElementById("iconLoadMoreWrap"),
    iconLoadMoreBtn: document.getElementById("iconLoadMoreBtn"),
    iconNoResults: document.getElementById("iconNoResults"),
    iconLightbox: document.getElementById("iconLightbox"),
    ilPreview: document.getElementById("ilPreview"),
    ilCollectionBadge: document.getElementById("ilCollectionBadge"),
    ilCopyName: document.getElementById("ilCopyName"),
    ilCopySvg: document.getElementById("ilCopySvg"),
    ilDownloadSvg: document.getElementById("ilDownloadSvg"),
    ilDownloadPng: document.getElementById("ilDownloadPng"),
    ilTitle: document.getElementById("ilTitle"),
    ilColorSwatches: document.getElementById("ilColorSwatches"),
    ilLicense: document.getElementById("ilLicense"),
    ilSourceLink: document.getElementById("ilSourceLink"),
    ilPrev: document.getElementById("ilPrev"),
    ilNext: document.getElementById("ilNext"),
  };

  const state = {
    mode: "photos", // "photos" | "icons"
    query: "",
    searchQuery: "",
    view: "search", // "search" | "favorites"
    activeSources: new Set(),
    orientation: "any",
    sort: "popular",
    quality: "any",
    color: "any",
    people: "any",
    pages: {},
    hasMore: {},
    items: [],
    favorites: new Map(), // id -> item
    favoritesList: [],
    selectMode: false,
    selected: new Set(),
    loading: false,
    lightboxIndex: -1,
    queryMatcher: null,
    extraQueries: [], // переводы запроса на доп. языки (только для первой страницы)
    dedupeHashes: [],
    cooldownUntil: {}, // providerId -> timestamp до которого источник пропускаем
    // ---- Иконки (отдельный от фото пайплайн, см. js/icons.js) ----
    iconQuery: "",
    iconSearchQuery: "",
    iconItems: [],
    iconPage: 0,
    iconHasMore: false,
    iconLoading: false,
    iconLightboxIndex: -1,
    iconColor: null, // null = цвет темы (currentColor), иначе выбранный hex
  };

  const PROVIDER_LABELS = {
    pixabay: "Pixabay",
    pexels: "Pexels",
    unsplash: "Unsplash",
    wikimedia: "Wikimedia Commons",
    openverse: "Openverse",
    flickr: "Flickr",
  };

  function getActiveList() {
    return state.view === "favorites" ? state.favoritesList : state.items;
  }

  function vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch { /* некоторые браузеры блокируют без жеста — не критично */ }
    }
  }

  // Небольшая "пружинка" на иконке сердца при добавлении в избранное.
  // Перезапускаем анимацию через reflow, чтобы она срабатывала и при
  // повторном добавлении того же фото после снятия из избранного.
  function popHeart(btn) {
    btn.classList.remove("is-pop");
    void btn.offsetWidth;
    btn.classList.add("is-pop");
  }

  // ---------- Theme ----------
  // Три режима: auto (следует за системной темой) / light / dark.
  // Раньше кнопка была бинарным переключателем light<->dark — стоило нажать
  // её один раз, и обратного пути к "авто" не было вообще (только вручную
  // чистить localStorage). Это и было той самой "не работает автосмена
  // темы" — на деле она работала, просто из неё нельзя было выйти обратно.
  const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function currentThemeMode() {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  }
  function applyThemeMode(mode) {
    document.documentElement.setAttribute("data-theme-mode", mode);
    if (mode === "auto") {
      localStorage.removeItem(THEME_KEY);
      document.documentElement.setAttribute("data-theme", systemThemeQuery.matches ? "dark" : "light");
    } else {
      localStorage.setItem(THEME_KEY, mode);
      document.documentElement.setAttribute("data-theme", mode);
    }
  }
  function initTheme() {
    applyThemeMode(currentThemeMode());
  }
  el.themeToggle.addEventListener("click", () => {
    const mode = currentThemeMode();
    const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    applyThemeMode(next);
  });
  // Пока режим "авто" — живо следуем за системной темой (например, автоночь
  // по расписанию ОС), без перезагрузки страницы.
  systemThemeQuery.addEventListener("change", (e) => {
    if (currentThemeMode() !== "auto") return;
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  });

  // ---------- Sticky header on scroll ----------
  window.addEventListener("scroll", () => {
    el.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  }, { passive: true });

  // ---------- Mode switch (Фото / Иконки) ----------
  // Иконки — принципиально другой поиск (Iconify вместо фотостоков, см.
  // js/icons.js), поэтому у него своя сетка/лайтбокс/история и вместо
  // фильтров по фото (ориентация/качество/люди/цвет) показывать нечего —
  // просто прячем эти элементы, а не пытаемся их подстроить под иконки.
  function applyModeUI(mode) {
    state.mode = mode;
    el.modeSwitch.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    const isIcons = mode === "icons";
    el.sources.hidden = isIcons;
    el.filtersRow.hidden = isIcons;
    el.favoritesToggle.hidden = isIcons;
    el.selectModeToggle.hidden = isIcons;
    applyHeroForMode();
    renderSuggestionChips();
    renderHistory();
  }
  function setMode(mode) {
    if (mode === state.mode) return;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* не критично */ }
    if (mode === "icons" && state.view === "favorites") {
      state.view = "search";
      el.favoritesToggle.setAttribute("aria-pressed", "false");
    }
    exitSelectMode();
    closeLightbox();
    closeIconLightbox();
    closeFiltersPopover();
    const wasIcons = state.mode === "icons";
    applyModeUI(mode);
    if (wasIcons && mode !== "icons") {
      el.iconGrid.hidden = true;
      el.iconGrid.innerHTML = "";
      el.iconLoadMoreWrap.hidden = true;
      el.iconNoResults.hidden = true;
    }
    if (!wasIcons && mode === "icons") {
      el.grid.hidden = true;
      el.grid.innerHTML = "";
      el.loadMoreWrap.hidden = true;
      el.noResults.hidden = true;
    }
    const q = el.input.value.trim();
    if (mode === "icons") {
      if (q) runIconSearch(); else resetIconToEmpty();
    } else if (q) {
      runSearch();
    } else {
      resetToEmpty();
    }
  }
  el.modeSwitch.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  function applyHeroForMode() {
    const icons = state.mode === "icons";
    el.heroH1Before.textContent = I18N.t(icons ? "hero_h1_before_icons" : "hero_h1_before");
    el.heroH1Underline.textContent = I18N.t(icons ? "hero_h1_underline_icons" : "hero_h1_underline");
    el.heroP.textContent = I18N.t(icons ? "hero_p_icons" : "hero_p");
  }

  // ---------- Suggestions ----------
  function renderSuggestionChips() {
    el.suggestions.querySelectorAll(".suggestion-chip").forEach((c) => c.remove());
    const list = state.mode === "icons" ? ICON_SUGGESTIONS : SUGGESTIONS;
    list.forEach((term) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = term;
      chip.addEventListener("click", () => {
        el.input.value = term;
        el.clearBtn.hidden = false;
        if (state.mode === "icons") runIconSearch(); else runSearch();
      });
      el.suggestions.appendChild(chip);
    });
  }
  renderSuggestionChips();

  // ---------- Search history ----------
  // У иконок своя история (photoseek-icon-history) — короткие технические
  // запросы вроде "home"/"user" не должны мешаться с историей поиска фото.
  function historyKeyForMode() {
    return state.mode === "icons" ? ICON_HISTORY_KEY : HISTORY_KEY;
  }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(historyKeyForMode()) || "[]"); } catch { return []; }
  }
  function addToHistory(q) {
    let hist = loadHistory().filter((h) => h.toLowerCase() !== q.toLowerCase());
    hist.unshift(q);
    hist = hist.slice(0, MAX_HISTORY);
    try { localStorage.setItem(historyKeyForMode(), JSON.stringify(hist)); } catch { /* localStorage недоступен */ }
    renderHistory();
  }
  function renderHistory() {
    const hist = loadHistory();
    el.recentSearches.innerHTML = "";
    if (hist.length === 0) { el.recentSearches.hidden = true; return; }
    el.recentSearches.hidden = false;
    const label = document.createElement("span");
    label.className = "suggestions-label";
    label.textContent = I18N.t("recent_label");
    el.recentSearches.appendChild(label);
    hist.forEach((term) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = term;
      chip.addEventListener("click", () => {
        el.input.value = term;
        if (state.mode === "icons") runIconSearch(); else runSearch();
      });
      el.recentSearches.appendChild(chip);
    });
  }
  renderHistory();

  // ---------- Color filter: populate swatches ----------
  (window.COLOR_OPTIONS || []).forEach((c) => {
    const label = I18N.t(`color_${c.id}`);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-item color-swatch";
    btn.dataset.val = c.id;
    btn.title = label;
    btn.textContent = label;
    btn.style.background = c.id === "white"
      ? "#fff"
      : (c.id === "bw" ? "linear-gradient(135deg, #fff 50%, #161616 50%)" : c.hex);
    el.colorMenu.appendChild(btn);
  });

  // ---------- Persisted filters ----------
  function saveFilters() {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        orientation: state.orientation,
        sort: state.sort,
        quality: state.quality,
        color: state.color,
        people: state.people,
        activeSources: Array.from(state.activeSources),
      }));
    } catch { /* localStorage недоступен — не критично */ }
  }

  function setDropdownUI(key, val) {
    const dropdown = document.querySelector(`.dropdown[data-dropdown="${key}"]`);
    if (!dropdown) return;
    const item = dropdown.querySelector(`.dropdown-item[data-val="${val}"]`);
    if (!item) return;
    dropdown.querySelectorAll(".dropdown-item").forEach((i) => i.classList.remove("is-active"));
    item.classList.add("is-active");
    dropdown.querySelector(".dropdown-btn [data-value]").textContent = item.textContent.trim();
  }

  function loadPersistedFilters() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || "null");
    } catch { /* битые данные — игнорируем */ }
    if (!saved) return;
    ["orientation", "sort", "quality", "color", "people"].forEach((key) => {
      if (saved[key]) {
        state[key] = saved[key];
        setDropdownUI(key, saved[key]);
      }
    });
    if (Array.isArray(saved.activeSources)) {
      el.sources.querySelectorAll(".source-chip[data-source]").forEach((chip) => {
        if (chip.hidden) return; // источник без ключа — недоступен, не трогаем
        const want = saved.activeSources.includes(chip.dataset.source);
        chip.setAttribute("aria-pressed", String(want));
        if (want) state.activeSources.add(chip.dataset.source);
        else state.activeSources.delete(chip.dataset.source);
      });
    }
  }

  // Источники без ключа в config.js просто скрываем — они появятся сами,
  // как только в config.js добавят соответствующий ключ.
  (function initSourceChips() {
    const byId = {};
    (window.PROVIDERS || []).forEach((p) => { byId[p.id] = p; });
    el.sources.querySelectorAll(".source-chip[data-source]").forEach((chip) => {
      const provider = byId[chip.dataset.source];
      if (provider && provider.enabled()) {
        state.activeSources.add(provider.id);
      } else {
        chip.hidden = true;
      }
    });
  })();

  loadPersistedFilters();
  updateFiltersBadge();

  // ---------- Stats & rate-limit tracking ----------
  const stats = (function loadStats() {
    try { return Object.assign({ searches: 0, downloads: 0, byProvider: {} }, JSON.parse(localStorage.getItem(STATS_KEY) || "{}")); }
    catch { return { searches: 0, downloads: 0, byProvider: {} }; }
  })();
  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* не критично */ }
  }
  function recordSearch() {
    stats.searches = (stats.searches || 0) + 1;
    saveStats();
  }
  function recordDownload(provider) {
    stats.downloads = (stats.downloads || 0) + 1;
    stats.byProvider = stats.byProvider || {};
    stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
    saveStats();
  }

  function readUnsplashLog() {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(UNSPLASH_LOG_KEY) || "[]"); } catch { /* игнорируем */ }
    const now = Date.now();
    return log.filter((t) => now - t < 3600_000);
  }
  function logUnsplashRequest() {
    const log = readUnsplashLog();
    log.push(Date.now());
    try { localStorage.setItem(UNSPLASH_LOG_KEY, JSON.stringify(log)); } catch { /* игнорируем */ }
  }
  function getUnsplashRemaining() {
    return Math.max(0, UNSPLASH_HOURLY_LIMIT - readUnsplashLog().length);
  }

  function renderInsights() {
    const remaining = getUnsplashRemaining();
    const topEntry = Object.entries(stats.byProvider || {}).sort((a, b) => b[1] - a[1])[0];
    const topLine = topEntry ? `${PROVIDER_LABELS[topEntry[0]] || topEntry[0]} (${topEntry[1]})` : I18N.t("insights_none");
    const cooldownLines = Object.entries(state.cooldownUntil)
      .filter(([, until]) => until > Date.now())
      .map(([id, until]) => {
        const mins = Math.max(1, Math.round((until - Date.now()) / 60000));
        return `<div class="insights-row"><span>${PROVIDER_LABELS[id] || id}</span><strong>${I18N.t("insights_cooldown", { mins })}</strong></div>`;
      }).join("");
    el.insightsPanel.innerHTML = `
      <div class="insights-row"><span>${I18N.t("insights_downloads")}</span><strong>${stats.downloads || 0}</strong></div>
      <div class="insights-row"><span>${I18N.t("insights_searches")}</span><strong>${stats.searches || 0}</strong></div>
      <div class="insights-row"><span>${I18N.t("insights_top_source")}</span><strong>${topLine}</strong></div>
      <div class="insights-sep"></div>
      <div class="insights-row"><span>${I18N.t("insights_unsplash_limit")}</span><strong>${remaining} ${I18N.t("insights_of")} ${UNSPLASH_HOURLY_LIMIT}</strong></div>
      ${cooldownLines}
    `;
  }
  el.insightsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !el.insightsPanel.hidden;
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    if (isOpen) { el.insightsPanel.hidden = true; return; }
    renderInsights();
    el.insightsPanel.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!el.insightsPanel.hidden && e.target !== el.insightsToggle && !el.insightsToggle.contains(e.target)) {
      el.insightsPanel.hidden = true;
    }
  });

  // ---------- Search input ----------
  let debounceTimer = null;
  el.input.addEventListener("input", () => {
    el.clearBtn.hidden = el.input.value.length === 0;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { if (state.mode === "icons") runIconSearch(); else runSearch(); }, 550);
  });
  el.clearBtn.addEventListener("click", () => {
    el.input.value = "";
    el.clearBtn.hidden = true;
    el.input.focus();
    if (state.mode === "icons") resetIconToEmpty(); else resetToEmpty();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    if (state.mode === "icons") runIconSearch(); else runSearch();
  });

  // ---------- Voice search ----------
  // Кнопку показываем всегда (не только когда API распознан) — иначе на части
  // браузеров/после переустановки PWA иконка выглядит как "пропавшая", хотя
  // на деле просто не поддерживается. При отсутствии поддержки клик просто
  // объясняет это тостом, вместо того чтобы прятать кнопку целиком.
  el.micBtn.hidden = false;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor) {
    const recognizer = new SpeechRecognitionCtor();
    recognizer.lang = I18N.LANG === "en" ? "en-US" : "ru-RU";
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    let listening = false;
    el.micBtn.addEventListener("click", () => {
      if (listening) { recognizer.stop(); return; }
      try {
        recognizer.start();
        listening = true;
        el.micBtn.classList.add("is-listening");
      } catch (err) { console.warn("Не удалось запустить распознавание речи:", err); }
    });
    recognizer.addEventListener("result", (e) => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) {
        el.input.value = text;
        el.clearBtn.hidden = false;
        if (state.mode === "icons") runIconSearch(); else runSearch();
      }
    });
    recognizer.addEventListener("end", () => {
      listening = false;
      el.micBtn.classList.remove("is-listening");
    });
    recognizer.addEventListener("error", () => {
      listening = false;
      el.micBtn.classList.remove("is-listening");
    });
  } else {
    el.micBtn.addEventListener("click", () => {
      showToast(I18N.t("mic_unsupported"));
    });
  }

  // ---------- Source chips ----------
  el.sources.querySelectorAll(".source-chip[data-source]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const src = chip.dataset.source;
      const willBeActive = chip.getAttribute("aria-pressed") !== "true";
      if (!willBeActive) {
        const activeCount = el.sources.querySelectorAll('.source-chip[aria-pressed="true"]').length;
        if (activeCount <= 1) return; // хотя бы один источник должен остаться включён
      }
      chip.setAttribute("aria-pressed", String(willBeActive));
      if (willBeActive) state.activeSources.add(src);
      else state.activeSources.delete(src);
      saveFilters();
      if (state.query) runSearch({ keepTranslation: true });
    });
  });

  el.yandexBtn.addEventListener("click", () => openExternalSearch("yandex"));
  el.googleBtn.addEventListener("click", () => openExternalSearch("google"));
  el.pinterestBtn.addEventListener("click", () => openExternalSearch("pinterest"));
  el.cosmosBtn.addEventListener("click", () => openExternalSearch("cosmos"));

  const EXTERNAL_SEARCH_URLS = {
    yandex: (q) => `https://yandex.ru/images/search?text=${encodeURIComponent(q)}`,
    google: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
    pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
    cosmos: (q) => `https://www.cosmos.so/search/elements/${encodeURIComponent(q + " ")}`,
  };
  function openExternalSearch(engine) {
    const q = el.input.value.trim();
    if (!q) {
      showToast(I18N.t("external_search_need_query"));
      el.input.focus();
      return;
    }
    window.open(EXTERNAL_SEARCH_URLS[engine](q), "_blank", "noopener,noreferrer");
  }

  // ---------- Dropdown filters (quality / orientation / sort / people / color) ----------
  document.querySelectorAll(".dropdown").forEach((dropdown) => {
    const btn = dropdown.querySelector(".dropdown-btn");
    const menu = dropdown.querySelector(".dropdown-menu");
    const valueEl = btn.querySelector("[data-value]");
    const key = dropdown.dataset.dropdown;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains("is-open");
      document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
      if (!isOpen) dropdown.classList.add("is-open");
    });

    menu.querySelectorAll(".dropdown-item").forEach((item) => {
      item.addEventListener("click", () => {
        menu.querySelectorAll(".dropdown-item").forEach((i) => i.classList.remove("is-active"));
        item.classList.add("is-active");
        valueEl.textContent = item.textContent.trim();
        state[key] = item.dataset.val;
        dropdown.classList.remove("is-open");
        saveFilters();
        updateFiltersBadge();
        if (state.query) runSearch({ keepTranslation: true });
      });
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
  });

  // ---------- Единая кнопка фильтров ----------
  // Все 5 фильтров (качество/ориентация/сортировка/люди/цвет) собраны в один
  // popover за одной иконкой — раньше это была отдельная строка из пяти
  // всегда видимых плашек. Бейдж на кнопке показывает, сколько фильтров
  // сейчас отличаются от значения по умолчанию, не открывая панель.
  function updateFiltersBadge() {
    const activeCount = [
      state.quality !== "any",
      state.orientation !== "any",
      state.sort !== "popular",
      state.people !== "any",
      state.color !== "any",
    ].filter(Boolean).length;
    el.filtersBadge.textContent = String(activeCount);
    el.filtersBadge.hidden = activeCount === 0;
    el.filtersToggle.classList.toggle("has-active-filters", activeCount > 0);
  }
  function closeFiltersPopover() {
    el.filtersPopover.hidden = true;
    el.filtersToggle.setAttribute("aria-expanded", "false");
  }
  el.filtersToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el.filtersPopover.hidden;
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    el.filtersPopover.hidden = !willOpen;
    el.filtersToggle.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", (e) => {
    if (!el.filtersPopover.hidden && !el.filtersRow.contains(e.target)) closeFiltersPopover();
  });

  // ---------- URL query param (?q=&mode=icons) ----------
  function updateUrlQuery(q) {
    try {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      if (state.mode === "icons") url.searchParams.set("mode", "icons");
      else url.searchParams.delete("mode");
      history.replaceState(null, "", url.pathname + url.search);
    } catch { /* недоступно (например, в песочнице без истории) — не критично */ }
  }

  // ---------- Search orchestration ----------
  // Токен поколения поиска: если пока шёл перевод/спеллчек одного поиска
  // (fill + debounce) успел стартовать другой (Enter сразу следом), результат
  // устаревшего вызова не должен дописаться поверх нового.
  let searchGeneration = 0;
  async function runSearch(opts = {}) {
    const raw = el.input.value.trim();
    if (!raw) {
      resetToEmpty();
      return;
    }
    const myGeneration = ++searchGeneration;
    state.view = "search";
    exitSelectMode();
    state.query = raw;
    addToHistory(raw);
    recordSearch();
    updateUrlQuery(raw);

    // Спеллчекер — только для обычного текста без наших операторов (-слово/"фраза"/ИЛИ).
    if (!opts.skipSpellcheck && !opts.forceOriginal && !/[-"]|\bOR\b/i.test(raw) && window.checkSpelling) {
      window.checkSpelling(raw).then((suggestion) => {
        if (suggestion && el.input.value.trim() === raw) {
          el.spellHintText.textContent = suggestion;
          el.spellHint.dataset.suggestion = suggestion;
          el.spellHint.hidden = false;
        }
      });
    }
    el.spellHint.hidden = true;

    const parsed = window.parseSearchQuery(raw);

    if (opts.keepTranslation && state.searchQuery && !opts.forceOriginal) {
      // фильтр поменяли на уже переведённом запросе — не переводим второй раз
    } else if (opts.forceOriginal) {
      state.searchQuery = parsed.apiQuery;
      state.extraQueries = [];
      el.translatedHint.hidden = true;
      state.queryMatcher = window.buildQueryMatcher(parsed, new Map());
    } else {
      // Основной перевод, доп.языки (для Wikimedia/Openverse) и перевод
      // терминов операторов (-слово/"фраза"/ИЛИ) друг от друга не зависят —
      // раньше они ждали друг друга по очереди (3 последовательных похода к
      // MyMemory), из-за чего выдача стала заметно медленнее. Теперь все три
      // похода идут параллельно, и результат готов за время самого долгого
      // из них, а не суммы всех.
      const operatorTerms = [...parsed.mustPhrases, ...parsed.mustNot, ...parsed.orGroups.flat()];
      const [result, extraTranslations, translatedTermsEntries] = await Promise.all([
        window.translateQuery(parsed.apiQuery),
        window.translateQueryToLangs ? window.translateQueryToLangs(parsed.apiQuery, MULTI_LANG_TARGETS) : Promise.resolve([]),
        Promise.all(operatorTerms.map(async (term) => {
          const r = await window.translateQuery(term);
          return [term.toLowerCase(), r.translated.toLowerCase()];
        })),
      ]);

      state.searchQuery = result.translated;
      if (result.wasTranslated) {
        el.translatedHintText.textContent = result.translated;
        el.translatedHint.hidden = false;
      } else {
        el.translatedHint.hidden = true;
      }

      // Многоязычный поиск: помимо английского перевода, для источников с
      // многоязычными описаниями (Wikimedia/Openverse — см. multiLang в
      // providers.js) пробуем ещё пару языков. Иногда там подписано не
      // по-английски, и такое фото иначе просто не найдётся.
      state.extraQueries = extraTranslations.filter((t) => t.toLowerCase() !== state.searchQuery.toLowerCase());
      state.queryMatcher = window.buildQueryMatcher(parsed, new Map(translatedTermsEntries));
    }

    if (myGeneration !== searchGeneration) return; // отменено более новым поиском, пока мы переводили

    state.items = [];
    state.pages = {};
    state.hasMore = {};
    state.dedupeHashes = [];
    el.grid.innerHTML = "";
    el.grid.hidden = false;
    el.emptyState.hidden = true;
    el.favoritesEmpty.hidden = true;
    el.noResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderSkeletons(12);
    await loadPage(true, myGeneration);
  }

  el.translatedHintUndo.addEventListener("click", () => {
    if (state.mode === "icons") runIconSearch({ forceOriginal: true });
    else runSearch({ forceOriginal: true });
  });
  el.spellHintApply.addEventListener("click", () => {
    const suggestion = el.spellHint.dataset.suggestion;
    if (!suggestion) return;
    el.input.value = suggestion;
    el.spellHint.hidden = true;
    runSearch({ skipSpellcheck: true });
  });

  function resetToEmpty() {
    searchGeneration++; // отменяем любой поиск, который мог быть в процессе
    state.query = "";
    state.searchQuery = "";
    state.items = [];
    updateUrlQuery("");
    el.translatedHint.hidden = true;
    el.spellHint.hidden = true;
    el.grid.hidden = true;
    el.grid.innerHTML = "";
    el.loadMoreWrap.hidden = true;
    el.noResults.hidden = true;
    el.favoritesEmpty.hidden = true;
    el.emptyState.hidden = state.view === "favorites";
    el.resultsCount.textContent = "";
    el.providerWarnings.textContent = "";
    if (state.view === "favorites") renderFavoritesView();
  }

  function renderSkeletons(count) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "card-skeleton";
      s.style.height = `${180 + Math.round(Math.random() * 140)}px`;
      s.dataset.skeleton = "1";
      el.grid.appendChild(s);
    }
  }
  function clearSkeletons() {
    el.grid.querySelectorAll('[data-skeleton="1"]').forEach((s) => s.remove());
  }

  async function loadPage(isFirst, generation = searchGeneration) {
    if (state.loading) return;
    state.loading = true;
    el.loadMoreBtn.disabled = true;
    el.loadMoreBtn.textContent = I18N.t("loading");

    const now = Date.now();
    // Проактивно не дёргаем Unsplash, если сами видим, что лимит на этот час исчерпан.
    if (getUnsplashRemaining() <= 0 && !(state.cooldownUntil.unsplash > now)) {
      state.cooldownUntil.unsplash = now + 5 * 60 * 1000;
    }
    const activeProviders = window.PROVIDERS.filter(
      (p) => state.activeSources.has(p.id) && p.enabled() && !(state.cooldownUntil[p.id] > now)
    );
    const skippedForCooldown = window.PROVIDERS.filter(
      (p) => state.activeSources.has(p.id) && p.enabled() && state.cooldownUntil[p.id] > now
    );
    const warnings = skippedForCooldown.map((p) => {
      const mins = Math.max(1, Math.round((state.cooldownUntil[p.id] - now) / 60000));
      return I18N.t("warn_cooldown", { label: p.label, mins });
    });
    const totals = {};

    const results = await Promise.all(
      activeProviders.map(async (p) => {
        const page = (state.pages[p.id] || 0) + 1;
        try {
          const searchOpts = { orientation: state.orientation, sort: state.sort, color: state.color, people: state.people };
          // Многоязычный поиск — только на первой странице свежего поиска и
          // только для источников с multiLang: true (см. providers.js).
          // "Бонусные" результаты на доп. языках не участвуют в пагинации
          // (не трогаем state.pages/hasMore) и не считаются в totals — это
          // добавка к первой странице, а не отдельный источник. Основной и
          // бонусные запросы уходят ОДНИМ Promise.all (а не по очереди) —
          // иначе для Wikimedia/Openverse время ответа складывалось бы, а не
          // определялось самым медленным из них.
          const bonusQueries = isFirst && p.multiLang && state.extraQueries.length > 0 ? state.extraQueries : [];
          const [primary, ...bonusBatches] = await Promise.all([
            p.search(state.searchQuery, { ...searchOpts, page }),
            ...bonusQueries.map((q) =>
              p.search(q, { ...searchOpts, page: 1 })
                .then((r) => r.items)
                .catch(() => []) // бонусный язык не нашёлся — не критично, тихо пропускаем
            ),
          ]);
          const { items, total } = primary;
          if (p.id === "unsplash") logUnsplashRequest();
          state.pages[p.id] = page;
          state.hasMore[p.id] = items.length > 0;
          totals[p.id] = total;
          const allItems = items.concat(...bonusBatches);
          return { id: p.id, items: allItems };
        } catch (err) {
          console.error(`[${p.label}]`, err);
          if (/HTTP 429/.test(err.message)) {
            state.cooldownUntil[p.id] = Date.now() + COOLDOWN_MS;
            warnings.push(I18N.t("warn_rate_limited", { label: p.label }));
          } else {
            warnings.push(I18N.t("warn_with_message", { label: p.label, message: err.message || I18N.t("warn_generic_error") }));
          }
          state.hasMore[p.id] = false;
          return { id: p.id, items: [] };
        }
      })
    );

    if (generation !== searchGeneration) {
      // Пока грузили эту страницу, пользователь запустил новый поиск —
      // не показываем устаревшие результаты и не трогаем его состояние.
      state.loading = false;
      el.loadMoreBtn.disabled = false;
      el.loadMoreBtn.textContent = I18N.t("load_more");
      return;
    }

    let batch = weightedInterleave(results);
    const minPx = QUALITY_THRESHOLDS[state.quality] || 0;
    if (minPx > 0) {
      batch = batch.filter((it) => Math.max(it.width || 0, it.height || 0) >= minPx);
    }
    if (state.people !== "any" && window.matchesPeopleFilter) {
      batch = batch.filter((it) => window.matchesPeopleFilter(it, state.people));
    }
    if (state.queryMatcher) {
      batch = batch.filter(state.queryMatcher);
    }
    if (window.dedupeItems && batch.length > 0) {
      const { kept, hashes } = await window.dedupeItems(batch, state.dedupeHashes);
      batch = kept;
      state.dedupeHashes.push(...hashes);
    }

    if (isFirst) clearSkeletons();

    if (batch.length === 0 && state.items.length === 0) {
      el.grid.hidden = true;
      el.loadMoreWrap.hidden = true;
      el.noResults.hidden = false;
    } else {
      el.noResults.hidden = true;
      appendCards(batch);
      state.items = state.items.concat(batch);
      const anyMore = activeProviders.some((p) => state.hasMore[p.id]);
      el.loadMoreWrap.hidden = !anyMore;
    }

    if (isFirst) {
      const knownTotals = Object.values(totals).filter((t) => typeof t === "number");
      const sum = knownTotals.reduce((a, b) => a + b, 0);
      const n = sum > 0 ? sum.toLocaleString(I18N.t("locale")) : state.items.length;
      el.resultsCount.textContent = state.items.length ? I18N.t("results_found", { n }) : "";
    }
    el.providerWarnings.textContent = warnings.join("  ·  ");

    state.loading = false;
    el.loadMoreBtn.disabled = false;
    el.loadMoreBtn.textContent = I18N.t("load_more");
  }

  // Взвешенное чередование источников (smooth weighted round-robin) вместо
  // простого "по очереди" — источники с большим весом появляются чуть чаще.
  function weightedInterleave(providerBatches) {
    const sources = providerBatches
      .map((p) => ({ id: p.id, items: p.items, idx: 0, credit: 0 }))
      .filter((p) => p.items.length > 0);
    const result = [];
    let remaining = sources.reduce((s, p) => s + p.items.length, 0);
    while (remaining > 0) {
      const active = sources.filter((p) => p.idx < p.items.length);
      const totalWeight = active.reduce((s, p) => s + (SOURCE_WEIGHTS[p.id] ?? 1), 0);
      active.forEach((p) => { p.credit += SOURCE_WEIGHTS[p.id] ?? 1; });
      let pick = active[0];
      for (const p of active) if (p.credit > pick.credit) pick = p;
      result.push(pick.items[pick.idx]);
      pick.idx++;
      pick.credit -= totalWeight;
      remaining--;
    }
    return result;
  }

  el.loadMoreBtn.addEventListener("click", () => loadPage(false));

  // ---------- Infinite scroll ----------
  const infiniteScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.loading && !el.loadMoreWrap.hidden) {
      loadPage(false);
    }
  }, { rootMargin: "800px" });
  infiniteScrollObserver.observe(el.loadMoreWrap);

  // ---------- Icon search (Iconify, см. js/icons.js) ----------
  // Отдельный от фото пайплайн: своя генерация поиска (чтобы устаревший
  // ответ не дописался поверх нового), своя пагинация и свой infinite
  // scroll — но никаких операторов запроса (-слово/"фраза"/ИЛИ),
  // спеллчекера и многоязычного расширения: Iconify ищет по английским
  // ключевым словам и такие усложнения дали бы немного пользы.
  let iconSearchGeneration = 0;
  async function runIconSearch(opts = {}) {
    const raw = el.input.value.trim();
    if (!raw) { resetIconToEmpty(); return; }
    const myGeneration = ++iconSearchGeneration;
    exitSelectMode();
    state.iconQuery = raw;
    addToHistory(raw);
    recordSearch();
    updateUrlQuery(raw);
    el.spellHint.hidden = true;

    if (opts.forceOriginal) {
      state.iconSearchQuery = raw;
      el.translatedHint.hidden = true;
    } else {
      const result = await window.translateQuery(raw);
      state.iconSearchQuery = result.translated;
      if (result.wasTranslated) {
        el.translatedHintText.textContent = result.translated;
        el.translatedHint.hidden = false;
      } else {
        el.translatedHint.hidden = true;
      }
    }

    if (myGeneration !== iconSearchGeneration) return; // отменено более новым поиском

    state.iconItems = [];
    state.iconPage = 0;
    state.iconHasMore = false;
    el.iconGrid.innerHTML = "";
    el.iconGrid.hidden = false;
    el.emptyState.hidden = true;
    el.iconNoResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderIconSkeletons(18);
    await loadIconPage(true, myGeneration);
  }

  function renderIconSkeletons(count) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "icon-card-skeleton";
      s.dataset.skeleton = "1";
      el.iconGrid.appendChild(s);
    }
  }
  function clearIconSkeletons() {
    el.iconGrid.querySelectorAll('[data-skeleton="1"]').forEach((s) => s.remove());
  }

  async function loadIconPage(isFirst, generation = iconSearchGeneration) {
    if (state.iconLoading) return;
    state.iconLoading = true;
    el.iconLoadMoreBtn.disabled = true;
    el.iconLoadMoreBtn.textContent = I18N.t("loading");

    const page = state.iconPage + 1;
    let items = [];
    let total = null;
    try {
      const r = await window.IconSearch.search(state.iconSearchQuery, { page });
      items = r.items;
      total = r.total;
      await window.IconSearch.fetchIconBodies(items);
    } catch (err) {
      console.error("[Iconify]", err);
      el.providerWarnings.textContent = I18N.t("warn_with_message", { label: "Iconify", message: err.message || I18N.t("warn_generic_error") });
    }

    if (generation !== iconSearchGeneration) {
      // Пока грузили страницу, запустили новый поиск — не показываем устаревшее.
      state.iconLoading = false;
      el.iconLoadMoreBtn.disabled = false;
      el.iconLoadMoreBtn.textContent = I18N.t("load_more");
      return;
    }

    state.iconPage = page;
    state.iconHasMore = items.length > 0;
    // Иконки, для которых не удалось получить тело SVG (например, сеть
    // моргнула на конкретном наборе) — отбрасываем, показывать пустую
    // плитку смысла нет.
    const renderable = items.filter((it) => window.IconSearch.getIconBody(it.prefix, it.name));

    if (isFirst) clearIconSkeletons();

    if (renderable.length === 0 && state.iconItems.length === 0) {
      el.iconGrid.hidden = true;
      el.iconLoadMoreWrap.hidden = true;
      el.iconNoResults.hidden = false;
    } else {
      el.iconNoResults.hidden = true;
      appendIconCards(renderable);
      state.iconItems = state.iconItems.concat(renderable);
      el.iconLoadMoreWrap.hidden = !state.iconHasMore;
    }

    if (isFirst) {
      const n = typeof total === "number" ? total.toLocaleString(I18N.t("locale")) : state.iconItems.length;
      el.resultsCount.textContent = state.iconItems.length ? I18N.t("results_icons_found", { n }) : "";
    }

    state.iconLoading = false;
    el.iconLoadMoreBtn.disabled = false;
    el.iconLoadMoreBtn.textContent = I18N.t("load_more");
  }

  function resetIconToEmpty() {
    iconSearchGeneration++; // отменяем любой поиск, который мог быть в процессе
    state.iconQuery = "";
    state.iconSearchQuery = "";
    state.iconItems = [];
    updateUrlQuery("");
    el.translatedHint.hidden = true;
    el.iconGrid.hidden = true;
    el.iconGrid.innerHTML = "";
    el.iconLoadMoreWrap.hidden = true;
    el.iconNoResults.hidden = true;
    el.emptyState.hidden = false;
    el.resultsCount.textContent = "";
    el.providerWarnings.textContent = "";
  }

  el.iconLoadMoreBtn.addEventListener("click", () => loadIconPage(false));

  const iconInfiniteScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.iconLoading && !el.iconLoadMoreWrap.hidden) {
      loadIconPage(false);
    }
  }, { rootMargin: "800px" });
  iconInfiniteScrollObserver.observe(el.iconLoadMoreWrap);

  // ---------- Icon card rendering ----------
  function appendIconCards(items) {
    const startIndex = state.iconItems.length;
    const frag = document.createDocumentFragment();
    items.forEach((item, i) => frag.appendChild(buildIconCard(item, startIndex + i)));
    el.iconGrid.appendChild(frag);
  }

  function buildIconCard(item, index) {
    const card = document.createElement("div");
    card.className = "icon-card";
    card.title = item.id;

    const svgWrap = document.createElement("div");
    svgWrap.className = "icon-card-svg";
    svgWrap.innerHTML = window.IconSearch.buildSvgMarkup(item.prefix, item.name) || "";
    card.appendChild(svgWrap);

    const label = document.createElement("span");
    label.className = "icon-card-label";
    label.textContent = item.name;
    card.appendChild(label);

    const badge = document.createElement("span");
    badge.className = "icon-card-source-badge";
    badge.textContent = item.prefix;
    card.appendChild(badge);

    card.addEventListener("click", () => openIconLightbox(index));
    return card;
  }

  // ---------- Icon lightbox ----------
  function openIconLightbox(index) {
    state.iconLightboxIndex = index;
    state.iconColor = null;
    renderIconLightbox();
    el.iconLightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeIconLightbox() {
    el.iconLightbox.hidden = true;
    document.body.style.overflow = "";
  }

  function renderIconColorSwatches() {
    el.ilColorSwatches.innerHTML = "";
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "icon-color-swatch icon-color-swatch-auto" + (state.iconColor === null ? " is-active" : "");
    autoBtn.title = I18N.t("icon_color_auto_title");
    autoBtn.addEventListener("click", () => { state.iconColor = null; renderIconLightbox(); });
    el.ilColorSwatches.appendChild(autoBtn);
    ICON_COLORS.forEach((hex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-color-swatch" + (state.iconColor === hex ? " is-active" : "");
      btn.style.background = hex;
      btn.addEventListener("click", () => { state.iconColor = hex; renderIconLightbox(); });
      el.ilColorSwatches.appendChild(btn);
    });
  }

  function renderIconLightbox() {
    const item = state.iconItems[state.iconLightboxIndex];
    if (!item) return;

    el.ilPreview.innerHTML = window.IconSearch.buildSvgMarkup(item.prefix, item.name) || "";
    el.ilPreview.style.color = state.iconColor || "";

    const collection = window.IconSearch.getCollectionInfo(item.prefix);
    el.ilCollectionBadge.textContent = collection?.name || item.prefix;
    el.ilTitle.textContent = item.name.replace(/-/g, " ");

    renderIconColorSwatches();
    renderLicenseBadge(el.ilLicense, window.IconSearch.classifyIconLicense(collection?.license));

    el.ilSourceLink.href = window.IconSearch.iconPageUrl(item.prefix, item.name);

    el.ilPrev.disabled = state.iconLightboxIndex <= 0;
    el.ilNext.disabled = state.iconLightboxIndex >= state.iconItems.length - 1;
  }

  document.querySelectorAll("[data-icon-close]").forEach((n) => n.addEventListener("click", closeIconLightbox));
  el.ilPrev.addEventListener("click", () => {
    if (state.iconLightboxIndex > 0) { state.iconLightboxIndex--; state.iconColor = null; renderIconLightbox(); }
  });
  el.ilNext.addEventListener("click", () => {
    if (state.iconLightboxIndex < state.iconItems.length - 1) { state.iconLightboxIndex++; state.iconColor = null; renderIconLightbox(); }
  });
  document.addEventListener("keydown", (e) => {
    if (el.iconLightbox.hidden) return;
    if (e.key === "Escape") closeIconLightbox();
    else if (e.key === "ArrowLeft") el.ilPrev.click();
    else if (e.key === "ArrowRight") el.ilNext.click();
  });

  function currentIconSvgMarkup() {
    const item = state.iconItems[state.iconLightboxIndex];
    if (!item) return null;
    const markup = window.IconSearch.buildSvgMarkup(item.prefix, item.name);
    if (!markup) return null;
    // Встраиваем выбранный цвет прямо в атрибут, чтобы скачанный/
    // скопированный файл выглядел так же, как в предпросмотре (currentColor
    // вне документа резолвится в чёрный, а не в цвет темы).
    return state.iconColor ? markup.replace('fill="currentColor"', `fill="${state.iconColor}"`) : markup.replace('fill="currentColor"', 'fill="#101114"');
  }

  el.ilCopyName.addEventListener("click", async () => {
    const item = state.iconItems[state.iconLightboxIndex];
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.id);
      showToast(I18N.t("toast_icon_id_copied"));
    } catch {
      showToast(I18N.t("toast_copy_failed"));
    }
  });

  el.ilCopySvg.addEventListener("click", async () => {
    const markup = currentIconSvgMarkup();
    if (!markup) return;
    try {
      await navigator.clipboard.writeText(markup);
      showToast(I18N.t("toast_svg_copied"));
    } catch {
      showToast(I18N.t("toast_copy_failed"));
    }
  });

  el.ilDownloadSvg.addEventListener("click", () => {
    const item = state.iconItems[state.iconLightboxIndex];
    const markup = currentIconSvgMarkup();
    if (!item || !markup) return;
    const blob = new Blob([markup], { type: "image/svg+xml" });
    downloadBlob(blob, `${item.prefix}-${item.name}.svg`);
    showToast(I18N.t("toast_download_done"));
  });

  el.ilDownloadPng.addEventListener("click", async () => {
    const item = state.iconItems[state.iconLightboxIndex];
    const markup = currentIconSvgMarkup();
    if (!item || !markup) return;
    try {
      const blob = await svgMarkupToPngBlob(markup, 512);
      downloadBlob(blob, `${item.prefix}-${item.name}.png`);
      showToast(I18N.t("toast_download_done"));
    } catch (err) {
      console.error(err);
      showToast(I18N.t("toast_image_copy_failed"));
    }
  });

  function svgMarkupToPngBlob(markup, maxSize) {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([markup], { type: "image/svg+xml" });
      const objectUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        const w = ratio >= 1 ? maxSize : Math.round(maxSize * ratio);
        const h = ratio >= 1 ? Math.round(maxSize / ratio) : maxSize;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => {
          URL.revokeObjectURL(objectUrl);
          b ? resolve(b) : reject(new Error("toBlob failed"));
        }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("svg load failed")); };
      img.src = objectUrl;
    });
  }

  // ---------- Favorites ----------
  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      raw.forEach((item) => state.favorites.set(item.id, item));
    } catch { /* битые данные — начинаем с пустого списка */ }
  }
  function persistFavorites() {
    try {
      const arr = Array.from(state.favorites.values()).slice(-MAX_FAVORITES);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
    } catch { /* localStorage недоступен/переполнен — не критично */ }
  }
  function isFavorited(id) {
    return state.favorites.has(id);
  }
  function toggleFavorite(item) {
    if (state.favorites.has(item.id)) state.favorites.delete(item.id);
    else state.favorites.set(item.id, item);
    persistFavorites();
    vibrate(15);
    const nowActive = isFavorited(item.id);
    document.querySelectorAll(`.card-heart[data-id="${cssEscape(item.id)}"]`).forEach((btn) => {
      btn.classList.toggle("is-active", nowActive);
      if (nowActive) popHeart(btn);
    });
    if (state.lightboxIndex >= 0 && getActiveList()[state.lightboxIndex]?.id === item.id) {
      el.lbHeart.setAttribute("aria-pressed", String(nowActive));
      if (nowActive) popHeart(el.lbHeart);
    }
    if (state.view === "favorites") renderFavoritesView();
  }
  function cssEscape(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
  }

  el.favoritesToggle.addEventListener("click", () => {
    const goingToFavorites = state.view !== "favorites";
    state.view = goingToFavorites ? "favorites" : "search";
    el.favoritesToggle.setAttribute("aria-pressed", String(goingToFavorites));
    exitSelectMode();
    if (goingToFavorites) {
      renderFavoritesView();
    } else {
      el.grid.innerHTML = "";
      if (state.query) {
        renderGridFromList(state.items);
        el.grid.hidden = state.items.length === 0;
        el.emptyState.hidden = true;
        el.favoritesEmpty.hidden = true;
      } else {
        resetToEmpty();
      }
    }
  });

  function renderFavoritesView() {
    state.favoritesList = Array.from(state.favorites.values()).reverse();
    el.loadMoreWrap.hidden = true;
    el.noResults.hidden = true;
    el.providerWarnings.textContent = "";
    el.resultsCount.textContent = state.favoritesList.length
      ? I18N.t("results_favorites", { n: state.favoritesList.length })
      : "";
    if (state.favoritesList.length === 0) {
      el.grid.hidden = true;
      el.emptyState.hidden = true;
      el.favoritesEmpty.hidden = false;
      el.grid.innerHTML = "";
      return;
    }
    el.favoritesEmpty.hidden = true;
    el.emptyState.hidden = true;
    el.grid.hidden = false;
    renderGridFromList(state.favoritesList);
  }

  function renderGridFromList(list) {
    el.grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    list.forEach((item, i) => frag.appendChild(buildCard(item, i)));
    el.grid.appendChild(frag);
  }

  // ---------- Card rendering ----------
  function appendCards(items) {
    const startIndex = state.items.length;
    const frag = document.createDocumentFragment();
    items.forEach((item, i) => {
      frag.appendChild(buildCard(item, startIndex + i));
    });
    el.grid.appendChild(frag);
  }

  function buildCard(item, index) {
    const card = document.createElement("div");
    card.className = "card is-img-loading";

    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = item.title || "";
    img.loading = "lazy";
    img.decoding = "async";
    if (item.width && item.height) {
      img.style.aspectRatio = `${item.width} / ${item.height}`;
    }
    const stopLoading = () => card.classList.remove("is-img-loading");
    img.addEventListener("load", stopLoading, { once: true });
    img.addEventListener("error", stopLoading, { once: true });
    img.draggable = true;
    img.addEventListener("dragstart", (e) => {
      // В Chrome/Edge это заставляет перетащить настоящий файл (не превью)
      // прямо на рабочий стол или в другое приложение.
      try {
        const url = item.download?.url || item.full;
        e.dataTransfer.setData("DownloadURL", `image/jpeg:${filenameFor(item)}:${url}`);
        pingUnsplashDownload(item);
      } catch { /* браузер не поддерживает — сработает обычное перетаскивание картинки */ }
    });
    card.appendChild(img);

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "card-select";
    selectBtn.innerHTML = '<span class="icon"></span>';
    if (state.selected.has(item.id)) selectBtn.classList.add("is-checked");
    selectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(item.id, card);
    });
    card.appendChild(selectBtn);

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const badge = document.createElement("span");
    badge.className = "card-source-badge";
    badge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    overlay.appendChild(badge);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "card-actions-bottom";

    const heartBtn = document.createElement("button");
    heartBtn.type = "button";
    heartBtn.className = "card-round-btn card-heart";
    heartBtn.dataset.id = item.id;
    heartBtn.title = I18N.t("card_heart_title");
    heartBtn.innerHTML = '<span class="icon"></span>';
    if (isFavorited(item.id)) heartBtn.classList.add("is-active");
    heartBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(item);
    });
    actionsWrap.appendChild(heartBtn);

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "card-round-btn card-download";
    dlBtn.title = I18N.t("card_download_title");
    dlBtn.innerHTML = '<span class="icon"></span>';
    dlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadItem(item);
    });
    actionsWrap.appendChild(dlBtn);

    overlay.appendChild(actionsWrap);
    card.appendChild(overlay);

    card.addEventListener("click", () => {
      if (state.selectMode) {
        toggleSelect(item.id, card);
        return;
      }
      openLightbox(index);
    });
    return card;
  }

  // ---------- Select mode / bulk zip download ----------
  el.selectModeToggle.addEventListener("click", () => {
    if (state.selectMode) exitSelectMode();
    else enterSelectMode();
  });
  function enterSelectMode() {
    state.selectMode = true;
    state.selected.clear();
    el.selectModeToggle.setAttribute("aria-pressed", "true");
    el.grid.classList.add("is-select-mode");
    updateBulkBar();
  }
  function exitSelectMode() {
    state.selectMode = false;
    state.selected.clear();
    el.selectModeToggle.setAttribute("aria-pressed", "false");
    el.grid.classList.remove("is-select-mode");
    el.grid.querySelectorAll(".card-select.is-checked").forEach((b) => b.classList.remove("is-checked"));
    updateBulkBar();
  }
  function toggleSelect(id, cardEl) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    const btn = cardEl.querySelector(".card-select");
    if (btn) btn.classList.toggle("is-checked", state.selected.has(id));
    updateBulkBar();
  }
  function updateBulkBar() {
    const n = state.selected.size;
    el.bulkBar.hidden = !state.selectMode || n === 0;
    el.bulkCount.textContent = I18N.t("bulk_selected", { n });
  }
  el.bulkCancel.addEventListener("click", exitSelectMode);
  el.bulkDownload.addEventListener("click", downloadSelectedAsZip);

  async function downloadSelectedAsZip() {
    const list = getActiveList();
    const items = list.filter((it) => state.selected.has(it.id));
    if (items.length === 0) return;

    if (!window.JSZip) {
      showToast(I18N.t("toast_archiver_missing"));
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await downloadItem(item);
      }
      return;
    }

    el.bulkDownload.disabled = true;
    const zip = new window.JSZip();
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      showToast(I18N.t("toast_archiving", { i: i + 1, n: items.length }));
      try {
        const url = await resolveDownloadUrl(item);
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error("network");
        // eslint-disable-next-line no-await-in-loop
        const blob = await res.blob();
        zip.file(filenameFor(item), blob);
        recordDownload(item.provider);
        ok++;
      } catch (err) {
        console.warn("Пропущено при архивации:", item.id, err);
      }
    }
    if (ok === 0) {
      showToast(I18N.t("toast_archive_failed_all"));
      el.bulkDownload.disabled = false;
      return;
    }
    vibrate(20);
    showToast(I18N.t("toast_archive_building"));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const objectUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = I18N.t("zip_filename", { n: items.length });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    showToast(I18N.t("toast_archive_done", { ok, n: items.length }));
    el.bulkDownload.disabled = false;
    exitSelectMode();
  }

  function filenameFor(item) {
    return `${item.provider}-${item.id.split("-").pop()}.jpg`;
  }

  // ---------- Lightbox ----------
  function openLightbox(index) {
    state.lightboxIndex = index;
    renderLightbox();
    el.lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    el.lightbox.hidden = true;
    document.body.style.overflow = "";
  }
  // Плашка лицензии (используется и в фото-лайтбоксе, и в лайтбоксе иконок,
  // поэтому принимает целевой элемент, а не завязана на конкретный #lbLicense).
  // У Pixabay/Pexels/Unsplash лицензия одна на весь сток (задана статически в
  // providers.js), у Wikimedia/Openverse/Flickr/наборов иконок — своя у
  // каждого файла, поэтому commercial/attribution там могут быть undefined,
  // если разобрать конкретную лицензию не получилось.
  function renderLicenseBadge(targetEl, license) {
    if (!license || !license.name) {
      targetEl.hidden = true;
      return;
    }
    const nameHtml = license.url
      ? `<a href="${license.url}" target="_blank" rel="noopener noreferrer">${license.name}</a>`
      : license.name;
    const flags = [];
    if (license.commercial === true) {
      flags.push(`<span class="license-flag">${I18N.t("license_commercial_ok")}</span>`);
    } else if (license.commercial === false) {
      flags.push(`<span class="license-flag license-flag-warn">${I18N.t("license_commercial_no")}</span>`);
    }
    if (license.attribution === true) {
      flags.push(`<span class="license-flag">${I18N.t("license_attribution_required")}</span>`);
    }
    if (license.commercial === undefined && license.attribution === undefined) {
      flags.push(`<span class="license-flag license-flag-warn">${I18N.t("license_unknown")}</span>`);
    }
    targetEl.innerHTML = `${nameHtml}${flags.join("")}`;
    targetEl.hidden = false;
  }

  function renderLightbox() {
    const item = getActiveList()[state.lightboxIndex];
    if (!item) return;

    el.lbSpinner.hidden = false;
    el.lbImage.style.opacity = "0";
    el.lbImage.src = item.full;
    el.lbImage.alt = item.title || "";
    el.lbImage.onload = () => {
      el.lbSpinner.hidden = true;
      el.lbImage.style.opacity = "1";
    };

    el.lbHeart.setAttribute("aria-pressed", String(isFavorited(item.id)));
    // Для Unsplash слово "Unsplash" в подписи тоже должно быть ссылкой —
    // это то, что их гайдлайны называют "attribute Unsplash" (пример у них
    // в форме: "Photo by Annie Spratt on Unsplash", где оба имени — ссылки).
    const sourceLabel = item.provider === "unsplash"
      ? `<a href="https://unsplash.com/?utm_source=${encodeURIComponent(window.APP_CONFIG?.UNSPLASH_APP_NAME || "photoseek")}&utm_medium=referral" target="_blank" rel="noopener noreferrer">${PROVIDER_LABELS[item.provider]}</a>`
      : PROVIDER_LABELS[item.provider];
    el.lbSourceBadge.innerHTML = `<span class="dot dot-${item.provider}"></span>${sourceLabel}`;
    el.lbTitle.textContent = item.title || I18N.t("lightbox_untitled");
    el.lbDescription.textContent = item.description && item.description !== item.title ? item.description : "";
    el.lbDescription.hidden = !el.lbDescription.textContent;

    renderLicenseBadge(el.lbLicense, item.license);

    el.lbTags.innerHTML = "";
    (item.tags || []).slice(0, 8).forEach((tag) => {
      const t = document.createElement("span");
      t.className = "lightbox-tag";
      t.textContent = tag;
      el.lbTags.appendChild(t);
    });

    el.lbAuthor.textContent = item.author ? `${I18N.t("lightbox_author_prefix")} ${item.author}` : "";
    el.lbAuthor.href = item.authorUrl || "#";
    el.lbAuthor.style.visibility = item.author ? "visible" : "hidden";
    el.lbSourceLink.href = item.pageUrl || "#";

    const list = getActiveList();
    el.lbPrev.disabled = state.lightboxIndex <= 0;
    el.lbNext.disabled = state.lightboxIndex >= list.length - 1;

    // Предзагружаем соседние полноразмерные фото — переход вперёд/назад
    // ощущается мгновенным.
    [state.lightboxIndex - 1, state.lightboxIndex + 1].forEach((i) => {
      const neighbor = list[i];
      if (neighbor) { const preload = new Image(); preload.src = neighbor.full; }
    });
  }

  document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeLightbox));
  el.lbPrev.addEventListener("click", () => {
    if (state.lightboxIndex > 0) { state.lightboxIndex--; renderLightbox(); }
  });
  el.lbNext.addEventListener("click", () => {
    if (state.lightboxIndex < getActiveList().length - 1) { state.lightboxIndex++; renderLightbox(); }
  });

  // ---------- Свайпы на телефоне ----------
  const lightboxImageWrap = document.querySelector(".lightbox-image-wrap");
  let touchStartX = 0;
  let touchStartY = 0;
  lightboxImageWrap.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  lightboxImageWrap.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      vibrate(10);
      if (dx < 0) el.lbNext.click();
      else el.lbPrev.click();
    }
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (el.lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") el.lbPrev.click();
    else if (e.key === "ArrowRight") el.lbNext.click();
    else if (e.key === "d" || e.key === "D") { e.preventDefault(); el.lbDownload.click(); }
  });

  el.lbHeart.addEventListener("click", () => {
    const item = getActiveList()[state.lightboxIndex];
    if (item) toggleFavorite(item);
  });

  el.lbCopy.addEventListener("click", async () => {
    const item = getActiveList()[state.lightboxIndex];
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.full);
      showToast(I18N.t("toast_link_copied"));
    } catch {
      showToast(I18N.t("toast_copy_failed"));
    }
  });

  el.lbCopyImage.addEventListener("click", async () => {
    const item = getActiveList()[state.lightboxIndex];
    if (!item) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      showToast(I18N.t("toast_image_copy_unsupported"));
      return;
    }
    showToast(I18N.t("toast_copying_image"));
    try {
      const res = await fetch(item.full, { mode: "cors" });
      if (!res.ok) throw new Error("network");
      let blob = await res.blob();
      if (blob.type !== "image/png") blob = await blobToPng(blob);
      await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
      pingUnsplashDownload(item);
      showToast(I18N.t("toast_image_copied"));
    } catch (err) {
      console.error(err);
      showToast(I18N.t("toast_image_copy_failed"));
    }
  });

  function blobToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          URL.revokeObjectURL(objectUrl);
          b ? resolve(b) : reject(new Error("toBlob failed"));
        }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("image load failed")); };
      img.src = objectUrl;
    });
  }

  // ---------- Web Share ----------
  if (navigator.share) {
    el.lbShare.hidden = false;
    el.lbShare.addEventListener("click", async () => {
      const item = getActiveList()[state.lightboxIndex];
      if (!item) return;
      try {
        if (navigator.canShare) {
          try {
            const res = await fetch(item.full, { mode: "cors" });
            const blob = await res.blob();
            const file = new File([blob], filenameFor(item), { type: blob.type || "image/jpeg" });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: item.title || I18N.t("share_title_fallback") });
              pingUnsplashDownload(item);
              return;
            }
          } catch { /* не вышло файлом — делимся ссылкой */ }
        }
        await navigator.share({ title: item.title || I18N.t("share_title_plain"), url: item.pageUrl || item.full });
      } catch (err) {
        if (err?.name !== "AbortError") console.warn("Share failed", err);
      }
    });
  }

  // ---------- Download ----------
  // Ключ Unsplash теперь не хранится в браузере — download_location дёргаем
  // через Cloudflare Worker (см. cloudflare-worker/worker.js), который сам
  // подставляет ключ на своей стороне.
  // Unsplash API Guidelines требуют дёргать photo.links.download_location
  // при любом действии, похожем на скачивание (сохранение, копирование
  // картинки, шаринг файлом, перетаскивание на рабочий стол) — не только
  // при явном клике на "Скачать".
  function unsplashDownloadProxyUrl(item) {
    if (!window.APP_CONFIG?.WORKER_BASE_URL) return null;
    return `${window.APP_CONFIG.WORKER_BASE_URL}/unsplash/download?location=${encodeURIComponent(item.download.locationUrl)}`;
  }

  function pingUnsplashDownload(item) {
    if (item.download?.type === "unsplash" && item.download.locationUrl) {
      const proxyUrl = unsplashDownloadProxyUrl(item);
      if (proxyUrl) fetch(proxyUrl).catch(() => { /* не критично — это просто отметка о скачивании */ });
    }
  }

  async function resolveDownloadUrl(item) {
    if (item.download.type === "unsplash" && item.download.locationUrl) {
      const proxyUrl = unsplashDownloadProxyUrl(item);
      try {
        if (proxyUrl) {
          const res = await fetch(proxyUrl);
          if (res.ok) {
            const data = await res.json();
            if (data.url) return data.url;
          }
        }
      } catch { /* используем прямую ссылку как запасной вариант */ }
    }
    return item.download.url;
  }

  async function downloadItem(item) {
    showToast(I18N.t("toast_downloading"));
    try {
      const url = await resolveDownloadUrl(item);
      await forceDownload(url, filenameFor(item));
      recordDownload(item.provider);
      vibrate(20);
      showToast(I18N.t("toast_download_done"));
    } catch (err) {
      console.error(err);
      showToast(I18N.t("toast_opening_tab"));
      window.open(item.full, "_blank", "noopener,noreferrer");
    }
  }

  async function forceDownload(url, filename) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("network");
    downloadBlob(await res.blob(), filename);
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    if (!el.lightbox.hidden) return; // у лайтбокса свой обработчик выше
    const tag = document.activeElement?.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA";
    if (e.key === "/" && !isTyping) {
      e.preventDefault();
      el.input.focus();
    } else if (e.key === "Escape" && document.activeElement === el.input && el.input.value) {
      el.clearBtn.click();
    }
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("is-visible");
      setTimeout(() => { el.toast.hidden = true; }, 200);
    }, 2200);
  }

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    // Если контроллер уже был (не самый первый визит) и он сменился — значит,
    // сайт обновился, пока страница была открыта со старым JS в памяти.
    // Перезагружаем один раз, чтобы сразу подхватить новую версию, а не
    // ждать следующего захода.
    const hadController = !!navigator.serviceWorker.controller;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
    });
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadedForUpdate) return;
      reloadedForUpdate = true;
      location.reload();
    });
  }

  loadFavorites();
  initTheme();

  // ---------- Сохранённый режим (Фото/Иконки) ----------
  (function initSavedMode() {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* игнорируем */ }
    if (saved === "icons") applyModeUI("icons");
  })();

  // ---------- Открытие по ссылке ?q=...&mode=icons ----------
  const initialParams = new URLSearchParams(location.search);
  const initialQuery = initialParams.get("q");
  if (initialParams.get("mode") === "icons") applyModeUI("icons");
  if (initialQuery) {
    el.input.value = initialQuery;
    el.clearBtn.hidden = false;
    if (state.mode === "icons") runIconSearch();
    else runSearch({ skipSpellcheck: true });
  }
})();
