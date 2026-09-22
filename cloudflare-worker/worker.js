// PhotoSeek — прокси для API-ключей фотостоков.
//
// Держит Pixabay/Pexels/Unsplash/Flickr ключи как секреты воркера (никогда
// не попадают в браузер и в публичный репозиторий), принимает от сайта
// запросы без ключей и сам подставляет их перед обращением к настоящему API.
// Wikimedia Commons и Openverse ключа не требуют — сайт продолжает
// обращаться к ним напрямую, через воркер их проксировать не нужно.
//
// Деплой и переменные окружения — см. README в корне репозитория и
// cloudflare-worker/README.md.

const DEFAULT_ALLOWED_ORIGIN = "https://ehroz1.github.io";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonError(origin, env, message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
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
const WORKER_USER_AGENT = "PhotoSeek/1.0 (+https://ehroz1.github.io/toptop-photo/; Cloudflare Worker proxy)";

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
  const basic = btoa(`${env.SHUTTERSTOCK_CONSUMER_KEY}:${env.SHUTTERSTOCK_CONSUMER_SECRET}`);
  const res = await fetch("https://api.shutterstock.com/v2/oauth/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": WORKER_USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`oauth ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("oauth response has no access_token");
  shutterstockTokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return shutterstockTokenCache.token;
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
    if (request.method !== "GET") {
      return jsonError(origin, env, "method not allowed", 405);
    }

    if (url.pathname === "/pixabay") {
      if (!env.PIXABAY_KEY) return jsonError(origin, env, "PIXABAY_KEY is not configured", 500);
      const params = copyParams(url, ["key"]);
      params.set("key", env.PIXABAY_KEY);
      return proxy(`https://pixabay.com/api/?${params}`, {}, origin, env);
    }

    if (url.pathname === "/pexels") {
      if (!env.PEXELS_KEY) return jsonError(origin, env, "PEXELS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexels.com/v1/search?${params}`, {
        headers: { Authorization: env.PEXELS_KEY },
      }, origin, env);
    }

    // Видео — те же ключи, что и у фото-Pixabay/Pexels выше: оба API дают
    // видео-поиск тем же аккаунтом/ключом, отдельно заводить второй секрет
    // не нужно.
    if (url.pathname === "/pixabay-video") {
      if (!env.PIXABAY_KEY) return jsonError(origin, env, "PIXABAY_KEY is not configured", 500);
      const params = copyParams(url, ["key"]);
      params.set("key", env.PIXABAY_KEY);
      return proxy(`https://pixabay.com/api/videos/?${params}`, {}, origin, env);
    }

    if (url.pathname === "/pexels-video") {
      if (!env.PEXELS_KEY) return jsonError(origin, env, "PEXELS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexels.com/videos/search?${params}`, {
        headers: { Authorization: env.PEXELS_KEY },
      }, origin, env);
    }

    if (url.pathname === "/unsplash/search") {
      if (!env.UNSPLASH_ACCESS_KEY) return jsonError(origin, env, "UNSPLASH_ACCESS_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.unsplash.com/search/photos?${params}`, {
        headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
      }, origin, env);
    }

    // Отдельный путь для photo.links.download_location — Unsplash требует
    // дёргать именно этот URL (возвращённый их API вместе с самим фото)
    // с ключом в заголовке при каждом "скачивании" фотографии.
    if (url.pathname === "/unsplash/download") {
      if (!env.UNSPLASH_ACCESS_KEY) return jsonError(origin, env, "UNSPLASH_ACCESS_KEY is not configured", 500);
      const location = url.searchParams.get("location") || "";
      if (!location.startsWith("https://api.unsplash.com/")) {
        return jsonError(origin, env, "invalid location", 400);
      }
      return proxy(location, {
        headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
      }, origin, env);
    }

    if (url.pathname === "/flickr") {
      if (!env.FLICKR_API_KEY) return jsonError(origin, env, "FLICKR_API_KEY is not configured", 500);
      const params = copyParams(url, ["api_key"]);
      params.set("api_key", env.FLICKR_API_KEY);
      return proxy(`https://api.flickr.com/services/rest/?${params}`, {}, origin, env);
    }

    // Shutterstock Content Search API v2 — настоящий OAuth 2.0
    // client_credentials, а не статический токен: токен, который даёт
    // кнопка "Создать токен" в личном кабинете, получен тем же способом и
    // так же недолговечен (сгорает через некоторое время), поэтому воркер
    // сам обменивает Consumer Key/Secret на свежий токен и кэширует его до
    // истечения — см. getShutterstockAccessToken.
    if (url.pathname === "/shutterstock") {
      if (!env.SHUTTERSTOCK_CONSUMER_KEY || !env.SHUTTERSTOCK_CONSUMER_SECRET) {
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
      if (!env.PEXAFY_API_KEY) return jsonError(origin, env, "PEXAFY_API_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.pexafy.com/api/v1/search/photos?${params}`, {
        headers: { "x-api-key": env.PEXAFY_API_KEY },
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
      if (!env.COVERR_API_KEY) return jsonError(origin, env, "COVERR_API_KEY is not configured", 500);
      const params = copyParams(url);
      return proxy(`https://api.coverr.co/videos?${params}`, {
        headers: { Authorization: `Bearer ${env.COVERR_API_KEY}` },
      }, origin, env);
    }

    return jsonError(origin, env, "not found", 404);
  },
};
