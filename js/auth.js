// Обёртка над supabase-js — вход через Google/почту, текущая сессия,
// access-токен для воркера (снимает дневной лимит гостя, см.
// cloudflare-worker/worker.js). Ничего не делает и не падает, если
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY не заданы в js/config.js — сайт
// работает как раньше, просто без входа.
//
// Сама библиотека supabase-js (~55 КБ сжатого JS) не блокирует загрузку
// сайта: подгружается в фоне, когда страница уже готова. До этого момента
// сессия берётся прямо из localStorage, куда её сохраняет supabase-js.
(function (global) {
  "use strict";

  const CONFIG = global.APP_CONFIG || {};
  const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js";
  let client = null;
  let clientPromise = null;
  const listeners = new Set();

  function isConfigured() {
    return Boolean(CONFIG.ACCOUNTS_ENABLED && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY);
  }

  function readStoredSession() {
    try {
      const ref = new URL(CONFIG.SUPABASE_URL).hostname.split(".")[0];
      const raw = global.localStorage.getItem(`sb-${ref}-auth-token`);
      const s = raw && JSON.parse(raw);
      if (s && s.access_token && (!s.expires_at || s.expires_at * 1000 > Date.now())) return s;
    } catch { /* нет доступа к localStorage или чужой формат — считаем, что не вошёл */ }
    return null;
  }

  let currentSession = isConfigured() ? readStoredSession() : null;

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(currentSession);
      } catch (err) {
        console.warn("PhotoSeekAuth listener failed:", err);
      }
    });
  }

  function loadLibrary() {
    if (global.supabase && typeof global.supabase.createClient === "function") return Promise.resolve(global.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SUPABASE_JS_URL;
      s.async = true;
      s.onload = () => (global.supabase ? resolve(global.supabase) : reject(new Error("supabase-js не загрузился")));
      s.onerror = () => reject(new Error("supabase-js не загрузился"));
      document.head.appendChild(s);
    });
  }

  function ensureClient() {
    if (!isConfigured()) return Promise.reject(new Error("Supabase не настроен"));
    if (!clientPromise) {
      clientPromise = loadLibrary().then((lib) => {
        client = lib.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
        client.auth.onAuthStateChange((_event, session) => {
          currentSession = session || null;
          notify();
        });
        return client.auth.getSession().then(({ data }) => {
          currentSession = (data && data.session) || null;
          notify();
          return client;
        });
      }).catch((err) => {
        clientPromise = null;
        throw err;
      });
    }
    return clientPromise;
  }

  // fn(session|null) вызывается сразу с текущим состоянием и затем при
  // каждой смене сессии. Возвращает функцию отписки.
  function onChange(fn) {
    listeners.add(fn);
    fn(currentSession);
    return () => listeners.delete(fn);
  }

  function getSession() { return currentSession; }
  function getUser() { return currentSession ? currentSession.user : null; }
  function getAccessToken() { return currentSession ? currentSession.access_token : null; }

  async function signInWithGoogle() {
    const c = await ensureClient();
    const { error } = await c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: global.location.href },
    });
    if (error) throw error;
  }

  async function signInWithEmail(email) {
    const c = await ensureClient();
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: global.location.href },
    });
    if (error) throw error;
  }

  async function signOut() {
    const c = await ensureClient();
    await c.auth.signOut();
  }

  global.PhotoSeekAuth = {
    onChange,
    isConfigured,
    getSession,
    getUser,
    getAccessToken,
    ensureClient,
    signInWithGoogle,
    signInWithEmail,
    signOut,
  };

  if (isConfigured()) {
    // Вернулись со страницы входа Google / из письма — токен в адресе
    // надо разобрать как можно раньше. Иначе библиотека не нужна для
    // первой отрисовки: берём её, когда страница уже загрузилась.
    const returningFromAuth = /[#&?](access_token|code|error_description)=/.test(global.location.href);
    const start = () => ensureClient().catch((err) => console.warn("PhotoSeekAuth:", err.message));
    if (returningFromAuth || document.readyState === "complete") start();
    else global.addEventListener("load", () => {
      if (global.requestIdleCallback) global.requestIdleCallback(start, { timeout: 3000 });
      else setTimeout(start, 0);
    }, { once: true });
  }
})(window);
