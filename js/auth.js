// Обёртка над supabase-js — вход через Google/почту, текущая сессия,
// access-токен для воркера (снимает дневной лимит гостя, см.
// cloudflare-worker/worker.js). Ничего не делает и не падает, если
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY не заданы в js/config.js — сайт
// работает как раньше, просто без входа.
(function (global) {
  "use strict";

  const CONFIG = global.APP_CONFIG || {};
  let client = null;
  let currentSession = null;
  let ready = false;
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(currentSession);
      } catch (err) {
        console.warn("PhotoSeekAuth listener failed:", err);
      }
    });
  }

  function init() {
    if (client) return client;
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) return null;
    if (!global.supabase || typeof global.supabase.createClient !== "function") return null;

    client = global.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

    client.auth.getSession().then(({ data }) => {
      currentSession = (data && data.session) || null;
      ready = true;
      notify();
    });

    client.auth.onAuthStateChange((_event, session) => {
      currentSession = session || null;
      ready = true;
      notify();
    });

    return client;
  }

  // fn(session|null) вызывается сразу (с текущим состоянием, если уже
  // известно) и затем при каждой смене сессии. Возвращает функцию отписки.
  function onChange(fn) {
    listeners.add(fn);
    if (ready) fn(currentSession);
    return () => listeners.delete(fn);
  }

  function isReady() { return ready; }
  function isConfigured() { return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY); }
  function getSession() { return currentSession; }
  function getUser() { return currentSession ? currentSession.user : null; }
  function getAccessToken() { return currentSession ? currentSession.access_token : null; }

  async function signInWithGoogle() {
    if (!client) throw new Error("Supabase не настроен");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: global.location.href },
    });
    if (error) throw error;
  }

  async function signInWithEmail(email) {
    if (!client) throw new Error("Supabase не настроен");
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: global.location.href },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  global.PhotoSeekAuth = {
    init,
    onChange,
    isReady,
    isConfigured,
    getSession,
    getUser,
    getAccessToken,
    signInWithGoogle,
    signInWithEmail,
    signOut,
  };

  init();
})(window);
