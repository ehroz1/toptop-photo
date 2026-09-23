// Picta — прокси для API-ключей фотостоков + авторизация/лимиты/админка.
//
// Держит Pixabay/Pexels/Unsplash/Flickr/... ключи как секреты воркера (либо,
// после подключения Cloudflare KV, как записи в KV — чтобы админка могла
// менять их без редеплоя) и сам подставляет их перед обращением к настоящему
// API. Wikimedia Commons и Openverse ключа не требуют — сайт продолжает
// обращаться к ним напрямую, через воркер их проксировать не нужно.
//
// Плюс: проверка сессии Supabase (чтобы снимать дневной лимит для вошедших
// пользователей), дневной лимит запросов по IP для гостей (Cloudflare KV),
// логирование поисков в Supabase и закрытые /admin/* эндпоинты для админки
// (управление ключами, статистика).
//
// Деплой и переменные окружения — см. README в корне репозитория и
// cloudflare-worker/README.md.

// Адреса сайта, с которых воркер принимает запросы: домен picta.cc (с www и
// без) и старый адрес на GitHub Pages. Переменная ALLOWED_ORIGINS в
// настройках воркера, если задана, заменяет этот список целиком.
const DEFAULT_ALLOWED_ORIGIN = "https://picta.cc,https://www.picta.cc,https://ehroz1.github.io";

function allowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGIN;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
  const list = allowedOrigins(env);
  return list.includes("*") || list.includes(origin);
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allow = isAllowedOrigin(origin, env) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Запросы вошедших пользователей несут заголовок Authorization, из-за
    // чего браузер перед каждым шлёт preflight (OPTIONS). Кэшируем ответ на
    // него, иначе каждый поиск стоил бы лишний сетевой круг.
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonError(origin, env, message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
  });
}

function jsonOk(origin, env, data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
  });
}

// Копирует query-параметры запроса к воркеру, кроме перечисленных в exclude —
// секретные параметры (ключи) всегда задаются сервером ниже, а не клиентом.
function copyParams(url, exclude = []) {
  const out = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!exclude.includes(k)) out.append(k, v);
  }
  return out;
}

// Некоторые API (замечено на Shutterstock) отклоняют запрос без заголовка
// User-Agent — fetch() из Cloudflare Worker не подставляет браузерный UA
// сам по себе. Задаём его один раз здесь для всех проксируемых запросов.
const WORKER_USER_AGENT = "Picta/1.0 (+https://picta.cc/; Cloudflare Worker proxy)";

async function proxy(targetUrl, init, origin, env) {
  let res;
  try {
    res = await fetch(targetUrl, {
      ...init,
      headers: { "User-Agent": WORKER_USER_AGENT, ...(init.headers || {}) },
    });
  } catch (err) {
    return jsonError(origin, env, `upstream fetch failed: ${err.message}`, 502);
  }
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
      ...corsHeaders(origin, env),
    },
  });
}

// Токен живёт, пока жив этот инстанс воркера (Cloudflare может переиспользовать
// его между запросами) — обычный module-level кэш, безопасный паттерн для
// Workers. Если инстанс перезапустится, просто получим новый токен на
// следующий запрос — не страшно, лишь одна лишняя пара запросов.
let shutterstockTokenCache = null; // { token, expiresAt }

