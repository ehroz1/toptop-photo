// Курсор-точка на главном экране. Вместо стрелки мыши — маленькая точка,
// которая догоняет указатель "на пружине" (с лёгким перелётом),
// вытягивается по направлению движения, раздувается над кнопками и ссылками
// и сжимается при нажатии. Над полем ввода точка перетекает в тонкую
// вертикальную черту — свой текстовый курсор.
//
// На телефоне точка (чуть крупнее — под палец) появляется там, где коснулись,
// тянется за пальцем, если его зажать и повести, а после отпускания ещё
// мгновение видна и гаснет.
//
// Работает только на главном экране (body.is-home) и не при «уменьшить
// движение» в системе. Внешний вид — .magic-cursor в css/styles.css.
(function (global) {
  "use strict";

  const doc = global.document;
  if (!global.matchMedia || !global.requestAnimationFrame) return;
  const finePointer = global.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)");

  // Пружина: жёсткость (1/с²) и затухание (1/с). Затухание чуть меньше
  // критического (2·√900 = 60) — поэтому точка слегка "перелетает" цель.
  const STIFFNESS = 900;
  const DAMPING = 38;
  // Сколько точка ещё видна после того, как палец отпустили.
  const TOUCH_LINGER_MS = 700;
  const INTERACTIVE = "a, button, label, select, summary, [role='button'], [role='menuitem']";
  const TEXT_INPUT = "input[type='text'], input[type='email'], input[type='search'], textarea";

  let node = null;
  let active = false; // главный экран и движение не отключено
  let mouseMode = false; // есть мышь/тачпад — прячем системный курсор
  let visible = false;
  let touching = false;
  let lingerTimer = 0;
  let raf = 0;
  let last = 0;
  let x = 0, y = 0, vx = 0, vy = 0, tx = 0, ty = 0;

  function build() {
    if (node) return;
    node = doc.createElement("div");
    node.className = "magic-cursor";
    node.setAttribute("aria-hidden", "true");
    const dot = doc.createElement("span");
    dot.className = "magic-cursor-dot";
    node.appendChild(dot);
    doc.body.appendChild(node);
  }

  function sync() {
    active = doc.body.classList.contains("is-home") && !reducedMotion.matches;
    mouseMode = active && finePointer.matches;
    doc.body.classList.toggle("magic-cursor-on", mouseMode);
    if (active) build();
    else hide();
  }

  function hide() {
    visible = false;
    clearTimeout(lingerTimer);
    if (node) node.classList.remove("is-visible", "is-hover", "is-down", "is-text", "is-touch");
  }

  // Точка появляется сразу в точке касания/под указателем, а если уже была
  // видна — летит к новой цели по пружине.
  function aim(clientX, clientY) {
    tx = clientX;
    ty = clientY;
    if (!visible) {
      x = tx; y = ty; vx = 0; vy = 0;
      visible = true;
      node.classList.add("is-visible");
    }
    if (!raf) {
      last = global.performance.now();
      raf = global.requestAnimationFrame(step);
    }
  }

  function step(now) {
    // Шаг не больше 32 мс: после фоновой вкладки не "выстреливаем".
    const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
    last = now;
    vx += ((tx - x) * STIFFNESS - vx * DAMPING) * dt;
    vy += ((ty - y) * STIFFNESS - vy * DAMPING) * dt;
    x += vx * dt;
    y += vy * dt;
    const speed = Math.hypot(vx, vy);
    if (speed < 2 && Math.abs(tx - x) < 0.2 && Math.abs(ty - y) < 0.2) {
      // Успокоилась — ставим точно на место и не крутим кадры впустую.
      x = tx; y = ty; vx = 0; vy = 0;
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = 0;
      return;
    }
    const move = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    if (node.classList.contains("is-text")) {
      // Текстовый курсор не вытягиваем и не поворачиваем — он всегда ровный.
      node.style.transform = move;
    } else {
      // Чем быстрее движется, тем сильнее вытягивается вдоль движения.
      const stretch = Math.min(speed / 2600, 0.6);
      const angle = Math.atan2(vy, vx);
      node.style.transform = `${move} rotate(${angle.toFixed(3)}rad) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.45).toFixed(3)})`;
    }
    raf = global.requestAnimationFrame(step);
  }

  // ---- Мышь / тачпад ----
  doc.addEventListener("pointermove", (e) => {
    if (!mouseMode || e.pointerType === "touch" || touching) return;
    node.classList.remove("is-touch");
    const target = e.target instanceof Element ? e.target : null;
    const overText = Boolean(target && target.closest(TEXT_INPUT));
    node.classList.toggle("is-text", overText);
    node.classList.toggle("is-hover", !overText && Boolean(target && target.closest(INTERACTIVE)));
    aim(e.clientX, e.clientY);
  }, { passive: true });
  doc.addEventListener("pointerdown", (e) => {
    if (node && mouseMode && e.pointerType !== "touch") node.classList.add("is-down");
  });
  doc.addEventListener("pointerup", (e) => {
    if (node && e.pointerType !== "touch") node.classList.remove("is-down");
  });
  // Указатель ушёл за пределы окна — точка гаснет, вернётся вместе с ним.
  doc.documentElement.addEventListener("mouseleave", () => { if (!touching) hide(); });

  // ---- Палец ----
  // Touch-события, а не pointer: они продолжают приходить, даже если
  // страница начала прокручиваться под пальцем.
  doc.addEventListener("touchstart", (e) => {
    if (!active || !e.touches.length) return;
    touching = true;
    clearTimeout(lingerTimer);
    node.classList.remove("is-text", "is-hover");
    node.classList.add("is-touch", "is-down");
    aim(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  doc.addEventListener("touchmove", (e) => {
    if (!active || !touching || !e.touches.length) return;
    aim(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  const release = (e) => {
    if (!touching || (e.touches && e.touches.length)) return;
    touching = false;
    if (!node) return;
    node.classList.remove("is-down");
    clearTimeout(lingerTimer);
    lingerTimer = setTimeout(hide, TOUCH_LINGER_MS);
  };
  doc.addEventListener("touchend", release, { passive: true });
  doc.addEventListener("touchcancel", release, { passive: true });

  new MutationObserver(sync).observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  [finePointer, reducedMotion].forEach((q) => {
    if (q.addEventListener) q.addEventListener("change", sync);
  });
  sync();
})(window);
