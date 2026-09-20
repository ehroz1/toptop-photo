(function () {
  "use strict";

  const PER_PAGE_HINT = 24;
  const SUGGESTIONS = ["природа", "город ночью", "кофе", "океан", "горы", "космос", "еда", "животные"];

  const el = {
    form: document.getElementById("searchForm"),
    input: document.getElementById("searchInput"),
    clearBtn: document.getElementById("clearBtn"),
    themeToggle: document.getElementById("themeToggle"),
    sources: document.getElementById("sources"),
    yandexBtn: document.getElementById("yandexBtn"),
    googleBtn: document.getElementById("googleBtn"),
    pinterestBtn: document.getElementById("pinterestBtn"),
    resultsCount: document.getElementById("resultsCount"),
    providerWarnings: document.getElementById("providerWarnings"),
    emptyState: document.getElementById("emptyState"),
    suggestions: document.getElementById("suggestions"),
    grid: document.getElementById("grid"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    noResults: document.getElementById("noResults"),
    toast: document.getElementById("toast"),
    lightbox: document.getElementById("lightbox"),
    lbImage: document.getElementById("lbImage"),
    lbSpinner: document.getElementById("lbSpinner"),
    lbSourceBadge: document.getElementById("lbSourceBadge"),
    lbCopy: document.getElementById("lbCopy"),
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
    activeSources: new Set(),
    orientation: "any",
    sort: "popular",
    quality: "any",
    pages: {},
    hasMore: {},
    items: [],
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
      if (state.query) runSearch();
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

  // ---------- Dropdown filters ----------
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
        if (state.query) runSearch();
      });
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
  });

  // ---------- Search orchestration ----------
  async function runSearch() {
    const q = el.input.value.trim();
    state.query = q;
    if (!q) {
      resetToEmpty();
      return;
    }
    state.items = [];
    state.pages = {};
    state.hasMore = {};
    el.grid.innerHTML = "";
    el.grid.hidden = false;
    el.emptyState.hidden = true;
    el.noResults.hidden = true;
    el.providerWarnings.textContent = "";
    renderSkeletons(12);
    await loadPage(true);
  }

  function resetToEmpty() {
    state.query = "";
    state.items = [];
    el.grid.hidden = true;
    el.grid.innerHTML = "";
    el.loadMoreWrap.hidden = true;
    el.noResults.hidden = true;
    el.emptyState.hidden = false;
    el.resultsCount.textContent = "";
    el.providerWarnings.textContent = "";
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
          const { items, total } = await p.search(state.query, {
            page,
            orientation: state.orientation,
            sort: state.sort,
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

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const badge = document.createElement("span");
    badge.className = "card-source-badge";
    badge.innerHTML = `<span class="dot dot-${item.provider}"></span>${PROVIDER_LABELS[item.provider]}`;
    overlay.appendChild(badge);

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "card-download";
    dlBtn.title = "Скачать";
    dlBtn.innerHTML = '<span class="icon"></span>';
    dlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadItem(item);
    });
    overlay.appendChild(dlBtn);

    card.appendChild(overlay);
    card.addEventListener("click", () => openLightbox(index));
    return card;
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
    const item = state.items[state.lightboxIndex];
    if (!item) return;

    el.lbSpinner.hidden = false;
    el.lbImage.style.opacity = "0";
    el.lbImage.src = item.full;
    el.lbImage.alt = item.title || "";
    el.lbImage.onload = () => {
      el.lbSpinner.hidden = true;
      el.lbImage.style.opacity = "1";
    };

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

    el.lbPrev.disabled = state.lightboxIndex <= 0;
    el.lbNext.disabled = state.lightboxIndex >= state.items.length - 1;
  }

  document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeLightbox));
  el.lbPrev.addEventListener("click", () => {
    if (state.lightboxIndex > 0) { state.lightboxIndex--; renderLightbox(); }
  });
  el.lbNext.addEventListener("click", () => {
    if (state.lightboxIndex < state.items.length - 1) { state.lightboxIndex++; renderLightbox(); }
  });
  document.addEventListener("keydown", (e) => {
    if (el.lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") el.lbPrev.click();
    if (e.key === "ArrowRight") el.lbNext.click();
  });

  el.lbCopy.addEventListener("click", async () => {
    const item = state.items[state.lightboxIndex];
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.full);
      showToast("Ссылка скопирована");
    } catch {
      showToast("Не удалось скопировать");
    }
  });
  el.lbDownload.addEventListener("click", () => {
    const item = state.items[state.lightboxIndex];
    if (item) downloadItem(item);
  });

  // ---------- Download ----------
  async function downloadItem(item) {
    showToast("Скачивание…");
    try {
      let url = item.download.url;
      if (item.download.type === "unsplash" && item.download.locationUrl) {
        const res = await fetch(item.download.locationUrl, {
          headers: { Authorization: `Client-ID ${window.UNSPLASH_CONFIG.UNSPLASH_ACCESS_KEY}` },
        });
        if (res.ok) {
          const data = await res.json();
          url = data.url || url;
        }
      }
      await forceDownload(url, `${item.provider}-${item.id.split("-").pop()}.jpg`);
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

  initTheme();
})();
