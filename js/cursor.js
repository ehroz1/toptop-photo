// Курсор-точка на главном экране. Вместо стрелки мыши — маленькая точка,
// которая догоняет указатель "на пружине" (с лёгким перелётом),
// вытягивается по направлению движения, раздувается над кнопками и ссылками
// и сжимается при нажатии. Над полем ввода прячется — там нужен обычный
// текстовый курсор. Работает только с мышью/тачпадом, только пока открыт
// главный экран (body.is-home) и не при «уменьшить движение» в системе.
// Внешний вид — .magic-cursor в css/styles.css.
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
  const INTERACTIVE = "a, button, label, select, summary, [role='button'], [role='menuitem']";
  const TEXT_INPUT = "input[type='text'], input[type='email'], input[type='search'], textarea";

  let node = null;
  let enabled = false;
  let visible = false;
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

  function shouldRun() {
    return finePointer.matches && !reducedMotion.matches && doc.body.classList.contains("is-home");
  }

  function sync() {
    const run = shouldRun();
    if (run === enabled) return;
    enabled = run;
    if (run) {
      build();
      doc.body.classList.add("magic-cursor-on");
    } else {
      doc.body.classList.remove("magic-cursor-on");
      hide();
    }
  }

  function hide() {
    visible = false;
    if (node) node.classList.remove("is-visible", "is-hover", "is-down", "is-text");
  }

  function onMove(e) {
    if (!enabled || e.pointerType === "touch") return;
    tx = e.clientX;
    ty = e.clientY;
    if (!visible) {
      // Появляемся сразу под указателем, а не прилетаем из угла экрана.
      x = tx; y = ty; vx = 0; vy = 0;
      visible = true;
      node.classList.add("is-visible");
    }
    const target = e.target instanceof Element ? e.target : null;
    const overText = Boolean(target && target.closest(TEXT_INPUT));
    node.classList.toggle("is-text", overText);
    node.classList.toggle("is-hover", !overText && Boolean(target && target.closest(INTERACTIVE)));
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
    // Чем быстрее движется, тем сильнее вытягивается вдоль движения.
    const stretch = Math.min(speed / 2600, 0.6);
    const angle = Math.atan2(vy, vx);
    node.style.transform =
      `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${angle.toFixed(3)}rad) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.45).toFixed(3)})`;
    raf = global.requestAnimationFrame(step);
  }

  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.addEventListener("pointerdown", () => { if (node && enabled) node.classList.add("is-down"); });
  doc.addEventListener("pointerup", () => { if (node) node.classList.remove("is-down"); });
  // Указатель ушёл за пределы окна — точка гаснет, вернётся вместе с ним.
  doc.documentElement.addEventListener("mouseleave", hide);

  new MutationObserver(sync).observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  [finePointer, reducedMotion].forEach((q) => {
    if (q.addEventListener) q.addEventListener("change", sync);
  });
  sync();
})(window);
