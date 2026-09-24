// Фоновое фото в тёмной теме на главном экране: одно из нескольких,
// случайное на сеанс (вкладку браузера), и плавно "проявляется" из размытия
// после загрузки страницы. В светлой теме и в результатах поиска не
// показывается (и, пока не понадобилось, даже не скачивается).
// Файлы — оптимизированные WebP-копии фото с Unsplash (см. images/bg).
(function (global) {
  "use strict";

  const PHOTOS = ["5hvn-2WW6rY", "HxCl2w7pKy0", "vCzuG3W3ucA"];
  const SESSION_KEY = "photoseek-bg";
  const LAST_KEY = "photoseek-bg-last";
  const root = document.documentElement;
  const layer = document.getElementById("bgPhoto");
  if (!layer) return;

  // Один и тот же фон на всю вкладку (перезагрузка его не меняет), а новый
  // сеанс по возможности получает не тот, что был в прошлый раз.
  function pickPhoto() {
    try {
      const saved = global.sessionStorage.getItem(SESSION_KEY);
      if (PHOTOS.includes(saved)) return saved;
    } catch { /* нет доступа к хранилищу — просто случайный */ }
    let last = null;
    try { last = global.localStorage.getItem(LAST_KEY); } catch { /* см. выше */ }
    const pool = PHOTOS.length > 1 ? PHOTOS.filter((p) => p !== last) : PHOTOS;
    const id = pool[Math.floor(Math.random() * pool.length)];
    try {
      global.sessionStorage.setItem(SESSION_KEY, id);
      global.localStorage.setItem(LAST_KEY, id);
    } catch { /* см. выше */ }
    return id;
  }

  const id = pickPhoto();
  // Узкий вертикальный экран (телефон) — отдельная портретная версия фото:
  // меньше весит и не растягивается при заполнении экрана.
  const variant = global.matchMedia && global.matchMedia("(orientation: portrait) and (max-width: 600px)").matches ? "mobile" : "desktop";
  const url = `images/bg/${id}-${variant}.webp`;
  layer.dataset.photo = id;

  let pageLoaded = false;
  let loaded = false;
  let loading = false;

  function isDark() {
    return root.getAttribute("data-theme") === "dark";
  }
  // Фото только на главном экране: в результатах поиска оно лишь отвлекает.
  function isHome() {
    return document.body.classList.contains("is-home");
  }
  function wanted() {
    return pageLoaded && isDark() && isHome();
  }

  // Показывает/прячет фото по текущему состоянию. Скачивается оно только в
  // первый раз, когда реально понадобилось; при каждом возвращении на
  // главную заново проявляется из дымки.
  function sync() {
    if (!wanted()) {
      layer.classList.remove("is-shown");
      return;
    }
    if (loaded) {
      if (layer.classList.contains("is-shown")) return;
      // Два кадра подряд: сначала браузер применяет исходное (размытое,
      // прозрачное) состояние, потом — переход.
      global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
        if (wanted()) layer.classList.add("is-shown");
      }));
      return;
    }
    if (loading) return;
    loading = true;
    const img = new Image();
    img.decoding = "async";
    if ("fetchPriority" in img) img.fetchPriority = "low";
    img.onload = () => {
      loading = false;
      loaded = true;
      layer.style.backgroundImage = `url("${url}")`;
      sync();
    };
    img.onerror = () => { loading = false; };
    img.src = url;
  }

  // Смена темы и переход главная ↔ выдача.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Фон не должен отнимать канал у самой страницы: начинаем, только когда
  // она полностью загрузилась.
  const onLoad = () => { pageLoaded = true; sync(); };
  if (document.readyState === "complete") onLoad();
  else global.addEventListener("load", onLoad, { once: true });
})(window);
