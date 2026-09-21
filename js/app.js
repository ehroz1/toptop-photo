(function () {
  "use strict";

  const SUGGESTIONS = ["природа", "город ночью", "кофе", "океан", "горы", "космос", "еда", "животные"];
  const FAVORITES_KEY = "photoseek-favorites";
  const FILTERS_KEY = "photoseek-filters";
  const MAX_FAVORITES = 300;

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
    sources: document.getElementById("sources"),
    yandexBtn: document.getElementById("yandexBtn"),
    googleBtn: document.getElementById("googleBtn"),
    pinterestBtn: document.getElementById("pinterestBtn"),
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
    lbPrev: document.getElementById("lbPrev"),
    lbNext: document.getElementById("lbNext"),
  };

  const state = {
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

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem("photoseek-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }
  el.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("photoseek-theme", next);
  });

  // ---------- Sticky header on scroll ----------
  window.addEventListener("scroll", () => {
    el.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  }, { passive: true });

  // ---------- Suggestions ----------
  SUGGESTIONS.forEach((term) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = term;
    chip.addEventListener("click", () => {
      el.input.value = term;
      runSearch();
    });
    el.suggestions.appendChild(chip);
  });

  // ---------- Color filter: populate swatches ----------
  (window.COLOR_OPTIONS || []).forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-item color-swatch";
    btn.dataset.val = c.id;
    btn.title = c.label;
    btn.textContent = c.label;
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

  // ---------- Search input ----------
  let debounceTimer = null;
  el.input.addEventListener("input", () => {
    el.clearBtn.hidden = el.input.value.length === 0;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(), 550);
  });
  el.clearBtn.addEventListener("click", () => {
    el.input.value = "";
    el.clearBtn.hidden = true;
    el.input.focus();
    resetToEmpty();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    runSearch();
  });

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

  const EXTERNAL_SEARCH_URLS = {
    yandex: (q) => `https://yandex.ru/images/search?text=${encodeURIComponent(q)}`,
    google: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
    pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  };
  function openExternalSearch(engine) {
    const q = el.input.value.trim();
    if (!q) {
      showToast("Сначала введите запрос");
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
        if (state.query) runSearch({ keepTranslation: true });
      });
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
  });

  // ---------- Search orchestration ----------
  async function runSearch(opts = {}) {
    const q = el.input.value.trim();
    if (!q) {
      resetToEmpty();
      return;
    }
    state.view = "search";
    exitSelectMode();
    state.query = q;

    if (opts.keepTranslation && state.searchQuery && !opts.forceOriginal) {
      // фильтр поменяли на уже переведённом запросе — не переводим второй раз
    } else if (opts.forceOriginal) {
      state.searchQuery = q;
      el.translatedHint.hidden = true;
    } else {
      const result = await window.translateQuery(q);
      state.searchQuery = result.translated;
      if (result.wasTranslated) {
        el.translatedHintText.textContent = result.translated;
        el.translatedHint.hidden = false;
      } else {
        el.translatedHint.hidden = true;
      }
    }

    state.items = [];
    state.pages = {};
    state.hasMore = {};
    el.grid.innerHTML = "";
    el.grid.hidden = false;
    el.emptyState.hidden = true;
    el.favoritesEmpty.hidden = true;
    el.noResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderSkeletons(12);
    await loadPage(true);
  }

  el.translatedHintUndo.addEventListener("click", () => {
    runSearch({ forceOriginal: true });
  });

  function resetToEmpty() {
    state.query = "";
    state.searchQuery = "";
    state.items = [];
    el.translatedHint.hidden = true;
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

  async function loadPage(isFirst) {
    if (state.loading) return;
    state.loading = true;
    el.loadMoreBtn.disabled = true;
    el.loadMoreBtn.textContent = "Загрузка…";

    const activeProviders = window.PROVIDERS.filter(
      (p) => state.activeSources.has(p.id) && p.enabled()
    );
    const warnings = [];
    const totals = {};

    const results = await Promise.all(
      activeProviders.map(async (p) => {
        const page = (state.pages[p.id] || 0) + 1;
        try {
          const { items, total } = await p.search(state.searchQuery, {
            page,
            orientation: state.orientation,
            sort: state.sort,
            color: state.color,
            people: state.people,
          });
          state.pages[p.id] = page;
          state.hasMore[p.id] = items.length > 0;
          totals[p.id] = total;
          return items;
        } catch (err) {
          console.error(`[${p.label}]`, err);
          warnings.push(`${p.label}: ${err.message || "ошибка запроса"}`);
          state.hasMore[p.id] = false;
          return [];
        }
      })
    );

    let batch = interleave(results);
    if (state.quality === "hd") {
      batch = batch.filter((it) => Math.max(it.width || 0, it.height || 0) >= 1920);
    }
    if (state.people !== "any" && window.matchesPeopleFilter) {
      batch = batch.filter((it) => window.matchesPeopleFilter(it, state.people));
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
      el.resultsCount.textContent = state.items.length
        ? `Найдено фото: ${sum > 0 ? sum.toLocaleString("ru-RU") : state.items.length}`
        : "";
    }
    el.providerWarnings.textContent = warnings.join("  ·  ");

    state.loading = false;
    el.loadMoreBtn.disabled = false;
    el.loadMoreBtn.textContent = "Показать ещё";
  }

  function interleave(arrays) {
    const result = [];
    const max = Math.max(0, ...arrays.map((a) => a.length));
    for (let i = 0; i < max; i++) {
      for (const arr of arrays) {
        if (arr[i]) result.push(arr[i]);
      }
    }
    return result;
  }

  el.loadMoreBtn.addEventListener("click", () => loadPage(false));

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
    document.querySelectorAll(`.card-heart[data-id="${cssEscape(item.id)}"]`).forEach((btn) => {
      btn.classList.toggle("is-active", isFavorited(item.id));
    });
    if (state.lightboxIndex >= 0 && getActiveList()[state.lightboxIndex]?.id === item.id) {
      el.lbHeart.setAttribute("aria-pressed", String(isFavorited(item.id)));
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
      ? `В избранном: ${state.favoritesList.length}`
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
    card.className = "card";
    card.dataset.index = String(index);

    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = item.title || "";
    img.loading = "lazy";
    img.decoding = "async";
    if (item.width && item.height) {
      img.style.aspectRatio = `${item.width} / ${item.height}`;
    }
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
    heartBtn.title = "В избранное";
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
    dlBtn.title = "Скачать";
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
    el.bulkCount.textContent = `Выбрано: ${n}`;
  }
  el.bulkCancel.addEventListener("click", exitSelectMode);
  el.bulkDownload.addEventListener("click", downloadSelectedAsZip);

  async function downloadSelectedAsZip() {
    const list = getActiveList();
    const items = list.filter((it) => state.selected.has(it.id));
    if (items.length === 0) return;

    if (!window.JSZip) {
      showToast("Архиватор не загрузился — скачиваю по одному");
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
      showToast(`Архивирую ${i + 1} из ${items.length}…`);
      try {
        const url = await resolveDownloadUrl(item);
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error("network");
        // eslint-disable-next-line no-await-in-loop
        const blob = await res.blob();
        zip.file(filenameFor(item), blob);
        ok++;
      } catch (err) {
        console.warn("Пропущено при архивации:", item.id, err);
      }
    }
    if (ok === 0) {
      showToast("Не удалось скачать ни одного файла");
      el.bulkDownload.disabled = false;
      return;
    }
    showToast("Собираю архив…");
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const objectUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `photoseek-${items.length}-фото.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    showToast(`Готово: ${ok} из ${items.length}`);
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
    el.lbSourceBadge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    el.lbTitle.textContent = item.title || "Без названия";
    el.lbDescription.textContent = item.description && item.description !== item.title ? item.description : "";
    el.lbDescription.hidden = !el.lbDescription.textContent;

    el.lbTags.innerHTML = "";
    (item.tags || []).slice(0, 8).forEach((tag) => {
      const t = document.createElement("span");
      t.className = "lightbox-tag";
      t.textContent = tag;
      el.lbTags.appendChild(t);
    });

    el.lbAuthor.textContent = item.author ? `Автор: ${item.author}` : "";
    el.lbAuthor.href = item.authorUrl || "#";
    el.lbAuthor.style.visibility = item.author ? "visible" : "hidden";
    el.lbSourceLink.href = item.pageUrl || "#";

    const list = getActiveList();
    el.lbPrev.disabled = state.lightboxIndex <= 0;
    el.lbNext.disabled = state.lightboxIndex >= list.length - 1;
  }

  document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeLightbox));
  el.lbPrev.addEventListener("click", () => {
    if (state.lightboxIndex > 0) { state.lightboxIndex--; renderLightbox(); }
  });
  el.lbNext.addEventListener("click", () => {
    if (state.lightboxIndex < getActiveList().length - 1) { state.lightboxIndex++; renderLightbox(); }
  });
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
      showToast("Ссылка скопирована");
    } catch {
      showToast("Не удалось скопировать");
    }
  });

  el.lbCopyImage.addEventListener("click", async () => {
    const item = getActiveList()[state.lightboxIndex];
    if (!item) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      showToast("Браузер не поддерживает копирование картинок");
      return;
    }
    showToast("Копирую картинку…");
    try {
      const res = await fetch(item.full, { mode: "cors" });
      if (!res.ok) throw new Error("network");
      let blob = await res.blob();
      if (blob.type !== "image/png") blob = await blobToPng(blob);
      await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
      showToast("Картинка скопирована — вставьте Ctrl+V");
    } catch (err) {
      console.error(err);
      showToast("Не удалось скопировать картинку");
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
              await navigator.share({ files: [file], title: item.title || "Фото из PhotoSeek" });
              return;
            }
          } catch { /* не вышло файлом — делимся ссылкой */ }
        }
        await navigator.share({ title: item.title || "Фото", url: item.pageUrl || item.full });
      } catch (err) {
        if (err?.name !== "AbortError") console.warn("Share failed", err);
      }
    });
  }

  // ---------- Download ----------
  async function resolveDownloadUrl(item) {
    if (item.download.type === "unsplash" && item.download.locationUrl) {
      try {
        const res = await fetch(item.download.locationUrl, {
          headers: { Authorization: `Client-ID ${window.UNSPLASH_CONFIG.UNSPLASH_ACCESS_KEY}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) return data.url;
        }
      } catch { /* используем прямую ссылку как запасной вариант */ }
    }
    return item.download.url;
  }

  async function downloadItem(item) {
    showToast("Скачивание…");
    try {
      const url = await resolveDownloadUrl(item);
      await forceDownload(url, filenameFor(item));
      showToast("Готово!");
    } catch (err) {
      console.error(err);
      showToast("Открываю в новой вкладке…");
      window.open(item.full, "_blank", "noopener,noreferrer");
    }
  }

  async function forceDownload(url, filename) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("network");
    const blob = await res.blob();
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
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
    });
  }

  loadFavorites();
  initTheme();
})();
