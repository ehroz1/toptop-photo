// Счётчики посещаемости: Яндекс Метрика и/или Cloudflare Web Analytics.
// Включаются, только если в js/config.js заполнен свой номер/токен
// (ANALYTICS); пока там пусто — ничего не грузится и никуда не отправляется.
// Скрипты счётчиков подгружаются после полной загрузки страницы, чтобы не
// замедлять её открытие.
//
// Кроме посещений, считаем поиски как цель "search" в Метрике
// (PictaAnalytics.goal) — видно, сколько людей реально ищут, а не только
// открывают главную.
(function (global) {
  "use strict";

  const cfg = (global.APP_CONFIG && global.APP_CONFIG.ANALYTICS) || {};
  const metrikaId = Number(cfg.YANDEX_METRIKA_ID) || 0;
  const cfToken = String(cfg.CLOUDFLARE_BEACON_TOKEN || "").trim();

  function addScript(src, attrs) {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
  }

  function start() {
    if (metrikaId) {
      // Официальный код Метрики, только без встроенного <script> в HTML.
      global.ym = global.ym || function () { (global.ym.a = global.ym.a || []).push(arguments); };
      global.ym.l = Date.now();
      addScript("https://mc.yandex.ru/metrika/tag.js");
      global.ym(metrikaId, "init", {
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
      });
    }
    if (cfToken) {
      addScript("https://static.cloudflareinsights.com/beacon.min.js", {
        "data-cf-beacon": JSON.stringify({ token: cfToken }),
      });
    }
  }

  global.PictaAnalytics = {
    enabled: Boolean(metrikaId || cfToken),
    // Цель в Метрике (например, "search"); без Метрики — ничего не делает.
    goal(name, params) {
      if (metrikaId && typeof global.ym === "function") {
        try { global.ym(metrikaId, "reachGoal", name, params); } catch { /* не критично */ }
      }
    },
  };

  if (!metrikaId && !cfToken) return;
  if (document.readyState === "complete") setTimeout(start, 0);
  else global.addEventListener("load", () => setTimeout(start, 0), { once: true });
})(window);