async function getShutterstockAccessToken(env) {
  const now = Date.now();
  if (shutterstockTokenCache && shutterstockTokenCache.expiresAt > now + 30_000) {
    return shutterstockTokenCache.token;
  }
  const consumerKey = await getSecret(env, "SHUTTERSTOCK_CONSUMER_KEY");
  const consumerSecret = await getSecret(env, "SHUTTERSTOCK_CONSUMER_SECRET");
  // Shutterstock требует client_id/client_secret в теле формы, а не в
  // заголовке Basic: без них отвечает 400 "Validation failed"
  // (VALIDATION_OBJECT_REQUIRED). Оба способа сразу не шлём — по OAuth 2.0
  // клиент должен аутентифицироваться одним способом за запрос.
  const res = await fetch("https://api.shutterstock.com/v2/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": WORKER_USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: consumerKey.trim(),
      client_secret: consumerSecret.trim(),
      grant_type: "client_credentials",
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`oauth ${res.status} ${text.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("oauth response has no access_token");
  shutterstockTokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return shutterstockTokenCache.token;
}

// ---------------------------------------------------------------------------
// Ключи фотостоков: сперва смотрим в Cloudflare KV (admin-панель пишет туда),
// если там пусто — берём из secrets воркера (старое поведение, ничего не
// ломается, пока KV не подключён или запись не переопределена админкой).
// ---------------------------------------------------------------------------

const MANAGED_KEY_NAMES = [
  "PIXABAY_KEY",
  "PEXELS_KEY",
  "UNSPLASH_ACCESS_KEY",
  "FLICKR_API_KEY",
  "SHUTTERSTOCK_CONSUMER_KEY",
  "SHUTTERSTOCK_CONSUMER_SECRET",
  "PEXAFY_API_KEY",
  "COVERR_API_KEY",
];

async function getSecret(env, name) {
  if (env.KEYS) {
    try {
      const v = await env.KEYS.get(name);
      if (v) return v;
    } catch (_) {
      // KV недоступен — тихо падаем обратно на secret ниже.
    }
  }
  return env[name] || null;
}

// ---------------------------------------------------------------------------
// Supabase: проверка сессии пользователя и флага is_admin.
//
// Не проверяем JWT локально (Supabase может подписывать его и HS256, и
// асимметричными ключами — это меняется между проектами/версиями), а просто
// спрашиваем сам Supabase Auth. Это надёжно и не требует держать в воркере
// JWT-библиотеку. Чтобы не дёргать Supabase на каждый из нескольких
// параллельных запросов одного поиска (один на источник), результат недолго
// кэшируется в памяти инстанса воркера — тот же паттерн, что и у
// shutterstockTokenCache выше.
// ---------------------------------------------------------------------------

const userCache = new Map(); // token -> { user, expiresAt }
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX_SIZE = 500;

async function verifyUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];

  const now = Date.now();
  const cached = userCache.get(token);
  if (cached && cached.expiresAt > now) return cached.user;

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.id) return null;
    if (userCache.size >= USER_CACHE_MAX_SIZE) userCache.clear();
    userCache.set(token, { user, expiresAt: now + USER_CACHE_TTL_MS });
    return user;
  } catch (_) {
    return null;
  }
}

async function isAdmin(user, env) {
  if (!user || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`, {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return !!(rows[0] && rows[0].is_admin);
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Дневной лимит для гостей (не вошедших через Supabase) — считаем по IP в
// Cloudflare KV, сброс каждый день в полночь UTC. Вошедшие пользователи лимит
// не имеют.
//
// Лимит включается ТОЛЬКО явно — переменной ANON_DAILY_LIMIT (число > 0) и
// привязкой KV LIMITS. Одной привязки мало: пока вход на сайте выключен
// (ACCOUNTS_ENABLED: false в js/config.js), гостями были бы все посетители,
// а считается каждый запрос к источнику (один поиск — это 6–8 запросов),
// так что лимит закончился бы за пару десятков поисков. Вдобавок каждый
// учтённый запрос — запись в KV, а их на бесплатном тарифе ~1000 в сутки.
// ---------------------------------------------------------------------------

function todayUtcKey(ip) {
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  return `rl:${ip}:${d}`;
}

function secondsUntilNextUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}

// Возвращает предел (число), если гость его исчерпал, иначе null (запрос разрешён).
async function checkRateLimit(request, env, user) {
  if (user) return null; // вошедшие — без лимита
  const limit = Number(env.ANON_DAILY_LIMIT);
  if (!env.LIMITS || !(limit > 0)) return null; // лимит не включён — см. выше

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = todayUtcKey(ip);

  const current = Number((await env.LIMITS.get(key)) || "0");
  if (current >= limit) return limit;

  await env.LIMITS.put(key, String(current + 1), { expirationTtl: secondsUntilNextUtcMidnight() });
  return null;
}

// ---------------------------------------------------------------------------
// Логирование поисков в Supabase (для статистики в админке). Один вызов на
// поиск с сайта (не на источник) — см. logSearch() в js/app.js.
// ---------------------------------------------------------------------------

async function logSearch(request, origin, env, user) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return jsonOk(origin, env, { ok: false });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    // тело не обязательно — просто ничего не логируем детально
  }
  const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
  const mode = typeof body.mode === "string" ? body.mode.slice(0, 20) : "photos";
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/search_stats`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ query, mode, user_id: user ? user.id : null }]),
    });
  } catch (_) {
    // статистика необязательна — не роняем ответ клиенту из-за неё
  }
  return jsonOk(origin, env, { ok: true });
}

// ---------------------------------------------------------------------------
// Админка: /admin/keys (GET список / PUT сохранить / DELETE удалить),
// /admin/stats (GET). Доступ только вошедшим через Supabase пользователям с
// profiles.is_admin = true (см. supabase/migrations/0001_init.sql).
// ---------------------------------------------------------------------------

async function adminListKeys(origin, env) {
  const out = [];
  for (const name of MANAGED_KEY_NAMES) {
    const kvVal = env.KEYS ? await env.KEYS.get(name) : null;
    const envVal = env[name] || null;
    const value = kvVal || envVal;
    out.push({
      name,
      configured: !!value,
      source: kvVal ? "kv" : envVal ? "secret" : null,
      preview: value ? `${value.slice(0, 4)}…${value.slice(-4)}` : null,
    });
  }
  return jsonOk(origin, env, { keys: out });
}

async function adminSetKey(request, origin, env) {
  if (!env.KEYS) return jsonError(origin, env, "KV namespace KEYS не подключён к воркеру", 500);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError(origin, env, "invalid JSON body", 400);
  }
  const { name, value } = body || {};
  if (!MANAGED_KEY_NAMES.includes(name)) return jsonError(origin, env, "unknown key name", 400);
  if (!value || typeof value !== "string") return jsonError(origin, env, "value is required", 400);
  await env.KEYS.put(name, value);
  return jsonOk(origin, env, { ok: true });
}

async function adminDeleteKey(url, origin, env) {
  if (!env.KEYS) return jsonError(origin, env, "KV namespace KEYS не подключён к воркеру", 500);
  const name = url.searchParams.get("name");
  if (!MANAGED_KEY_NAMES.includes(name)) return jsonError(origin, env, "unknown key name", 400);
  await env.KEYS.delete(name);
  return jsonOk(origin, env, { ok: true });
}

async function adminStats(origin, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return jsonError(origin, env, "Supabase is not configured", 500);
  }
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    Prefer: "count=exact",
    Range: "0-0",
  };

  async function countRows(path) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}${path}`, { headers });
      const range = res.headers.get("content-range"); // формат "0-0/123"
      return range ? Number(range.split("/")[1]) : null;
    } catch (_) {
      return null;
    }
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [userCount, searchesToday] = await Promise.all([
    countRows("/rest/v1/profiles?select=id"),
    countRows(`/rest/v1/search_stats?select=id&created_at=gte.${since.toISOString()}`),
  ]);

  return jsonOk(origin, env, { userCount, searchesToday });
}

