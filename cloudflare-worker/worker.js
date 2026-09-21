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

async function proxy(targetUrl, init, origin, env) {
  let res;
  try {
    res = await fetch(targetUrl, init);
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

    return jsonError(origin, env, "not found", 404);
  },
};
