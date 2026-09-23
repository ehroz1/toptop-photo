// Фоновое фото в тёмной теме: одно из нескольких, случайное на сеанс
// (вкладку браузера), и плавно "проявляется" из размытия после загрузки
// страницы. В светлой теме не показывается и даже не скачивается.
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
  let started = false;

  function isDark() {
    return root.getAttribute("data-theme") === "dark";
  }

  function reveal() {
    if (started || !pageLoaded || !isDark()) return;
    started = true;
    const img = new Image();
    img.decoding = "async";
    if ("fetchPriority" in img) img.fetchPriority = "low";
    img.onload = () => {
      layer.style.backgroundImage = `url("${url}")`;
      // Два кадра подряд: сначала браузер применяет исходное (размытое,
      // прозрачное) состояние с уже готовой картинкой, потом — переход.
      global.requestAnimationFrame(() => global.requestAnimationFrame(() => layer.classList.add("is-shown")));
    };
    img.onerror = () => { started = false; };
    img.src = url;
  }

  // Тему переключили на тёмную уже после загрузки — фон появляется тогда же.
  new MutationObserver(reveal).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  // Фон не должен отнимать канал у самой страницы: начинаем, только когда
  // она полностью загрузилась.
  const onLoad = () => { pageLoaded = true; reveal(); };
  if (document.readyState === "complete") onLoad();
  else global.addEventListener("load", onLoad, { once: true });
})(window);