async function handleAdmin(request, url, origin, env) {
  const user = await verifyUser(request, env);
  if (!user) return jsonError(origin, env, "unauthorized", 401);
  const admin = await isAdmin(user, env);
  if (!admin) return jsonError(origin, env, "forbidden", 403);

  if (url.pathname === "/admin/keys" && request.method === "GET") return adminListKeys(origin, env);
  if (url.pathname === "/admin/keys" && request.method === "PUT") return adminSetKey(request, origin, env);
  if (url.pathname === "/admin/keys" && request.method === "DELETE") return adminDeleteKey(url, origin, env);
  if (url.pathname === "/admin/stats" && request.method === "GET") return adminStats(origin, env);
  return jsonError(origin, env, "not found", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin, env) });
    }
    if (!isAllowedOrigin(origin, env)) {
      return jsonError(origin, env, "origin not allowed", 403);
    }

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, url, origin, env);
    }

    if (url.pathname === "/log-search") {
      if (request.method !== "POST") return jsonError(origin, env, "method not allowed", 405);
      const user = await verifyUser(request, env);
      return logSearch(request, origin, env, user);
    }

    if (request.method !== "GET") {
      return jsonError(origin, env, "method not allowed", 405);
    }

    const user = await verifyUser(request, env);
    const exceededLimit = await checkRateLimit(request, env, user);
    if (exceededLimit) {
      return jsonError(
        origin,
        env,
        `Дневной лимит запросов без регистрации (${exceededLimit}) исчерпан. Войдите через Google или почту, чтобы снять ограничение.`,
        429
      );
    }

    if (url.pathname === "/pixabay") {
      const key = await getSecret(env, "PIXABAY_KEY");
      if (!key) return jsonError(origin, env, "PIXABAY_KEY is not configured", 500);
      const params = copyParams(url, ["key"]);
      params.set("key", key);
      return proxy(`https://pixabay.com/api/?${params}`, {}, origin, env);
    }

    if (url.pathname === "/pexels") {
      const key = await getSecret(env, "PEXELS_KEY");
      if (!key) return jsonError(origin, env, "PEXELS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexels.com/v1/search?${params}`, {
        headers: { Authorization: key },
      }, origin, env);
    }

    // Видео — те же ключи, что и у фото-Pixabay/Pexels выше: оба API дают
    // видео-поиск тем же аккаунтом/ключом, отдельно заводить второй секрет
    // не нужно.
    if (url.pathname === "/pixabay-video") {
      const key = await getSecret(env, "PIXABAY_KEY");
      if (!key) return jsonError(origin, env, "PIXABAY_KEY is not configured", 500);
      const params = copyParams(url, ["key"]);
      params.set("key", key);
      return proxy(`https://pixabay.com/api/videos/?${params}`, {}, origin, env);
    }

    if (url.pathname === "/pexels-video") {
      const key = await getSecret(env, "PEXELS_KEY");
      if (!key) return jsonError(origin, env, "PEXELS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexels.com/videos/search?${params}`, {
        headers: { Authorization: key },
      }, origin, env);
    }

    if (url.pathname === "/unsplash/search") {
      const key = await getSecret(env, "UNSPLASH_ACCESS_KEY");
      if (!key) return jsonError(origin, env, "UNSPLASH_ACCESS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.unsplash.com/search/photos?${params}`, {
        headers: { Authorization: `Client-ID ${key}` },
      }, origin, env);
    }

    // Отдельный путь для photo.links.download_location — Unsplash требует
    // дёргать именно этот URL (возвращённый их API вместе с самим фото)
    // с ключом в заголовке при каждом "скачивании" фотографии.
    if (url.pathname === "/unsplash/download") {
      const key = await getSecret(env, "UNSPLASH_ACCESS_KEY");
      if (!key) return jsonError(origin, env, "UNSPLASH_ACCESS_KEY is not configured", 500);
      const location = url.searchParams.get("location") || "";
      if (!location.startsWith("https://api.unsplash.com/")) {
        return jsonError(origin, env, "invalid location", 400);
      }
      return proxy(location, {
        headers: { Authorization: `Client-ID ${key}` },
      }, origin, env);
    }

    if (url.pathname === "/flickr") {
      const key = await getSecret(env, "FLICKR_API_KEY");
      if (!key) return jsonError(origin, env, "FLICKR_API_KEY is not configured", 500);
      const params = copyParams(url, ["api_key"]);
      params.set("api_key", key);
      return proxy(`https://api.flickr.com/services/rest/?${params}`, {}, origin, env);
    }

    // Shutterstock Content Search API v2 — настоящий OAuth 2.0
    // client_credentials, а не статический токен: токен, который даёт
    // кнопка "Создать токен" в личном кабинете, получен тем же способом и
    // так же недолговечен (сгорает через некоторое время), поэтому воркер
    // сам обменивает Consumer Key/Secret на свежий токен и кэширует его до
    // истечения — см. getShutterstockAccessToken.
    if (url.pathname === "/shutterstock") {
      const consumerKey = await getSecret(env, "SHUTTERSTOCK_CONSUMER_KEY");
      const consumerSecret = await getSecret(env, "SHUTTERSTOCK_CONSUMER_SECRET");
      if (!consumerKey || !consumerSecret) {
        return jsonError(origin, env, "SHUTTERSTOCK_CONSUMER_KEY/SHUTTERSTOCK_CONSUMER_SECRET is not configured", 500);
      }
      let token;
      try {
        token = await getShutterstockAccessToken(env);
      } catch (err) {
        return jsonError(origin, env, `shutterstock auth failed: ${err.message}`, 502);
      }
      const params = copyParams(url);
      return proxy(`https://api.shutterstock.com/v2/images/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, origin, env);
    }

    // Pexafy Search API — авторизация заголовком x-api-key (обычный
    // "Pexafy API" ключ, НЕ ключ типа "MCP" — тот для протокола MCP,
    // а не для REST).
    if (url.pathname === "/pexafy") {
      const key = await getSecret(env, "PEXAFY_API_KEY");
      if (!key) return jsonError(origin, env, "PEXAFY_API_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexafy.com/api/v1/search/photos?${params}`, {
        headers: { "x-api-key": key },
      }, origin, env);
    }

    // Coverr Search API — по их документации ключ передаётся как Bearer-токен
    // в заголовке Authorization (тот же паттерн, что у большинства современных
    // REST API, включая Pexels выше). Проверить это вживую из этой песочницы
    // нельзя (нет сетевого доступа наружу) — если Coverr в реальности ждёт
    // ключ иначе (например, query-параметром api_key), понадобится один
    // правкой этого блока; провайдер на клиенте (js/videoProviders.js)
    // изначально выключен через config.js, пока не подтверждено, что работает.
    if (url.pathname === "/coverr") {
      const key = await getSecret(env, "COVERR_API_KEY");
      if (!key) return jsonError(origin, env, "COVERR_API_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.coverr.co/videos?${params}`, {
        headers: { Authorization: `Bearer ${key}` },
      }, origin, env);
    }

    return jsonError(origin, env, "not found", 404);
  },
};
