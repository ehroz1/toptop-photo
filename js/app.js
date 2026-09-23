(function () {
  "use strict";

  const SUGGESTIONS = I18N.t("suggestions");
  const ICON_SUGGESTIONS = I18N.t("suggestions_icons");
  const VIDEO_SUGGESTIONS = I18N.t("suggestions_video");
  const FAVORITES_KEY = "photoseek-favorites";
  const FILTERS_KEY = "photoseek-filters";
  const ICON_FILTERS_KEY = "photoseek-icon-filters";
  const VIDEO_FILTERS_KEY = "photoseek-video-filters";
  const HISTORY_KEY = "photoseek-history";
  const ICON_HISTORY_KEY = "photoseek-icon-history";
  const VIDEO_HISTORY_KEY = "photoseek-video-history";
  const STATS_KEY = "photoseek-stats";
  const THEME_KEY = "photoseek-theme";
  const MODE_KEY = "photoseek-mode";
  const ICON_COLORS = ["#e5484d", "#f5a623", "#2fb344", "#2e7bf6", "#8b5cf6", "#ec4899"];
  const UNSPLASH_LOG_KEY = "photoseek-unsplash-log";
  const MAX_FAVORITES = 300;
  const MAX_HISTORY = 8;
  const UNSPLASH_HOURLY_LIMIT = 50;
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 минут паузы для источника при 429
  const UNSPLASH_FORBIDDEN_COOLDOWN_MS = 30 * 60 * 1000; // пауза Unsplash при 403 (лимит ключа в час)
  // Воркер не смог авторизоваться у источника или ключ не задан — это не
  // лечится повтором через секунду, поэтому источник тоже ставим на паузу.
  const SOURCE_BROKEN_COOLDOWN_MS = 30 * 60 * 1000;
  const SOURCE_BROKEN_RE = /auth failed|is not configured|HTTP 401\b/i;
  const QUALITY_THRESHOLDS = { any: 0, "2k": 2048, "4k": 3840, "8k": 7680 };
  // Условный вес "качества" источника для более умного чередования в ленте —
  // не более чем эвристика, не претендует на объективность.
  const SOURCE_WEIGHTS = { pixabay: 1, pexels: 1.1, unsplash: 1.25, wikimedia: 0.7, openverse: 0.8, flickr: 1, shutterstock: 1, pexafy: 1, doodl: 0.8, archive: 0.7, coverr: 0.9 };
  // Источник, который завис дольше этого, не держит страницу — остальные
  // источники всё равно уже показаны, а этому просто не достаётся места в
  // текущей странице (сам запрос при этом не отменяется, вдруг всё же ответит).
  const PROVIDER_TIMEOUT_MS = 12000;
  // Перевод — тоже best-effort: если MyMemory не ответил за это время, ищем
  // как есть на языке оригинала, вместо того чтобы держать весь поиск.
  const TRANSLATE_TIMEOUT_MS = 2500;
  // Слишком много одновременно опрошенных источников — это не быстрее (см.
  // предыдущую перестройку поиска на независимый параллельный опрос), а
  // просто больше сетевых запросов и шума в ленте; ограничиваем выбор.
  const MAX_ACTIVE_SOURCES = 3;

  const el = {
    topbar: document.getElementById("topbar"),
    form: document.getElementById("searchForm"),
    input: document.getElementById("searchInput"),
    clearBtn: document.getElementById("clearBtn"),
    themeSeg: document.getElementById("themeSeg"),
    gridSeg: document.getElementById("gridSeg"),
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
    authWrap: document.getElementById("authWrap"),
    authToggle: document.getElementById("authToggle"),
    authAvatar: document.getElementById("authAvatar"),
    authPopover: document.getElementById("authPopover"),
    authLoggedOut: document.getElementById("authLoggedOut"),
    authLoggedIn: document.getElementById("authLoggedIn"),
    authGoogleBtn: document.getElementById("authGoogleBtn"),
    authEmailForm: document.getElementById("authEmailForm"),
    authEmailInput: document.getElementById("authEmailInput"),
    authEmailLabel: document.getElementById("authEmailLabel"),
    authAdminLink: document.getElementById("authAdminLink"),
    authSignOutBtn: document.getElementById("authSignOutBtn"),
    authSoon: document.getElementById("authSoon"),
    aboutWrap: document.getElementById("aboutWrap"),
    aboutToggle: document.getElementById("aboutToggle"),
    aboutPopover: document.getElementById("aboutPopover"),
    aboutContacts: document.getElementById("aboutContacts"),
    mainMenuWrap: document.getElementById("mainMenuWrap"),
    mainMenuToggle: document.getElementById("mainMenuToggle"),
    mainMenu: document.getElementById("mainMenu"),
    favoritesCount: document.getElementById("favoritesCount"),
    donateLink: document.getElementById("donateLink"),
    backToTop: document.getElementById("backToTop"),
    recentSearches: document.getElementById("recentSearches"),
    sourcesRow: document.getElementById("sourcesRow"),
    sourcesMenuWrap: document.getElementById("sourcesMenuWrap"),
    sourcesMenuToggle: document.getElementById("sourcesMenuToggle"),
    sourcesMenuPopover: document.getElementById("sourcesMenuPopover"),
    sourcesMenuBadge: document.getElementById("sourcesMenuBadge"),
    sources: document.getElementById("sources"),
    iconSources: document.getElementById("iconSources"),
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
    lbAiBadge: document.getElementById("lbAiBadge"),
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
    iconFiltersRow: document.getElementById("iconFiltersRow"),
    iconFiltersToggle: document.getElementById("iconFiltersToggle"),
    iconFiltersPopover: document.getElementById("iconFiltersPopover"),
    iconFiltersBadge: document.getElementById("iconFiltersBadge"),
    heroP: document.getElementById("heroP"),
    homeSearchSlot: document.getElementById("homeSearchSlot"),
    homeModeSlot: document.getElementById("homeModeSlot"),
    homeSourcesSlot: document.getElementById("homeSourcesSlot"),
    homeControlsSep: document.getElementById("homeControlsSep"),
    homeSourcesList: document.getElementById("homeSourcesList"),
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
    videoSources: document.getElementById("videoSources"),
    videoFiltersRow: document.getElementById("videoFiltersRow"),
    videoFiltersToggle: document.getElementById("videoFiltersToggle"),
    videoFiltersPopover: document.getElementById("videoFiltersPopover"),
    videoFiltersBadge: document.getElementById("videoFiltersBadge"),
    videoGrid: document.getElementById("videoGrid"),
    videoLoadMoreWrap: document.getElementById("videoLoadMoreWrap"),
    videoLoadMoreBtn: document.getElementById("videoLoadMoreBtn"),
    videoNoResults: document.getElementById("videoNoResults"),
    videoLightbox: document.getElementById("videoLightbox"),
    vlPlayer: document.getElementById("vlPlayer"),
    vlSourceBadge: document.getElementById("vlSourceBadge"),
    vlDurationBadge: document.getElementById("vlDurationBadge"),
    vlCopy: document.getElementById("vlCopy"),
    vlDownload: document.getElementById("vlDownload"),
    vlTitle: document.getElementById("vlTitle"),
    vlDescription: document.getElementById("vlDescription"),
    vlTags: document.getElementById("vlTags"),
    vlAuthor: document.getElementById("vlAuthor"),
    vlSourceLink: document.getElementById("vlSourceLink"),
    vlLicense: document.getElementById("vlLicense"),
    vlPrev: document.getElementById("vlPrev"),
    vlNext: document.getElementById("vlNext"),
  };

  const state = {
    mode: "photos", // "photos" | "icons" | "video"
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
    dedupeHashes: [],
    seenUrls: new Set(), // дедуп уровня 1 (точное совпадение URL) — см. dedupeByUrl
    abortController: null, // текущий поиск — отменяет fetch'и всех источников при новом поиске
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
    // Пустой набор = без ограничения (ищем по всем наборам Iconify, как и
    // раньше) — в отличие от activeSources у фото, где пусто невозможно.
    activeIconSources: new Set(),
    iconStyle: "any", // "any" | "mono" | "color"
    // ---- Видео (отдельный пайплайн, но по архитектуре — уменьшенная копия
    // фото: несколько независимых источников, прогрессивный рендер, тот же
    // общий AbortController, что и у фото — см. abortCurrentSearch) ----
    videoQuery: "",
    videoSearchQuery: "",
    activeVideoSources: new Set(),
    videoOrientation: "any",
    videoSort: "popular",
    videoPages: {},
    videoHasMore: {},
    videoItems: [],
    videoLoading: false,
    videoLightboxIndex: -1,
    videoSeenUrls: new Set(),
    videoCooldownUntil: {},
  };

  const PROVIDER_LABELS = {
    pixabay: "Pixabay",
    pexels: "Pexels",
    unsplash: "Unsplash",
    wikimedia: "Wikimedia Commons",
    openverse: "Openverse",
    flickr: "Flickr",
    shutterstock: "Shutterstock",
    pexafy: "Pexafy",
    doodl: "Doodl",
    archive: "Internet Archive",
    coverr: "Coverr",
  };

  function getActiveList() {
    return state.view === "favorites" ? state.favoritesList : state.items;
  }

  // Гонка промиса с таймаутом — не отменяет сам промис (вызывающий код решает,
  // что делать с "опоздавшим" результатом), просто не заставляет ждать его
  // дольше ms. Используется и для перевода запроса, и для отдельных источников.
  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { isTimeout: true })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Отменяет fetch'и предыдущего поиска (все источники, перевод, спеллчекер —
  // все берут signal у текущего state.abortController) и заводит новый
  // контроллер для следующего. Вызывается в начале каждого нового поиска и
  // при полном сбросе — гарантирует, что устаревшие ответы никогда не смогут
  // повлиять на состояние текущего поиска, а не просто игнорируются постфактум.
  function abortCurrentSearch() {
    if (state.abortController) {
      try { state.abortController.abort(); } catch { /* уже отменён/недоступно — не критично */ }
    }
    state.abortController = new AbortController();
    // state.loading — это "идёт загрузка СТРАНИЦЫ", а не "идёт загрузка ЭТОГО
    // поколения поиска": пока отменённые источники ещё не добрались до своего
    // .catch(AbortError), их старая страница формально "не завершена". Мы её
    // уже целиком забраковали (см. generation-проверки в loadPage), поэтому
    // не ждём, пока она сама себя дозавершит — снимаем блокировку сразу же,
    // чтобы новый поиск мог стартовать loadPage без задержки.
    state.loading = false;
    el.loadMoreBtn.disabled = false;
    el.loadMoreBtn.textContent = I18N.t("load_more");
    // Видео делит тот же AbortController/generation-механизм, что и фото
    // (режимы взаимоисключающие) — та же причина снять блокировку сразу же.
    state.videoLoading = false;
    el.videoLoadMoreBtn.disabled = false;
    el.videoLoadMoreBtn.textContent = I18N.t("load_more");
    return state.abortController.signal;
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
    el.themeSeg.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
  }
  function initTheme() {
    applyThemeMode(currentThemeMode());
  }
  function resolveTheme(mode) {
    return mode === "auto" ? (systemThemeQuery.matches ? "dark" : "light") : mode;
  }

  // Смена темы с анимацией. Браузер делает снимок страницы в старой теме, а
  // новая "проявляется" поверх него кругом с мягким краем, который растёт от
  // точки origin (центр кнопки) до дальнего угла экрана — View Transitions
  // API + маска с радиальным градиентом (см. .theme-reveal в styles.css).
  // Без origin (тема ОС сменилась сама) — просто плавная смена кадра.
  // Браузеры без View Transitions получают плавное перетекание цветов, а
  // при "уменьшить движение" в настройках системы тема меняется сразу.
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const THEME_REVEAL_MS = 720;
  // Сплошная часть круга маски (остальное — мягкий край, см. styles.css).
  const THEME_REVEAL_SOLID = 0.7;
  let themeFadeTimer = 0;
  function transitionTheme(update, origin) {
    const root = document.documentElement;
    if (reducedMotionQuery.matches) { update(); return; }
    if (typeof document.startViewTransition !== "function") {
      root.classList.add("theme-fading");
      update();
      clearTimeout(themeFadeTimer);
      themeFadeTimer = setTimeout(() => root.classList.remove("theme-fading"), 600);
      return;
    }
    if (!origin) { document.startViewTransition(update); return; }
    const { x, y } = origin;
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const radius = Math.ceil(reach / THEME_REVEAL_SOLID);
    root.classList.add("theme-reveal");
    const transition = document.startViewTransition(update);
    transition.ready.then(() => {
      root.animate({
        maskSize: ["0px 0px", `${radius * 2}px ${radius * 2}px`],
        maskPosition: [`${x}px ${y}px`, `${x - radius}px ${y - radius}px`],
      }, {
        duration: THEME_REVEAL_MS,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        pseudoElement: "::view-transition-new(root)",
        // Держим конечный кадр до конца перехода: иначе в Chrome между концом
        // анимации и удалением снимков на один кадр возвращалась маска
        // "круг нулевого размера" — и экран моргал старой темой.
        fill: "forwards",
      });
    }).catch(() => { /* переход пропущен (например, второй клик подряд) — тема уже применена */ });
    transition.finished.catch(() => {}).then(() => root.classList.remove("theme-reveal"));
  }

  // Переключатель темы в меню: светлая / тёмная / авто.
  el.themeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-set]");
    if (!btn) return;
    const next = btn.dataset.themeSet;
    if (next === currentThemeMode()) return;
    // "Авто" может совпасть с текущей темой — тогда меняется только выбор.
    if (resolveTheme(next) === document.documentElement.getAttribute("data-theme")) {
      applyThemeMode(next);
      return;
    }
    // Круг новой темы растёт от нажатой кнопки.
    const r = btn.getBoundingClientRect();
    transitionTheme(() => applyThemeMode(next), { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  });

  // ---------- Размер сетки (крупные / средние / мелкие фото) ----------
  const GRID_SIZE_KEY = "photoseek-grid-size";
  function applyGridSize(size) {
    document.documentElement.setAttribute("data-grid", size);
    el.gridSeg.querySelectorAll("[data-grid-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gridSet === size)));
  }
  let savedGrid = "2";
  try { savedGrid = localStorage.getItem(GRID_SIZE_KEY) || "2"; } catch { /* не критично */ }
  applyGridSize(["1", "2", "3"].includes(savedGrid) ? savedGrid : "2");
  el.gridSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-grid-set]");
    if (!btn) return;
    applyGridSize(btn.dataset.gridSet);
    try { localStorage.setItem(GRID_SIZE_KEY, btn.dataset.gridSet); } catch { /* не критично */ }
  });
  // Пока режим "авто" — живо следуем за системной темой (например, автоночь
  // по расписанию ОС), без перезагрузки страницы.
  systemThemeQuery.addEventListener("change", (e) => {
    if (currentThemeMode() !== "auto") return;
    transitionTheme(() => document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light"));
  });

  // ---------- Прокрутка: шапка и кнопка «Наверх» ----------
  // Кнопка «Наверх» появляется, когда ушли вниз дальше полутора экранов.
  function onScroll() {
    el.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
    const showTop = window.scrollY > window.innerHeight * 1.5;
    if (showTop !== el.backToTop.classList.contains("is-visible")) {
      el.backToTop.classList.toggle("is-visible", showTop);
      el.backToTop.tabIndex = showTop ? 0 : -1;
      el.backToTop.setAttribute("aria-hidden", String(!showTop));
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  el.backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: reducedMotionQuery.matches ? "auto" : "smooth" });
  });

  // ---------- Mode dispatch helpers ----------
  // Большинство мест в коде (саджесты, история, Enter в пустом поле и т.п.)
  // хотят одно и то же: "запусти/сбрось поиск в ТЕКУЩЕМ режиме" — вместо
  // трёхветочного if/else в каждом таком месте, две точки входа здесь.
  // Лог поиска в Supabase (для статистики в админке) — best-effort, ничего
  // не ждём и не показываем при сбое: это не влияет на сам поиск.
  function logSearch(query, mode) {
    const base = window.APP_CONFIG?.WORKER_BASE_URL;
    if (!base || !query || !window.APP_CONFIG?.ACCOUNTS_ENABLED) return;
    const token = window.PhotoSeekAuth && window.PhotoSeekAuth.getAccessToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${base}/log-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, mode }),
    }).catch(() => {});
  }

  function runSearchForMode(opts) {
    logSearch(el.input.value.trim(), state.mode);
    if (state.mode === "icons") runIconSearch(opts);
    else if (state.mode === "video") runVideoSearch(opts);
    else runSearch(opts);
  }
  function resetForMode() {
    if (state.mode === "icons") resetIconToEmpty();
    else if (state.mode === "video") resetVideoToEmpty();
    else resetToEmpty();
  }

  // ---------- Mode switch (Фото / Иконки / Видео) ----------
  // Иконки и видео — принципиально другой поиск (Iconify / видео-провайдеры
  // вместо фотостоков, см. js/icons.js и js/videoProviders.js), поэтому у
  // каждого своя сетка/лайтбокс/история и вместо фильтров по фото
  // (ориентация/качество/люди/цвет) показывать нечего — просто прячем
  // элементы других режимов, а не пытаемся их подстроить.
  function applyModeUI(mode) {
    state.mode = mode;
    el.modeSwitch.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    const isIcons = mode === "icons";
    const isVideo = mode === "video";
    const isPhotos = mode === "photos";
    el.sourcesRow.hidden = !isPhotos;
    el.sourcesMenuWrap.hidden = !isPhotos;
    el.filtersRow.hidden = !isPhotos;
    el.iconSources.hidden = !isIcons;
    el.iconFiltersRow.hidden = !isIcons;
    el.videoSources.hidden = !isVideo;
    el.videoFiltersRow.hidden = !isVideo;
    el.selectModeToggle.hidden = !isPhotos;
    applyHeroForMode();
    renderSuggestionChips();
    renderHistory();
  }
  function setMode(mode) {
    if (mode === state.mode) return;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* не критично */ }
    if (mode !== "photos" && state.view === "favorites") {
      state.view = "search";
      el.favoritesToggle.setAttribute("aria-pressed", "false");
    }
    exitSelectMode();
    closeLightbox();
    closeIconLightbox();
    closeVideoLightbox();
    closeFiltersPopover();
    closeIconFiltersPopover();
    closeVideoFiltersPopover();
    closeSourcesMenuPopover();
    const prevMode = state.mode;
    applyModeUI(mode);
    if (prevMode === "icons" && mode !== "icons") {
      el.iconGrid.hidden = true;
      el.iconGrid.innerHTML = "";
      el.iconLoadMoreWrap.hidden = true;
      el.iconNoResults.hidden = true;
    }
    if (prevMode === "video" && mode !== "video") {
      el.videoGrid.hidden = true;
      el.videoGrid.innerHTML = "";
      el.videoLoadMoreWrap.hidden = true;
      el.videoNoResults.hidden = true;
    }
    if (prevMode === "photos" && mode !== "photos") {
      searchGeneration++; // отменяем фотопоиск, который мог быть в процессе
      abortCurrentSearch(); // и его fetch'и
      el.grid.hidden = true;
      masonryObserver.disconnect();
      clearImageLoadQueue();
      el.grid.innerHTML = "";
      el.loadMoreWrap.hidden = true;
      el.noResults.hidden = true;
    }
    if (prevMode === "video" && mode !== "video") {
      videoSearchGeneration++;
      abortCurrentSearch();
    }
    const q = el.input.value.trim();
    if (q) runSearchForMode(); else resetForMode();
  }
  el.modeSwitch.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  function applyHeroForMode() {
    const suffix = state.mode === "icons" ? "_icons" : state.mode === "video" ? "_video" : "";
    el.heroP.textContent = I18N.t(`home_tagline${suffix}`);
    el.homeControlsSep.hidden = state.mode !== "photos";
    updateHomeSourcesList();
  }

  // Строка активных источников под поиском на главном экране:
  // "Pixabay · Pexels · Wikimedia Commons".
  function updateHomeSourcesList() {
    let names;
    if (state.mode === "icons") {
      names = Array.from(el.iconSources.querySelectorAll("[data-icon-source]"))
        .filter((b) => state.activeIconSources.has(b.dataset.iconSource))
        .map((b) => b.textContent.trim());
      if (names.length === 0) names = [I18N.t("home_sources_icons_all")];
    } else {
      const providers = state.mode === "video" ? (window.VIDEO_PROVIDERS || []) : (window.PROVIDERS || []);
      const active = state.mode === "video" ? state.activeVideoSources : state.activeSources;
      names = providers.filter((p) => active.has(p.id) && p.enabled()).map((p) => p.label);
    }
    el.homeSourcesList.textContent = names.join("  ·  ");
  }

  // ---------- Главный экран ↔ выдача ----------
  // Пока нет результатов (виден #emptyState), строка поиска, вкладки режимов
  // и "Источники" живут в центре главного экрана; после поиска возвращаются
  // в шапку и панель над выдачей. Узлы переносятся целиком (со всеми
  // обработчиками), на исходных местах остаются невидимые метки-якоря.
  const homeMoves = [
    [el.form, el.homeSearchSlot],
    [el.modeSwitch, el.homeModeSlot],
    [el.sourcesMenuWrap, el.homeSourcesSlot],
  ].map(([node, slot]) => {
    const anchor = document.createComment("home-anchor");
    node.parentNode.insertBefore(anchor, node);
    return { node, slot, anchor };
  });
  let isHomeLayout = null;
  function applyHomeLayout() {
    const home = !el.emptyState.hidden;
    if (home === isHomeLayout) return;
    isHomeLayout = home;
    const hadFocus = document.activeElement === el.input;
    for (const { node, slot, anchor } of homeMoves) {
      if (home) slot.appendChild(node);
      else anchor.parentNode.insertBefore(node, anchor.nextSibling);
    }
    document.body.classList.toggle("is-home", home);
    // Перенос узла сбрасывает фокус — возвращаем, если человек печатал.
    if (hadFocus && !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
      el.input.focus({ preventScroll: true });
    }
  }
  new MutationObserver(applyHomeLayout).observe(el.emptyState, { attributes: true, attributeFilter: ["hidden"] });
  applyHomeLayout();

  // ---------- Suggestions ----------
  function renderSuggestionChips() {
    el.suggestions.querySelectorAll(".suggestion-chip").forEach((c) => c.remove());
    const list = state.mode === "icons" ? ICON_SUGGESTIONS : state.mode === "video" ? VIDEO_SUGGESTIONS : SUGGESTIONS;
    list.forEach((term) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = term;
      chip.addEventListener("click", () => {
        el.input.value = term;
        el.clearBtn.hidden = false;
        runSearchForMode();
      });
      el.suggestions.appendChild(chip);
    });
  }
  renderSuggestionChips();

  // ---------- Search history ----------
  // У иконок и видео своя история (короткие технические запросы вроде
  // "home"/"user" не должны мешаться с историей поиска фото).
  function historyKeyForMode() {
    if (state.mode === "icons") return ICON_HISTORY_KEY;
    if (state.mode === "video") return VIDEO_HISTORY_KEY;
    return HISTORY_KEY;
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
        runSearchForMode();
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

  // Если активных источников больше лимита (миграция со старых сохранённых
  // фильтров, где лимита ещё не было) — оставляем первые cap штук в порядке
  // чипов на странице, остальные выключаем. Для фото (allowZero=false) это
  // никогда не опустошает набор — уже не более 3 при входе в эту функцию
  // означает, что 3 и останется; для иконок (allowZero=true) 0 — валидное
  // состояние ("без ограничения"), поэтому его вообще не трогаем.
  function enforceSourceCap(chips, activeSet, cap) {
    const idOf = (c) => c.dataset.source || c.dataset.iconSource || c.dataset.videoSource;
    // Фото теперь чекбоксы (popover "Источники"), иконки/видео — кнопки-пилюли
    // (aria-pressed) — один и тот же хелпер обслуживает оба вида элементов.
    const deactivate = (c) => (c.type === "checkbox" ? (c.checked = false) : c.setAttribute("aria-pressed", "false"));
    const activeChips = chips.filter((c) => activeSet.has(idOf(c)));
    if (activeChips.length <= cap) return false;
    activeChips.slice(cap).forEach((c) => {
      deactivate(c);
      activeSet.delete(idOf(c));
    });
    return true;
  }

  // ---------- Persisted filters ----------
  // Список ИСКЛЮЧЁННЫХ источников, а не включённых — иначе каждый новый
  // источник, добавленный позже (как Shutterstock/Pexafy/Doodl сейчас), не
  // попадал бы в старый сохранённый список "включённых" и оказывался
  // молча выключен у всех, кто уже сохранял фильтры раньше.
  function saveFilters() {
    try {
      const visibleIds = Array.from(el.sources.querySelectorAll("input.source-checkbox[data-source]:not([hidden])"))
        .map((c) => c.dataset.source);
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        orientation: state.orientation,
        sort: state.sort,
        quality: state.quality,
        color: state.color,
        people: state.people,
        disabledSources: visibleIds.filter((id) => !state.activeSources.has(id)),
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

  // Источники, которые существовали до перехода на формат disabledSources —
  // нужны только для миграции старых сохранённых фильтров (см. ниже).
  const LEGACY_SOURCE_IDS = ["pixabay", "pexels", "unsplash", "wikimedia", "openverse", "flickr"];

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

    let disabled;
    if (Array.isArray(saved.disabledSources)) {
      disabled = new Set(saved.disabledSources);
    } else if (Array.isArray(saved.activeSources)) {
      // Старый формат — список ВКЛЮЧЁННЫХ источников. Переносим только явные
      // отключения среди источников, которые существовали на тот момент;
      // источник, добавленный позже, в старом списке просто не было — это не
      // значит, что пользователь его выключил, поэтому оставляем как есть.
      disabled = new Set(LEGACY_SOURCE_IDS.filter((id) => !saved.activeSources.includes(id)));
    } else {
      disabled = new Set();
    }

    el.sources.querySelectorAll("input.source-checkbox[data-source]").forEach((cb) => {
      if (cb.hidden) return; // источник без ключа — недоступен, не трогаем
      const want = !disabled.has(cb.dataset.source);
      cb.checked = want;
      if (want) state.activeSources.add(cb.dataset.source);
      else state.activeSources.delete(cb.dataset.source);
    });

    // Сохранённые фильтры могли появиться до лимита в MAX_ACTIVE_SOURCES —
    // подрезаем и сразу пересохраняем исправленный список, чтобы это не
    // повторялось на каждой загрузке.
    const visibleChips = Array.from(el.sources.querySelectorAll("input.source-checkbox[data-source]:not([hidden])"));
    if (enforceSourceCap(visibleChips, state.activeSources, MAX_ACTIVE_SOURCES)) saveFilters();
  }

  // Источники без ключа в config.js просто скрываем — они появятся сами,
  // как только в config.js добавят соответствующий ключ. Видимый источник
  // включён по умолчанию — синхронизируем это и в state, и визуально на
  // чипе (иначе, например, Flickr при FLICKR_ENABLED:true оказался бы
  // фактически включён в поиск, но с виду выглядел бы выключенным).
  (function initSourceChips() {
    const byId = {};
    (window.PROVIDERS || []).forEach((p) => { byId[p.id] = p; });
    let activatedCount = 0;
    el.sources.querySelectorAll("input.source-checkbox[data-source]").forEach((cb) => {
      const provider = byId[cb.dataset.source];
      if (provider && provider.enabled()) {
        const activate = activatedCount < MAX_ACTIVE_SOURCES;
        if (activate) {
          state.activeSources.add(provider.id);
          activatedCount++;
        }
        cb.checked = activate;
      } else {
        cb.hidden = true;
      }
    });
  })();

  loadPersistedFilters();
  updateFiltersBadge();

  // ---------- Persisted icon filters (стиль + выбор наборов иконок) ----------
  function saveIconFilters() {
    try {
      localStorage.setItem(ICON_FILTERS_KEY, JSON.stringify({
        iconStyle: state.iconStyle,
        activeIconSources: Array.from(state.activeIconSources),
      }));
    } catch { /* localStorage недоступен — не критично */ }
  }
  function loadPersistedIconFilters() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ICON_FILTERS_KEY) || "null"); } catch { /* битые данные — игнорируем */ }
    if (!saved) return;
    if (saved.iconStyle) {
      state.iconStyle = saved.iconStyle;
      setDropdownUI("iconStyle", saved.iconStyle);
    }
    const chips = Array.from(el.iconSources.querySelectorAll("[data-icon-source]"));
    if (Array.isArray(saved.activeIconSources)) {
      const known = new Set(chips.map((c) => c.dataset.iconSource));
      saved.activeIconSources.filter((id) => known.has(id)).forEach((id) => state.activeIconSources.add(id));
      chips.forEach((chip) => chip.setAttribute("aria-pressed", String(state.activeIconSources.has(chip.dataset.iconSource))));
      if (enforceSourceCap(chips, state.activeIconSources, MAX_ACTIVE_SOURCES)) saveIconFilters();
    }
  }
  loadPersistedIconFilters();
  updateIconFiltersBadge();

  // ---------- Persisted video filters ----------
  // Та же схема, что у фото (disabledSources + минимум 1 активный) — в
  // отличие от иконок, у видео каждый источник — реальный отдельный запрос,
  // а не общий каталог, так что "0 активных" тут не осмысленное состояние.
  function saveVideoFilters() {
    try {
      const visibleIds = Array.from(el.videoSources.querySelectorAll(".source-chip[data-video-source]:not([hidden])"))
        .map((c) => c.dataset.videoSource);
      localStorage.setItem(VIDEO_FILTERS_KEY, JSON.stringify({
        videoOrientation: state.videoOrientation,
        videoSort: state.videoSort,
        disabledSources: visibleIds.filter((id) => !state.activeVideoSources.has(id)),
      }));
    } catch { /* localStorage недоступен — не критично */ }
  }
  function loadPersistedVideoFilters() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIDEO_FILTERS_KEY) || "null"); } catch { /* битые данные — игнорируем */ }
    if (!saved) return;
    ["videoOrientation", "videoSort"].forEach((key) => {
      if (saved[key]) { state[key] = saved[key]; setDropdownUI(key, saved[key]); }
    });
    const disabled = new Set(Array.isArray(saved.disabledSources) ? saved.disabledSources : []);
    el.videoSources.querySelectorAll(".source-chip[data-video-source]").forEach((chip) => {
      if (chip.hidden) return;
      const want = !disabled.has(chip.dataset.videoSource);
      chip.setAttribute("aria-pressed", String(want));
      if (want) state.activeVideoSources.add(chip.dataset.videoSource);
      else state.activeVideoSources.delete(chip.dataset.videoSource);
    });
    const visibleChips = Array.from(el.videoSources.querySelectorAll(".source-chip[data-video-source]:not([hidden])"));
    if (enforceSourceCap(visibleChips, state.activeVideoSources, MAX_ACTIVE_SOURCES)) saveVideoFilters();
  }

  (function initVideoSourceChips() {
    const byId = {};
    (window.VIDEO_PROVIDERS || []).forEach((p) => { byId[p.id] = p; });
    let activatedCount = 0;
    el.videoSources.querySelectorAll(".source-chip[data-video-source]").forEach((chip) => {
      const provider = byId[chip.dataset.videoSource];
      if (provider && provider.enabled()) {
        const activate = activatedCount < MAX_ACTIVE_SOURCES;
        if (activate) { state.activeVideoSources.add(provider.id); activatedCount++; }
        chip.setAttribute("aria-pressed", String(activate));
      } else {
        chip.hidden = true;
      }
    });
  })();

  loadPersistedVideoFilters();
  updateVideoFiltersBadge();

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
  // Статистика раскрывается прямо в меню, под своим пунктом.
  function setInsightsOpen(open) {
    if (open) renderInsights();
    el.insightsPanel.hidden = !open;
    el.insightsToggle.setAttribute("aria-expanded", String(open));
  }
  el.insightsToggle.addEventListener("click", () => setInsightsOpen(el.insightsPanel.hidden));

  // ---------- Шапка: «молния», профиль, меню ----------
  // Открыто не больше одного окна; клик мимо или Esc закрывает.
  const topbarPopovers = [
    { wrap: el.aboutWrap, toggle: el.aboutToggle, popover: el.aboutPopover },
    { wrap: el.authWrap, toggle: el.authToggle, popover: el.authPopover },
    { wrap: el.mainMenuWrap, toggle: el.mainMenuToggle, popover: el.mainMenu, onClose: () => setInsightsOpen(false) },
  ];
  function closeTopbarPopover(p) {
    if (p.popover.hidden) return;
    p.popover.hidden = true;
    p.toggle.setAttribute("aria-expanded", "false");
    if (p.onClose) p.onClose();
  }
  function closeTopbarPopovers() {
    topbarPopovers.forEach(closeTopbarPopover);
  }
  topbarPopovers.forEach((p) => {
    p.toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = p.popover.hidden;
      closeTopbarPopovers();
      if (!willOpen) return;
      document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
      p.popover.hidden = false;
      p.toggle.setAttribute("aria-expanded", "true");
    });
  });
  document.addEventListener("click", (e) => {
    topbarPopovers.forEach((p) => { if (!p.wrap.contains(e.target)) closeTopbarPopover(p); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = topbarPopovers.find((p) => !p.popover.hidden);
    if (!open) return;
    closeTopbarPopover(open);
    open.toggle.focus();
  });

  // Контакты — из APP_CONFIG.CONTACTS (см. js/config.js).
  (function renderContacts() {
    const contacts = (window.APP_CONFIG?.CONTACTS || []).filter((c) => c && c.url);
    el.aboutContacts.replaceChildren(...contacts.map((c) => {
      const a = document.createElement("a");
      a.className = "about-contact";
      a.href = c.url;
      a.textContent = c.label || c.url;
      if (!/^mailto:/i.test(c.url)) { a.target = "_blank"; a.rel = "noopener"; }
      return a;
    }));
    if (contacts.length === 0) {
      const p = document.createElement("p");
      p.className = "about-text";
      p.textContent = I18N.t("about_no_contacts");
      el.aboutContacts.append(p);
    }
  })();

  const DONATE_URL = window.APP_CONFIG?.DONATE_URL || "";
  if (DONATE_URL) el.donateLink.href = DONATE_URL;
  el.donateLink.addEventListener("click", (e) => {
    if (DONATE_URL) { closeTopbarPopovers(); return; }
    e.preventDefault();
    showToast(I18N.t("donate_soon"));
  });

  function updateFavoritesCount() {
    el.favoritesCount.textContent = state.favorites.size ? String(state.favorites.size) : "";
  }

  // ---------- Search input ----------
  // Поиск стартует только по Enter / кнопке поиска, а не на каждую букву.
  el.input.addEventListener("input", () => {
    el.clearBtn.hidden = el.input.value.length === 0;
  });
  el.clearBtn.addEventListener("click", () => {
    el.input.value = "";
    el.clearBtn.hidden = true;
    el.input.focus();
    resetForMode();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    // На телефоне прячем экранную клавиатуру, чтобы она не закрывала
    // результаты. На компьютере фокус оставляем — удобно сразу уточнить запрос.
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) el.input.blur();
    runSearchForMode();
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
        runSearchForMode();
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

  // ---------- Source chip groups (фото / иконки / видео) ----------
  // Общая логика лимита MAX_ACTIVE_SOURCES, "притушенных" чипов при
  // достижении потолка (клик по притушенному всё равно работает — просто
  // показывает тост-объяснение вместо молчаливого игнорирования) и
  // правила "минимум 1 активный" — раньше было продублировано отдельно на
  // фото и иконки, теперь одна функция на все три группы источников.
  // allowZero=true (иконки) — 0 активных валидно и означает "без сужения";
  // allowZero=false (фото/видео) — как минимум один источник обязателен,
  // т.к. у каждого реальный сетевой запрос, а не общий каталог на всех.
  function bindSourceChipGroup(container, attr, key, activeSet, { allowZero, onChange }) {
    function chips() { return Array.from(container.querySelectorAll(`.source-chip[${attr}]:not([hidden])`)); }
    function updateCapVisual() {
      const atCap = activeSet.size >= MAX_ACTIVE_SOURCES;
      chips().forEach((c) => c.classList.toggle("is-capped", atCap));
    }
    chips().forEach((chip) => {
      chip.addEventListener("click", () => {
        const src = chip.dataset[key];
        const willBeActive = chip.getAttribute("aria-pressed") !== "true";
        if (willBeActive) {
          if (activeSet.size >= MAX_ACTIVE_SOURCES) {
            showToast(I18N.t("sources_max_reached", { n: MAX_ACTIVE_SOURCES }));
            return;
          }
        } else if (!allowZero && activeSet.size <= 1) {
          return; // хотя бы один источник должен остаться включён
        }
        chip.setAttribute("aria-pressed", String(willBeActive));
        if (willBeActive) activeSet.add(src);
        else activeSet.delete(src);
        updateCapVisual();
        onChange();
      });
    });
    updateCapVisual();
  }
  // Фото — единственная группа с реальными <input type="checkbox"> (в
  // popover "Источники"), а не кнопками-пилюлями, поэтому у неё свой
  // байндер: событие "change", а не "click", и `checked` вместо `aria-pressed`.
  // Логика лимита/тоста/"минимум 1" — та же, что и в bindSourceChipGroup ниже.
  function bindSourceCheckboxGroup(container, activeSet, { onChange }) {
    function boxes() { return Array.from(container.querySelectorAll("input.source-checkbox[data-source]:not([hidden])")); }
    function updateCapVisual() {
      const atCap = activeSet.size >= MAX_ACTIVE_SOURCES;
      boxes().forEach((cb) => cb.closest(".source-check-row").classList.toggle("is-capped", atCap && !cb.checked));
    }
    boxes().forEach((cb) => {
      cb.addEventListener("change", () => {
        const src = cb.dataset.source;
        if (cb.checked) {
          if (activeSet.size >= MAX_ACTIVE_SOURCES) {
            cb.checked = false;
            showToast(I18N.t("sources_max_reached", { n: MAX_ACTIVE_SOURCES }));
            return;
          }
          activeSet.add(src);
        } else {
          if (activeSet.size <= 1) {
            cb.checked = true; // хотя бы один источник должен остаться включён
            return;
          }
          activeSet.delete(src);
        }
        updateCapVisual();
        updateSourcesMenuBadge();
        onChange();
      });
    });
    updateCapVisual();
  }
  bindSourceCheckboxGroup(el.sources, state.activeSources, {
    onChange: () => { saveFilters(); updateHomeSourcesList(); if (state.query) runSearch({ keepTranslation: true }); },
  });
  updateHomeSourcesList();

  // ---------- Popover "Источники" (фото) ----------
  function updateSourcesMenuBadge() {
    el.sourcesMenuBadge.textContent = String(state.activeSources.size);
  }
  updateSourcesMenuBadge();
  function closeSourcesMenuPopover() {
    el.sourcesMenuPopover.hidden = true;
    el.sourcesMenuToggle.setAttribute("aria-expanded", "false");
  }
  el.sourcesMenuToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el.sourcesMenuPopover.hidden;
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    el.sourcesMenuPopover.hidden = !willOpen;
    el.sourcesMenuToggle.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) fitSourcesListToViewport();
  });
  // Список не должен уходить за нижний край экрана (на главной окно
  // открывается посреди экрана) — подгоняем высоту под свободное место,
  // остальное прокручивается внутри окна.
  function fitSourcesListToViewport() {
    el.sources.style.maxHeight = "";
    const top = el.sources.getBoundingClientRect().top;
    const available = window.innerHeight - top - 24;
    const natural = el.sources.scrollHeight;
    if (natural > available) el.sources.style.maxHeight = `${Math.max(160, Math.floor(available))}px`;
  }
  document.addEventListener("click", (e) => {
    if (!el.sourcesMenuPopover.hidden && !el.sourcesMenuWrap.contains(e.target)) closeSourcesMenuPopover();
  });

  // ---------- Вход (Supabase) ----------
  // Кнопка профиля видна всегда. Пока вход выключен (ACCOUNTS_ENABLED в
  // js/config.js), её окно просто говорит, что регистрация скоро появится.
  if (window.PhotoSeekAuth && window.PhotoSeekAuth.isConfigured()) {
    el.authSoon.hidden = true;
    el.authLoggedOut.hidden = false;

    window.PhotoSeekAuth.onChange((session) => {
      const user = session && session.user;
      el.authLoggedOut.hidden = Boolean(user);
      el.authLoggedIn.hidden = !user;
      el.authSignOutBtn.hidden = !user;
      el.authToggle.classList.toggle("is-signed-in", Boolean(user));
      if (user) {
        const label = user.email || "";
        el.authEmailLabel.textContent = label;
        // Фото из Google-аккаунта, если есть, иначе первая буква почты.
        const photo = user.user_metadata && user.user_metadata.avatar_url;
        el.authAvatar.textContent = photo ? "" : (label.slice(0, 1) || "?");
        el.authAvatar.style.backgroundImage = photo ? `url("${String(photo).replace(/["\\]/g, "")}")` : "";
        el.authAvatar.hidden = false;
        el.authToggle.querySelector(".icon-user").hidden = true;
        el.authAdminLink.hidden = false;
      } else {
        el.authAvatar.hidden = true;
        el.authToggle.querySelector(".icon-user").hidden = false;
        el.authAdminLink.hidden = true;
      }
    });

    el.authGoogleBtn.addEventListener("click", async () => {
      try {
        await window.PhotoSeekAuth.signInWithGoogle();
      } catch (err) {
        showToast(`Не удалось начать вход через Google: ${err.message}`);
      }
    });

    el.authEmailForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = el.authEmailInput.value.trim();
      if (!email) return;
      const submitBtn = el.authEmailForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      try {
        await window.PhotoSeekAuth.signInWithEmail(email);
        showToast("Ссылка для входа отправлена на почту");
        el.authEmailInput.value = "";
        closeTopbarPopovers();
      } catch (err) {
        showToast(`Не удалось отправить ссылку: ${err.message}`);
      } finally {
        submitBtn.disabled = false;
      }
    });

    el.authSignOutBtn.addEventListener("click", async () => {
      closeTopbarPopovers();
      await window.PhotoSeekAuth.signOut();
    });
  }

  bindSourceChipGroup(el.iconSources, "data-icon-source", "iconSource", state.activeIconSources, {
    allowZero: true,
    onChange: () => { saveIconFilters(); updateHomeSourcesList(); rerunIconSearchWithFilters(); },
  });
  bindSourceChipGroup(el.videoSources, "data-video-source", "videoSource", state.activeVideoSources, {
    allowZero: false,
    onChange: () => { saveVideoFilters(); updateHomeSourcesList(); rerunVideoSearchWithFilters(); },
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

    // Дропдауны иконок/видео живут в своих popover'ах и сохраняются/
    // перезапускают поиск по-своему — выключены из общей фото-ветки ниже.
    const isIconDropdown = !!dropdown.closest("#iconFiltersPopover");
    const isVideoDropdown = !!dropdown.closest("#videoFiltersPopover");

    menu.querySelectorAll(".dropdown-item").forEach((item) => {
      item.addEventListener("click", () => {
        menu.querySelectorAll(".dropdown-item").forEach((i) => i.classList.remove("is-active"));
        item.classList.add("is-active");
        valueEl.textContent = item.textContent.trim();
        state[key] = item.dataset.val;
        dropdown.classList.remove("is-open");
        if (isIconDropdown) {
          saveIconFilters();
          updateIconFiltersBadge(true);
          rerunIconSearchWithFilters();
        } else if (isVideoDropdown) {
          saveVideoFilters();
          updateVideoFiltersBadge(true);
          rerunVideoSearchWithFilters();
        } else {
          saveFilters();
          updateFiltersBadge(true);
          if (state.query) runSearch({ keepTranslation: true });
        }
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
  function updateFiltersBadge(animate = false) {
    const activeCount = [
      state.quality !== "any",
      state.orientation !== "any",
      state.sort !== "popular",
      state.people !== "any",
      state.color !== "any",
    ].filter(Boolean).length;
    const changed = el.filtersBadge.textContent !== String(activeCount);
    el.filtersBadge.textContent = String(activeCount);
    el.filtersBadge.hidden = activeCount === 0;
    el.filtersToggle.classList.toggle("has-active-filters", activeCount > 0);
    if (animate && changed && activeCount > 0) popHeart(el.filtersBadge);
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
    if (!el.iconFiltersPopover.hidden && !el.iconFiltersRow.contains(e.target)) closeIconFiltersPopover();
    if (!el.videoFiltersPopover.hidden && !el.videoFiltersRow.contains(e.target)) closeVideoFiltersPopover();
  });

  // ---------- Кнопка фильтров иконок (стиль: любой/одноцветные/цветные) ----------
  function updateIconFiltersBadge(animate = false) {
    const activeCount = (state.iconStyle !== "any" ? 1 : 0) + (state.activeIconSources.size > 0 ? 1 : 0);
    const changed = el.iconFiltersBadge.textContent !== String(activeCount);
    el.iconFiltersBadge.textContent = String(activeCount);
    el.iconFiltersBadge.hidden = activeCount === 0;
    el.iconFiltersToggle.classList.toggle("has-active-filters", activeCount > 0);
    if (animate && changed && activeCount > 0) popHeart(el.iconFiltersBadge);
  }
  function closeIconFiltersPopover() {
    el.iconFiltersPopover.hidden = true;
    el.iconFiltersToggle.setAttribute("aria-expanded", "false");
  }
  el.iconFiltersToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el.iconFiltersPopover.hidden;
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    el.iconFiltersPopover.hidden = !willOpen;
    el.iconFiltersToggle.setAttribute("aria-expanded", String(willOpen));
  });

  // ---------- Кнопка фильтров видео (ориентация/сортировка) ----------
  function updateVideoFiltersBadge(animate = false) {
    const activeCount = [state.videoOrientation !== "any", state.videoSort !== "popular"].filter(Boolean).length;
    const changed = el.videoFiltersBadge.textContent !== String(activeCount);
    el.videoFiltersBadge.textContent = String(activeCount);
    el.videoFiltersBadge.hidden = activeCount === 0;
    el.videoFiltersToggle.classList.toggle("has-active-filters", activeCount > 0);
    if (animate && changed && activeCount > 0) popHeart(el.videoFiltersBadge);
  }
  function closeVideoFiltersPopover() {
    el.videoFiltersPopover.hidden = true;
    el.videoFiltersToggle.setAttribute("aria-expanded", "false");
  }
  el.videoFiltersToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el.videoFiltersPopover.hidden;
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    el.videoFiltersPopover.hidden = !willOpen;
    el.videoFiltersToggle.setAttribute("aria-expanded", String(willOpen));
  });

  // ---------- URL query param (?q=&mode=icons) ----------
  function updateUrlQuery(q) {
    try {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      if (state.mode !== "photos") url.searchParams.set("mode", state.mode);
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
    const signal = abortCurrentSearch(); // отменяет fetch'и предыдущего поиска (все источники, перевод, спеллчекер)
    state.view = "search";
    exitSelectMode();
    state.query = raw;
    addToHistory(raw);
    recordSearch();
    updateUrlQuery(raw);

    // Спеллчекер — только для обычного текста без наших операторов (-слово/"фраза"/ИЛИ).
    if (!opts.skipSpellcheck && !opts.forceOriginal && !/[-"]|\bOR\b/i.test(raw) && window.checkSpelling) {
      window.checkSpelling(raw, { signal }).then((suggestion) => {
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
      el.translatedHint.hidden = true;
      state.queryMatcher = window.buildQueryMatcher(parsed, new Map());
    } else {
      // Основной перевод и перевод терминов операторов (-слово/"фраза"/ИЛИ)
      // друг от друга не зависят — идут одним Promise.all, а не по очереди,
      // чтобы не ждать два похода к MyMemory подряд. Перевод — best-effort
      // с жёстким таймаутом: источники не запускаются, пока не готов итоговый
      // текст запроса, так что TRANSLATE_TIMEOUT_MS — верхняя граница
      // задержки перед стартом поиска, а не просто "подождать подольше". При
      // неудаче/таймауте используем оригинальный текст — как и раньше, сбой
      // перевода не ломает сам поиск.
      const operatorTerms = [...parsed.mustPhrases, ...parsed.mustNot, ...parsed.orGroups.flat()];
      const translateWithFallback = (text) => withTimeout(window.translateQuery(text, { signal }), TRANSLATE_TIMEOUT_MS)
        .catch(() => ({ translated: text, original: text, wasTranslated: false }));
      const [result, translatedTermsEntries] = await Promise.all([
        translateWithFallback(parsed.apiQuery),
        Promise.all(operatorTerms.map(async (term) => {
          const r = await translateWithFallback(term);
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

      state.queryMatcher = window.buildQueryMatcher(parsed, new Map(translatedTermsEntries));
    }

    if (myGeneration !== searchGeneration) return; // отменено более новым поиском, пока мы переводили

    state.items = [];
    state.pages = {};
    state.hasMore = {};
    state.dedupeHashes = [];
    state.seenUrls = new Set();
    masonryObserver.disconnect();
    clearImageLoadQueue();
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
    runSearchForMode({ forceOriginal: true });
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
    abortCurrentSearch(); // и его fetch'и — не просто перестаём слушать ответ, а реально обрываем запрос
    state.query = "";
    state.searchQuery = "";
    state.items = [];
    updateUrlQuery("");
    el.translatedHint.hidden = true;
    el.spellHint.hidden = true;
    el.grid.hidden = true;
    masonryObserver.disconnect();
    clearImageLoadQueue();
    el.grid.innerHTML = "";
    el.loadMoreWrap.hidden = true;
    el.noResults.hidden = true;
    el.favoritesEmpty.hidden = true;
    el.emptyState.hidden = state.view === "favorites";
    el.resultsCount.textContent = "";
    el.providerWarnings.textContent = "";
    if (state.view === "favorites") renderFavoritesView();
  }

  // Источники, до которых не удалось достучаться (сеть оборвалась или
  // сервер-посредник не пустил ответ — браузер пишет лишь "Load failed"),
  // собираем в одну строку вместо одинаковой фразы на каждый.
  function formatWarnings(warnings, networkFailed) {
    const all = networkFailed.length
      ? [...warnings, I18N.t("warn_network_failed", { labels: networkFailed.join(", ") })]
      : warnings;
    return all.join("  ·  ");
  }

  // Настоящий CSS masonry (grid-template-rows: masonry) пока не везде
  // поддерживается, поэтому считаем высоту карточки в мелких строках грида
  // (шаг GRID_ROW_UNIT) сами — см. .grid/.card-skeleton в styles.css.
  // ResizeObserver сам пересчитывает span при любом изменении высоты:
  // догрузилась картинка, изменилась ширина колонки при ресайзе и т.п.
  const GRID_ROW_UNIT = 4;
  const GRID_GAP = 12;
  const masonryObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // Для карточек наблюдаем за <img>, а не за .card: у .card стоит
      // overflow:hidden, и её собственная рамка — это уже НАЗНАЧЕННАЯ грид-
      // строками высота (изначально 1 строка = 4px), а не то, сколько места
      // просит картинка — так и получался порочный круг "высота 4px, значит
      // и оставим 4px". У <img> же реальная высота считается независимо
      // (через aspect-ratio), поэтому измеряем её и назначаем span карточке.
      const target = entry.target.tagName === "IMG" ? entry.target.closest(".card") : entry.target;
      if (!target) continue;
      // Округляем ВНИЗ: карточка выходит на 0–11 px короче картинки и чуть
      // подрезает её низ (overflow:hidden). С округлением вверх было
      // наоборот — под фото оставалась полоска фона карточки, будто фото
      // съехало. Скелетоны (у них своя явная высота) — по-прежнему вверх,
      // чтобы не залезали на соседа снизу.
      const round = entry.target.tagName === "IMG" ? Math.floor : Math.ceil;
      const span = round((entry.contentRect.height + GRID_GAP) / (GRID_ROW_UNIT + GRID_GAP));
      target.style.gridRowEnd = `span ${Math.max(span, 1)}`;
    }
  });

  function renderSkeletons(count) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "card-skeleton";
      s.style.height = `${180 + Math.round(Math.random() * 140)}px`;
      s.dataset.skeleton = "1";
      el.grid.appendChild(s);
      masonryObserver.observe(s);
    }
  }
  function clearSkeletons() {
    el.grid.querySelectorAll('[data-skeleton="1"]').forEach((s) => s.remove());
  }

  // Единый слой ранжирования — определяет порядок карточек внутри страницы,
  // которая собирается по мере ответов источников (см. loadPage), а не то,
  // какой источник просто ответил раньше остальных. Веса — обычные const,
  // чтобы баланс было легко подправить, не переписывая саму логику.
  const RANK_WEIGHTS = {
    relevance: 3, // доля слов запроса, встретившихся в title/description/tags
    hasText: 1, // есть непустые title или description
    resolution: 2, // чем крупнее фото, тем выше (логарифмическая шкала)
    source: 1.5, // эвристический вес источника, см. SOURCE_WEIGHTS
  };
  function scoreItem(item, queryTerms) {
    let score = 0;
    if (queryTerms.length) {
      const haystack = [item.title, item.description, ...(item.tags || [])].filter(Boolean).join(" ").toLowerCase();
      const hits = queryTerms.filter((t) => haystack.includes(t)).length;
      score += RANK_WEIGHTS.relevance * (hits / queryTerms.length);
    }
    if (item.title || item.description) score += RANK_WEIGHTS.hasText;
    const maxDim = Math.max(item.width || 0, item.height || 0);
    if (maxDim > 0) score += RANK_WEIGHTS.resolution * Math.min(1, Math.log10(maxDim) / 4);
    score += RANK_WEIGHTS.source * ((SOURCE_WEIGHTS[item.provider] ?? 1) - 1);
    return score;
  }

  function isNearViewport(elm, margin = 800) {
    const rect = elm.getBoundingClientRect();
    return rect.top < (window.innerHeight || document.documentElement.clientHeight) + margin;
  }

  // ---------- Прогрессивная загрузка страницы ----------
  // Каждый источник ищет независимо: как только он ответил (успехом,
  // ошибкой или не уложился в PROVIDER_TIMEOUT_MS), его карточки сразу
  // вставляются в ленту по рангу (см. scoreItem), не дожидаясь остальных.
  // Один зависший/упавший источник никогда не блокирует ни отрисовку, ни
  // остальные источники, ни переход к следующей странице.
  async function loadPage(isFirst, generation = searchGeneration, autoDepth = 0) {
    if (state.loading) return;
    state.loading = true;
    el.loadMoreBtn.disabled = true;
    el.loadMoreBtn.textContent = I18N.t("loading");

    const signal = state.abortController?.signal;
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
    const networkFailed = []; // источники, до которых не достучались (сеть/CORS)

    function finishLoading() {
      state.loading = false;
      el.loadMoreBtn.disabled = false;
      el.loadMoreBtn.textContent = I18N.t("load_more");
    }

    if (activeProviders.length === 0) {
      if (isFirst) {
        clearSkeletons();
        if (state.items.length === 0) {
          el.grid.hidden = true;
          el.loadMoreWrap.hidden = true;
          el.noResults.hidden = false;
        }
      }
      el.providerWarnings.textContent = warnings.join("  ·  ");
      finishLoading();
      return;
    }

    const queryTerms = (state.searchQuery || "").toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    const hadItemsBefore = state.items.length > 0;
    const pageStartIndex = state.items.length;
    const pageLiveItems = []; // [{item, score}] — отсортирован по score убыв., зеркалит DOM-порядок этой страницы
    const totals = {};
    let skeletonsCleared = !isFirst;
    let settledCount = 0;

    // Вставляет новые элементы в pageLiveItems по рангу, а в DOM — точечно
    // (insertBefore), не перестраивая уже показанные карточки этой страницы
    // целиком: иначе на каждый ответ источника пришлось бы заново создавать
    // (и заново грузить превью) все карточки страницы с нуля. Пока источники
    // ещё отвечают, пользователь мог уйти в "Избранное" — там сейчас другая
    // сетка (см. renderGridFromList), трогать #grid в этом случае нельзя;
    // state.items всё равно обновляем, чтобы при возврате в поиск всё было
    // на месте.
    function insertScored(scoredItems) {
      const isSearchView = state.view === "search";
      for (const scored of scoredItems) {
        let idx = pageLiveItems.length;
        while (idx > 0 && pageLiveItems[idx - 1].score < scored.score) idx--;
        pageLiveItems.splice(idx, 0, scored);
        if (isSearchView) {
          const refNode = el.grid.children[pageStartIndex + idx] || null;
          el.grid.insertBefore(buildCard(scored.item), refNode);
        }
      }
      state.items = state.items.slice(0, pageStartIndex).concat(pageLiveItems.map((x) => x.item));
    }

    function handleProviderResult(p, page, items, total) {
      state.pages[p.id] = page;
      state.hasMore[p.id] = items.length > 0;
      totals[p.id] = total;

      // Дедуп уровня 1 — дёшево, синхронно, без сети: точное совпадение
      // ссылки на файл. Только то, что прошло его, идёт дальше на рендер;
      // perceptual hash (уровень 2) запускается позже, в фоне, см. ниже.
      let filtered = window.dedupeByUrl ? window.dedupeByUrl(items, state.seenUrls) : items;
      const minPx = QUALITY_THRESHOLDS[state.quality] || 0;
      if (minPx > 0) filtered = filtered.filter((it) => Math.max(it.width || 0, it.height || 0) >= minPx);
      if (state.people !== "any" && window.matchesPeopleFilter) {
        filtered = filtered.filter((it) => window.matchesPeopleFilter(it, state.people));
      }
      if (state.queryMatcher) filtered = filtered.filter(state.queryMatcher);
      if (filtered.length === 0) return;

      if (isFirst && !skeletonsCleared) { clearSkeletons(); skeletonsCleared = true; }
      el.noResults.hidden = true;
      insertScored(filtered.map((item) => ({ item, score: scoreItem(item, queryTerms) })));
    }

    function finalizeIfDone() {
      if (settledCount < activeProviders.length) return; // ждём остальных
      // Это поколение уже отменено новым поиском (см. abortCurrentSearch) —
      // ему нечего дописывать: state.loading/кнопку уже сбросил новый поиск,
      // а трогать resultsCount/warnings/сетку задним числом значило бы
      // затереть то, что показывает уже АКТУАЛЬНый поиск.
      if (generation !== searchGeneration) return;
      // Как и в insertScored — страница могла доехать до конца уже после
      // того, как пользователь ушёл в "Избранное"; счётчики/кнопки/пустое
      // состояние ленты поиска в этом случае трогать нельзя, это не то,
      // что сейчас видно.
      const isSearchView = state.view === "search";
      if (isFirst && !skeletonsCleared) { clearSkeletons(); skeletonsCleared = true; }

      if (isSearchView) {
        if (pageLiveItems.length === 0 && !hadItemsBefore) {
          el.grid.hidden = true;
          el.loadMoreWrap.hidden = true;
          el.noResults.hidden = false;
        } else {
          el.noResults.hidden = true;
          const anyMore = activeProviders.some((p) => state.hasMore[p.id]);
          el.loadMoreWrap.hidden = !anyMore;
        }
        if (isFirst) {
          const knownTotals = Object.values(totals).filter((t) => typeof t === "number");
          const sum = knownTotals.reduce((a, b) => a + b, 0);
          const n = sum > 0 ? sum.toLocaleString(I18N.t("locale")) : state.items.length;
          el.resultsCount.textContent = state.items.length ? I18N.t("results_found", { n }) : "";
        }
        el.providerWarnings.textContent = formatWarnings(warnings, networkFailed);
      }
      finishLoading();

      // Дедупликация уровня 2 (perceptual hash) качает байты каждого
      // превью — запускаем в фоне уже после того, как страница показана,
      // а не до, иначе первая карточка появлялась бы заметно позже.
      if (window.dedupeItems && pageLiveItems.length > 0) {
        removeDuplicatesInBackground(pageLiveItems.map((x) => x.item), generation);
      }

      // IntersectionObserver вызывает колбэк только при ИЗМЕНЕНИИ пересечения,
      // а не пока оно просто остаётся истинным. Если новая страница добавила
      // мало карточек (агрессивный дедуп/фильтры) и лента выросла недостаточно,
      // кнопка "Показать ещё" как была в зоне наблюдателя, так и осталась —
      // обсервер молчит, и бесконечный скролл выглядит "заглохшим", хотя грузить
      // ещё есть что. Поэтому после каждой загрузки сами перепроверяем
      // геометрию и, если сентинел всё ещё рядом с экраном, продолжаем без
      // ожидания нового события скролла. autoDepth ограничивает такие
      // самозапуски тремя подряд (сбрасывается любым настоящим кликом/скроллом)
      // — иначе на очень высоком экране с огромной выдачей это могло бы само
      // без остановки съедать лимиты API, гоняясь за постоянно "видимым" низом.
      if (isSearchView && !el.loadMoreWrap.hidden && autoDepth < 3 && isNearViewport(el.loadMoreWrap)) {
        loadPage(false, generation, autoDepth + 1);
      }
    }

    activeProviders.forEach((p) => {
      const page = (state.pages[p.id] || 0) + 1;
      let settled = false;
      const finishOnce = () => {
        if (settled) return;
        settled = true;
        settledCount++;
        finalizeIfDone();
      };

      p.search(state.searchQuery, {
        page, orientation: state.orientation, sort: state.sort, color: state.color, people: state.people, signal,
      }).then((result) => {
        if (settled) return; // уже посчитан как timeout — не задваиваем
        // generation !== searchGeneration: это поколение уже отменено новым
        // поиском — finishOnce() всё равно вызываем (иначе settledCount для
        // этой, уже заброшенной, страницы никогда не доберёт нужное число),
        // но сами результаты никуда не вставляем — finalizeIfDone() для
        // чужого поколения и так ничего не покажет, insertScored тут просто
        // лишняя работа.
        if (generation === searchGeneration) {
          if (p.id === "unsplash") logUnsplashRequest();
          handleProviderResult(p, page, result.items || [], result.total ?? null);
        }
        finishOnce();
      }).catch((err) => {
        if (settled) return; // уже посчитан как timeout — не задваиваем предупреждение
        if (generation === searchGeneration && err.name !== "AbortError") {
          console.error(`[${p.label}]`, err);
          if (/HTTP 429/.test(err.message)) {
            state.cooldownUntil[p.id] = Date.now() + COOLDOWN_MS;
            warnings.push(I18N.t("warn_rate_limited", { label: p.label }));
          } else if (p.id === "unsplash" && /HTTP 403/.test(err.message)) {
            // Unsplash сообщает об исчерпанном часовом лимите ключа (общем на
            // всех посетителей) кодом 403, а не 429. Не долбим его на каждом
            // поиске, а ставим на паузу до следующей попытки.
            state.cooldownUntil[p.id] = Date.now() + UNSPLASH_FORBIDDEN_COOLDOWN_MS;
            warnings.push(I18N.t("warn_unsplash_forbidden"));
          } else if (SOURCE_BROKEN_RE.test(err.message)) {
            // Сырой текст ответа (JSON с переносами строк) посетителю ничего
            // не скажет — он остаётся в консоли выше, а на экран короткая фраза.
            state.cooldownUntil[p.id] = Date.now() + SOURCE_BROKEN_COOLDOWN_MS;
            warnings.push(I18N.t("warn_source_unavailable", { label: p.label }));
          } else if (err.isNetwork) {
            networkFailed.push(p.label);
          } else {
            warnings.push(I18N.t("warn_with_message", { label: p.label, message: err.message || I18N.t("warn_generic_error") }));
          }
          state.hasMore[p.id] = false;
        }
        finishOnce();
      });

      // Таймаут не отменяет сам запрос (вдруг он всё же ответит — тогда
      // сработает settled-заслон выше и результат тихо проигнорируется), а
      // лишь не даёт одному зависшему источнику держать открытой "загрузку"
      // страницы для всех остальных. hasMore для него не трогаем — это не
      // "у источника больше нет результатов", а просто "не успел в этот раз",
      // следующий клик "Показать ещё" даст ему ещё один шанс на той же странице.
      setTimeout(() => {
        if (settled) return;
        if (generation === searchGeneration) {
          warnings.push(I18N.t("warn_with_message", { label: p.label, message: I18N.t("warn_timeout") }));
        }
        finishOnce();
      }, PROVIDER_TIMEOUT_MS);
    });
  }

  // Считает хеши уже показанных карточек и убирает из ленты те, что
  // оказались дублями (между разными стоками) — асинхронно, не блокируя
  // основной рендер (см. вызов в loadPage). Карточка на экране могла успеть
  // прокрутиться за это время — просто снимаем её из DOM и из state.items.
  async function removeDuplicatesInBackground(batch, generation) {
    let kept, hashes;
    try {
      ({ kept, hashes } = await window.dedupeItems(batch, state.dedupeHashes));
    } catch (err) {
      console.warn("Фоновая дедупликация не удалась:", err);
      return;
    }
    if (generation !== searchGeneration) return; // поиск уже сменился — наш результат не нужен
    state.dedupeHashes.push(...hashes);
    if (kept.length === batch.length) return; // дублей не нашлось

    const keptSet = new Set(kept);
    const removed = batch.filter((it) => !keptSet.has(it));
    if (removed.length === 0) return;
    const removedIds = new Set(removed.map((it) => it.id));
    state.items = state.items.filter((it) => !removedIds.has(it.id));
    // Пока считали хеши, пользователь мог уйти в "Избранное" — там сейчас
    // другой набор карточек (может включать те же id, если фото уже
    // избранное), трогать DOM в этом случае нельзя.
    if (state.view !== "search") return;
    removed.forEach((it) => {
      const card = el.grid.querySelector(`.card[data-id="${cssEscape(it.id)}"]`);
      if (!card) return;
      const img = card.querySelector("img");
      if (img) masonryObserver.unobserve(img);
      card.remove();
    });
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
    await startIconResultsLoad(myGeneration);
  }

  // Общий хвост запуска поиска иконок — используется и при обычном поиске
  // (после перевода запроса), и при смене фильтров стиля/наборов иконок,
  // когда переводить/добавлять в историю заново не нужно, а вот сбросить
  // сетку и перезапросить текущий (уже переведённый) запрос — нужно.
  async function startIconResultsLoad(generation) {
    state.iconItems = [];
    state.iconPage = 0;
    state.iconHasMore = false;
    el.iconGrid.innerHTML = "";
    el.iconGrid.hidden = false;
    el.emptyState.hidden = true;
    el.iconNoResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderIconSkeletons(18);
    await loadIconPage(true, generation);
  }

  // Смена фильтра стиля/наборов иконок посреди уже открытого поиска: не
  // трогаем историю/URL/перевод — просто отменяем текущую страницу (новое
  // поколение) и грузим первую страницу заново с новыми фильтрами.
  function rerunIconSearchWithFilters() {
    if (!state.iconSearchQuery) return; // ещё ничего не искали — фильтр применится при следующем поиске
    const myGeneration = ++iconSearchGeneration;
    startIconResultsLoad(myGeneration);
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
    const prefixes = Array.from(state.activeIconSources);
    let items = [];
    let total = null;
    try {
      const r = await window.IconSearch.search(state.iconSearchQuery, { page, prefixes, palette: state.iconStyle });
      items = r.items;
      total = r.total;
      // Сервер мог не поддержать/проигнорировать prefixes — фильтруем и на
      // клиенте, это единственная гарантия (см. комментарий в icons.js).
      if (prefixes.length) {
        const wanted = state.activeIconSources;
        items = items.filter((it) => wanted.has(it.prefix));
      }
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
    let renderable = items.filter((it) => window.IconSearch.getIconBody(it.prefix, it.name));

    // Фильтр "стиль" (одноцветные/цветные) — по метаданным набора (palette),
    // которые могли ещё не подгрузиться для совсем новых наборов; в этом
    // случае иконку не прячем (лучше лишняя, чем ложно пустая выдача).
    if (state.iconStyle !== "any" && renderable.length) {
      const distinctPrefixes = Array.from(new Set(renderable.map((it) => it.prefix)));
      await window.IconSearch.ensureCollectionsInfo(distinctPrefixes);
      if (generation !== iconSearchGeneration) {
        state.iconLoading = false;
        el.iconLoadMoreBtn.disabled = false;
        el.iconLoadMoreBtn.textContent = I18N.t("load_more");
        return;
      }
      renderable = renderable.filter((it) => {
        const info = window.IconSearch.getCollectionInfo(it.prefix);
        if (!info) return true;
        const isColor = !!info.palette;
        return state.iconStyle === "color" ? isColor : !isColor;
      });
    }

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

  // ---------- Video search (см. js/videoProviders.js) ----------
  // По архитектуре — уменьшенная копия фото-пайплайна (loadPage выше):
  // несколько независимых источников, прогрессивный рендер по мере ответа
  // каждого, тот же общий AbortController/scoreItem-ранжирование и дедуп
  // уровня 1 (по URL). Чего нет специально: операторов запроса, спеллчекера,
  // фильтров качества/цвета/людей (для видео это не осмысленно), избранного
  // и множественного выбора/ZIP — как и у иконок, второй по значимости
  // режим сознательно проще первого.
  let videoSearchGeneration = 0;
  async function runVideoSearch(opts = {}) {
    const raw = el.input.value.trim();
    if (!raw) { resetVideoToEmpty(); return; }
    const myGeneration = ++videoSearchGeneration;
    // Как и у фото (runSearch) — отменяем предыдущий поиск СРАЗУ, а не после
    // перевода, чтобы его сетевые запросы (включая сам перевод) не тянулись
    // впустую, и чтобы videoLoading гарантированно снялся немедленно, а не
    // только когда домотает перевод НОВОГО поиска.
    const signal = abortCurrentSearch();
    exitSelectMode();
    state.videoQuery = raw;
    addToHistory(raw);
    recordSearch();
    updateUrlQuery(raw);
    el.spellHint.hidden = true;

    if (opts.forceOriginal) {
      state.videoSearchQuery = raw;
      el.translatedHint.hidden = true;
    } else {
      const result = await window.translateQuery(raw, { signal });
      state.videoSearchQuery = result.translated;
      if (result.wasTranslated) {
        el.translatedHintText.textContent = result.translated;
        el.translatedHint.hidden = false;
      } else {
        el.translatedHint.hidden = true;
      }
    }

    if (myGeneration !== videoSearchGeneration) return; // отменено более новым поиском
    await startVideoResultsLoad(myGeneration);
  }

  async function startVideoResultsLoad(generation) {
    state.videoItems = [];
    state.videoPages = {};
    state.videoHasMore = {};
    state.videoSeenUrls = new Set();
    el.videoGrid.innerHTML = "";
    el.videoGrid.hidden = false;
    el.emptyState.hidden = true;
    el.videoNoResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderVideoSkeletons(12);
    await loadVideoPage(true, generation);
  }

  function rerunVideoSearchWithFilters() {
    if (!state.videoSearchQuery) return;
    videoSearchGeneration++;
    abortCurrentSearch();
    startVideoResultsLoad(videoSearchGeneration);
  }

  function renderVideoSkeletons(count) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "card-skeleton video-card";
      s.dataset.skeleton = "1";
      el.videoGrid.appendChild(s);
    }
  }
  function clearVideoSkeletons() {
    el.videoGrid.querySelectorAll('[data-skeleton="1"]').forEach((s) => s.remove());
  }

  async function loadVideoPage(isFirst, generation = videoSearchGeneration, autoDepth = 0) {
    if (state.videoLoading) return;
    state.videoLoading = true;
    el.videoLoadMoreBtn.disabled = true;
    el.videoLoadMoreBtn.textContent = I18N.t("loading");

    const signal = state.abortController?.signal;
    const now = Date.now();
    const activeProviders = (window.VIDEO_PROVIDERS || []).filter(
      (p) => state.activeVideoSources.has(p.id) && p.enabled() && !(state.videoCooldownUntil[p.id] > now)
    );
    const skippedForCooldown = (window.VIDEO_PROVIDERS || []).filter(
      (p) => state.activeVideoSources.has(p.id) && p.enabled() && state.videoCooldownUntil[p.id] > now
    );
    const warnings = skippedForCooldown.map((p) => {
      const mins = Math.max(1, Math.round((state.videoCooldownUntil[p.id] - now) / 60000));
      return I18N.t("warn_cooldown", { label: p.label, mins });
    });
    const networkFailed = [];

    function finishLoading() {
      state.videoLoading = false;
      el.videoLoadMoreBtn.disabled = false;
      el.videoLoadMoreBtn.textContent = I18N.t("load_more");
    }

    if (activeProviders.length === 0) {
      if (isFirst) {
        clearVideoSkeletons();
        if (state.videoItems.length === 0) {
          el.videoGrid.hidden = true;
          el.videoLoadMoreWrap.hidden = true;
          el.videoNoResults.hidden = false;
        }
      }
      el.providerWarnings.textContent = warnings.join("  ·  ");
      finishLoading();
      return;
    }

    const queryTerms = (state.videoSearchQuery || "").toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    const hadItemsBefore = state.videoItems.length > 0;
    const pageStartIndex = state.videoItems.length;
    const pageLiveItems = [];
    const totals = {};
    let skeletonsCleared = !isFirst;
    let settledCount = 0;

    function insertScored(scoredItems) {
      for (const scored of scoredItems) {
        let idx = pageLiveItems.length;
        while (idx > 0 && pageLiveItems[idx - 1].score < scored.score) idx--;
        pageLiveItems.splice(idx, 0, scored);
        const refNode = el.videoGrid.children[pageStartIndex + idx] || null;
        el.videoGrid.insertBefore(buildVideoCard(scored.item), refNode);
      }
      state.videoItems = state.videoItems.slice(0, pageStartIndex).concat(pageLiveItems.map((x) => x.item));
    }

    function handleProviderResult(p, page, items, total) {
      state.videoPages[p.id] = page;
      state.videoHasMore[p.id] = items.length > 0;
      totals[p.id] = total;

      const filtered = window.dedupeByUrl ? window.dedupeByUrl(items, state.videoSeenUrls) : items;
      if (filtered.length === 0) return;

      if (isFirst && !skeletonsCleared) { clearVideoSkeletons(); skeletonsCleared = true; }
      el.videoNoResults.hidden = true;
      insertScored(filtered.map((item) => ({ item, score: scoreItem(item, queryTerms) })));
    }

    function finalizeIfDone() {
      if (settledCount < activeProviders.length) return;
      if (generation !== videoSearchGeneration) return;
      if (isFirst && !skeletonsCleared) { clearVideoSkeletons(); skeletonsCleared = true; }

      if (pageLiveItems.length === 0 && !hadItemsBefore) {
        el.videoGrid.hidden = true;
        el.videoLoadMoreWrap.hidden = true;
        el.videoNoResults.hidden = false;
      } else {
        el.videoNoResults.hidden = true;
        const anyMore = activeProviders.some((p) => state.videoHasMore[p.id]);
        el.videoLoadMoreWrap.hidden = !anyMore;
      }
      if (isFirst) {
        const knownTotals = Object.values(totals).filter((t) => typeof t === "number");
        const sum = knownTotals.reduce((a, b) => a + b, 0);
        const n = sum > 0 ? sum.toLocaleString(I18N.t("locale")) : state.videoItems.length;
        el.resultsCount.textContent = state.videoItems.length ? I18N.t("results_videos_found", { n }) : "";
      }
      el.providerWarnings.textContent = formatWarnings(warnings, networkFailed);
      finishLoading();

      if (!el.videoLoadMoreWrap.hidden && autoDepth < 3 && isNearViewport(el.videoLoadMoreWrap)) {
        loadVideoPage(false, generation, autoDepth + 1);
      }
    }

    activeProviders.forEach((p) => {
      const page = (state.videoPages[p.id] || 0) + 1;
      let settled = false;
      const finishOnce = () => {
        if (settled) return;
        settled = true;
        settledCount++;
        finalizeIfDone();
      };

      p.search(state.videoSearchQuery, { page, orientation: state.videoOrientation, sort: state.videoSort, signal })
        .then((result) => {
          if (settled) return;
          if (generation === videoSearchGeneration) {
            handleProviderResult(p, page, result.items || [], result.total ?? null);
          }
          finishOnce();
        }).catch((err) => {
          if (settled) return;
          if (generation === videoSearchGeneration && err.name !== "AbortError") {
            console.error(`[${p.label}]`, err);
            if (/HTTP 429/.test(err.message)) {
              state.videoCooldownUntil[p.id] = Date.now() + COOLDOWN_MS;
              warnings.push(I18N.t("warn_rate_limited", { label: p.label }));
            } else if (SOURCE_BROKEN_RE.test(err.message)) {
              state.videoCooldownUntil[p.id] = Date.now() + SOURCE_BROKEN_COOLDOWN_MS;
              warnings.push(I18N.t("warn_source_unavailable", { label: p.label }));
            } else if (err.isNetwork) {
              networkFailed.push(p.label);
            } else {
              warnings.push(I18N.t("warn_with_message", { label: p.label, message: err.message || I18N.t("warn_generic_error") }));
            }
            state.videoHasMore[p.id] = false;
          }
          finishOnce();
        });

      setTimeout(() => {
        if (settled) return;
        if (generation === videoSearchGeneration) {
          warnings.push(I18N.t("warn_with_message", { label: p.label, message: I18N.t("warn_timeout") }));
        }
        finishOnce();
      }, PROVIDER_TIMEOUT_MS);
    });
  }

  function resetVideoToEmpty() {
    videoSearchGeneration++;
    abortCurrentSearch();
    state.videoQuery = "";
    state.videoSearchQuery = "";
    state.videoItems = [];
    updateUrlQuery("");
    el.translatedHint.hidden = true;
    el.videoGrid.hidden = true;
    el.videoGrid.innerHTML = "";
    el.videoLoadMoreWrap.hidden = true;
    el.videoNoResults.hidden = true;
    el.resultsCount.textContent = "";
    el.providerWarnings.textContent = "";
    el.emptyState.hidden = false;
  }

  el.videoLoadMoreBtn.addEventListener("click", () => loadVideoPage(false));
  const videoInfiniteScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.videoLoading && !el.videoLoadMoreWrap.hidden) {
      loadVideoPage(false);
    }
  }, { rootMargin: "800px" });
  videoInfiniteScrollObserver.observe(el.videoLoadMoreWrap);

  function formatDuration(sec) {
    if (!sec || !isFinite(sec) || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function appendVideoCards(items) {
    const frag = document.createDocumentFragment();
    items.forEach((item) => frag.appendChild(buildVideoCard(item)));
    el.videoGrid.appendChild(frag);
  }

  function buildVideoCard(item) {
    const card = document.createElement("div");
    card.className = "card video-card is-img-loading";
    card.dataset.id = item.id;

    const img = document.createElement("img");
    img.alt = item.title || "";
    img.loading = "lazy";
    img.decoding = "async";
    const stopLoading = () => card.classList.remove("is-img-loading");
    img.addEventListener("load", stopLoading, { once: true });
    img.addEventListener("error", stopLoading, { once: true });
    img.src = item.thumb;
    card.appendChild(img);

    const play = document.createElement("span");
    play.className = "video-card-play";
    play.setAttribute("aria-hidden", "true");
    card.appendChild(play);

    const dur = formatDuration(item.duration);
    if (dur) {
      const durBadge = document.createElement("span");
      durBadge.className = "video-card-duration";
      durBadge.textContent = dur;
      card.appendChild(durBadge);
    }

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";
    const badgesWrap = document.createElement("div");
    badgesWrap.className = "card-badges";
    const badge = document.createElement("span");
    badge.className = "card-source-badge";
    badge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    badgesWrap.appendChild(badge);
    overlay.appendChild(badgesWrap);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "card-actions-bottom";
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

    card.addEventListener("click", () => openVideoLightbox(state.videoItems.indexOf(item)));
    return card;
  }

  // ---------- Video lightbox ----------
  function openVideoLightbox(index) {
    state.videoLightboxIndex = index;
    renderVideoLightbox();
    el.videoLightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeVideoLightbox() {
    el.videoLightbox.hidden = true;
    el.vlPlayer.pause();
    el.vlPlayer.removeAttribute("src");
    el.vlPlayer.load();
    document.body.style.overflow = "";
  }
  function renderVideoLightbox() {
    const item = state.videoItems[state.videoLightboxIndex];
    if (!item) return;

    el.vlPlayer.poster = item.thumb || "";
    el.vlPlayer.src = item.videoUrl;

    el.vlSourceBadge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    const dur = formatDuration(item.duration);
    el.vlDurationBadge.hidden = !dur;
    el.vlDurationBadge.textContent = dur || "";
    el.vlTitle.textContent = item.title || I18N.t("lightbox_untitled");
    el.vlDescription.textContent = item.description && item.description !== item.title ? item.description : "";
    el.vlDescription.hidden = !el.vlDescription.textContent;

    renderLicenseBadge(el.vlLicense, item.license);

    el.vlTags.innerHTML = "";
    (item.tags || []).slice(0, 8).forEach((tag) => {
      const t = document.createElement("span");
      t.className = "lightbox-tag";
      t.textContent = tag;
      el.vlTags.appendChild(t);
    });

    el.vlAuthor.textContent = item.author ? `${I18N.t("lightbox_author_prefix")} ${item.author}` : "";
    el.vlAuthor.href = item.authorUrl || "#";
    el.vlAuthor.style.visibility = item.author ? "visible" : "hidden";
    el.vlSourceLink.href = item.pageUrl || "#";

    el.vlPrev.disabled = state.videoLightboxIndex <= 0;
    el.vlNext.disabled = state.videoLightboxIndex >= state.videoItems.length - 1;
  }
  document.querySelectorAll("[data-video-close]").forEach((n) => n.addEventListener("click", closeVideoLightbox));
  el.vlPrev.addEventListener("click", () => {
    if (state.videoLightboxIndex > 0) { state.videoLightboxIndex--; renderVideoLightbox(); }
  });
  el.vlNext.addEventListener("click", () => {
    if (state.videoLightboxIndex < state.videoItems.length - 1) { state.videoLightboxIndex++; renderVideoLightbox(); }
  });
  document.addEventListener("keydown", (e) => {
    if (el.videoLightbox.hidden) return;
    if (e.key === "Escape") closeVideoLightbox();
    else if (e.key === "ArrowLeft") el.vlPrev.click();
    else if (e.key === "ArrowRight") el.vlNext.click();
  });
  el.vlCopy.addEventListener("click", async () => {
    const item = state.videoItems[state.videoLightboxIndex];
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.videoUrl);
      showToast(I18N.t("toast_link_copied"));
    } catch {
      showToast(I18N.t("toast_copy_failed"));
    }
  });
  el.vlDownload.addEventListener("click", () => {
    const item = state.videoItems[state.videoLightboxIndex];
    if (item) downloadItem(item);
  });

  // ---------- Favorites ----------
  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      raw.forEach((item) => state.favorites.set(item.id, item));
    } catch { /* битые данные — начинаем с пустого списка */ }
    updateFavoritesCount();
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
    updateFavoritesCount();
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
    closeTopbarPopovers();
    // Сохранённые — это фото: из режимов «Иконки»/«Видео» сначала
    // переключаемся на фото.
    if (state.mode !== "photos") setMode("photos");
    const goingToFavorites = state.view !== "favorites";
    state.view = goingToFavorites ? "favorites" : "search";
    el.favoritesToggle.setAttribute("aria-pressed", String(goingToFavorites));
    exitSelectMode();
    if (goingToFavorites) {
      renderFavoritesView();
    } else {
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
      masonryObserver.disconnect();
      clearImageLoadQueue();
      el.grid.innerHTML = "";
      return;
    }
    el.favoritesEmpty.hidden = true;
    el.emptyState.hidden = true;
    el.grid.hidden = false;
    renderGridFromList(state.favoritesList);
  }

  function renderGridFromList(list) {
    masonryObserver.disconnect();
    clearImageLoadQueue();
    el.grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildCard(item)));
    el.grid.appendChild(frag);
  }

  // ---------- Card rendering ----------
  // Превью начинает грузиться, только когда карточка подъезжает к экрану
  // (с запасом IMAGE_PRELOAD_MARGIN), и сразу — без общей очереди со
  // счётчиком слотов. Прежняя очередь (3 одновременно) заклинивало: превью,
  // удалённое со страницы посреди загрузки (стёрли запрос / новый поиск),
  // не присылало ни load, ни error, его слот не освобождался, и через пару
  // прерванных поисков новые превью не грузились вовсе.
  const IMAGE_PRELOAD_MARGIN = "800px 0px";
  const imageObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        imageObserver.unobserve(entry.target);
        startImageLoad(entry.target);
      }
    }, { rootMargin: IMAGE_PRELOAD_MARGIN })
    : null;
  function startImageLoad(img) {
    const src = img.dataset.src;
    if (!src) return;
    delete img.dataset.src;
    img.src = src;
  }
  function queueImageLoad(img, src) {
    img.dataset.src = src;
    if (imageObserver) imageObserver.observe(img);
    else startImageLoad(img);
  }
  // Вызывается перед каждой очисткой сетки: снимает наблюдение и обрывает
  // ещё не догруженные превью, чтобы они не занимали канал у нового поиска.
  function clearImageLoadQueue() {
    el.grid.querySelectorAll(".card.is-img-loading img").forEach((img) => {
      imageObserver?.unobserve(img);
      if (img.getAttribute("src")) img.removeAttribute("src");
    });
  }

  function appendCards(items) {
    const frag = document.createDocumentFragment();
    items.forEach((item) => frag.appendChild(buildCard(item)));
    el.grid.appendChild(frag);
  }

  function buildCard(item) {
    const card = document.createElement("div");
    card.className = "card is-img-loading";
    // Не завязываемся на позицию в момент рендера — фоновая дедупликация
    // (см. loadPage) может позже убрать какие-то карточки, из-за чего
    // "застолблённый" при сборке числовой индекс у всех, что идут за ними,
    // стал бы неверным. Вместо этого ищем свежий индекс по клику.
    card.dataset.id = item.id;

    const img = document.createElement("img");
    img.alt = item.title || "";
    img.decoding = "async";
    if (item.width && item.height) {
      img.style.aspectRatio = `${item.width} / ${item.height}`;
    }
    masonryObserver.observe(img);
    const stopLoading = () => card.classList.remove("is-img-loading");
    img.addEventListener("load", stopLoading, { once: true });
    img.addEventListener("error", stopLoading, { once: true });
    queueImageLoad(img, item.thumb);
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

    const badgesWrap = document.createElement("div");
    badgesWrap.className = "card-badges";

    const badge = document.createElement("span");
    badge.className = "card-source-badge";
    badge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    badgesWrap.appendChild(badge);

    if (item.aiGenerated) {
      const aiBadge = document.createElement("span");
      aiBadge.className = "card-ai-badge";
      aiBadge.title = I18N.t("ai_generated_title");
      aiBadge.textContent = I18N.t("ai_generated_badge");
      badgesWrap.appendChild(aiBadge);
    }
    overlay.appendChild(badgesWrap);

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
      openLightbox(getActiveList().indexOf(item));
    });
    return card;
  }

  // ---------- Select mode / bulk zip download ----------
  el.selectModeToggle.addEventListener("click", () => {
    if (state.selectMode) exitSelectMode();
    else enterSelectMode();
  });
  function enterSelectMode() {
    loadJSZip();
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

  // JSZip (~28 КБ сжатого JS) нужен только для скачивания архивом — грузим
  // его по первому требованию, а не на каждом открытии сайта.
  const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  let jszipPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
      jszipPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = JSZIP_URL;
        s.onload = () => resolve(window.JSZip || null);
        s.onerror = () => { jszipPromise = null; resolve(null); };
        document.head.appendChild(s);
      });
    }
    return jszipPromise;
  }

  async function downloadSelectedAsZip() {
    const list = getActiveList();
    const items = list.filter((it) => state.selected.has(it.id));
    if (items.length === 0) return;

    el.bulkDownload.disabled = true;
    await loadJSZip();
    el.bulkDownload.disabled = false;
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
    // item.id всегда "<provider>-<originalId>" (см. providers.js) — режем
    // ровно префикс "provider-", а не берём последний "-"-сегмент: у
    // Doodl/Pexafy originalId сам содержит дефисы (UUID), split("-").pop()
    // обрезал бы его до последних 12 символов вместо полного идентификатора.
    // fileExt — только у видео (см. js/videoProviders.js), фото всегда .jpg.
    return `${item.provider}-${item.id.slice(item.provider.length + 1)}.${item.fileExt || "jpg"}`;
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
    targetEl.innerHTML = "";
    // license.name/license.url для Wikimedia/Openverse приходят из метаданных
    // файла, которые может отредактировать любой участник — строим DOM через
    // textContent/setAttribute, а не подстановкой в innerHTML, и пускаем в
    // href только http(s)-ссылки (иначе, например, javascript:-схема в
    // LicenseUrl была бы кликабельным XSS).
    const safeUrl = /^https?:\/\//i.test(license.url || "") ? license.url : null;
    if (safeUrl) {
      const a = document.createElement("a");
      a.href = safeUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = license.name;
      targetEl.appendChild(a);
    } else {
      targetEl.appendChild(document.createTextNode(license.name));
    }
    function addFlag(text, warn) {
      const span = document.createElement("span");
      span.className = warn ? "license-flag license-flag-warn" : "license-flag";
      span.textContent = text;
      targetEl.appendChild(span);
    }
    if (license.requiresPurchase) {
      addFlag(I18N.t("license_requires_purchase"), true);
    } else if (license.commercial === true) {
      addFlag(I18N.t("license_commercial_ok"), false);
    } else if (license.commercial === false) {
      addFlag(I18N.t("license_commercial_no"), true);
    }
    if (!license.requiresPurchase && license.attribution === true) {
      addFlag(I18N.t("license_attribution_required"), false);
    }
    if (!license.requiresPurchase && license.commercial === undefined && license.attribution === undefined) {
      addFlag(I18N.t("license_unknown"), true);
    }
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
    el.lbAiBadge.hidden = !item.aiGenerated;
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
  el.lbDownload.addEventListener("click", () => {
    const item = getActiveList()[state.lightboxIndex];
    if (item) downloadItem(item);
  });
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

  // ---------- Сохранённый режим (Фото/Иконки/Видео) ----------
  (function initSavedMode() {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* игнорируем */ }
    if (saved === "icons" || saved === "video") applyModeUI(saved);
  })();

  // ---------- Открытие по ссылке ?q=...&mode=icons|video ----------
  const initialParams = new URLSearchParams(location.search);
  const initialQuery = initialParams.get("q");
  const initialMode = initialParams.get("mode");
  if (initialMode === "icons" || initialMode === "video") applyModeUI(initialMode);
  updateHomeSourcesList();
  if (initialQuery) {
    el.input.value = initialQuery;
    el.clearBtn.hidden = false;
    runSearchForMode({ skipSpellcheck: true });
  }
})();
