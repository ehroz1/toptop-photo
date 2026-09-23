// Проверки самого Cloudflare-воркера (cloudflare-worker/worker.js) в Node —
// с подменённым fetch вместо настоящих API:
//  1) токен Shutterstock запрашивается так, как требует их API: client_id и
//     client_secret в теле формы (иначе 400 "Validation failed");
//  2) дневной лимит для гостей не включается сам по себе от одной привязки
//     KV LIMITS — только если явно задан ANON_DAILY_LIMIT.
const fs = require("fs");
const path = require("path");

const ORIGIN = "https://ehroz1.github.io";

function memoryKV() {
  const data = new Map();
  let writes = 0;
  return {
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async put(k, v) { writes++; data.set(k, v); },
    get writes() { return writes; },
  };
}

(async () => {
  let ok = true;
  const fail = (msg) => { console.error("FAIL:", msg); ok = false; };

  const source = fs.readFileSync(path.join(__dirname, "../../cloudflare-worker/worker.js"), "utf8");
  const worker = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;

  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "tok123", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], total_count: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const request = (p, headers = {}) =>
    new Request(`https://photoseek-proxy.example.workers.dev${p}`, { headers: { Origin: ORIGIN, "CF-Connecting-IP": "1.2.3.4", ...headers } });

  // 1. Shutterstock
  const env = { SHUTTERSTOCK_CONSUMER_KEY: " key-abc ", SHUTTERSTOCK_CONSUMER_SECRET: "secret-xyz" };
  const res = await worker.fetch(request("/shutterstock?query=cat&page=1"), env);
  if (res.status !== 200) fail(`/shutterstock ответил ${res.status}: ${await res.text()}`);
  const tokenCall = calls.find((c) => c.url.includes("/oauth/access_token"));
  if (!tokenCall) {
    fail("воркер не запросил токен Shutterstock");
  } else {
    const form = new URLSearchParams(String(tokenCall.init.body));
    console.log("Тело запроса токена:", String(tokenCall.init.body));
    if (form.get("client_id") !== "key-abc") fail("нет client_id (или не обрезаны пробелы) в теле запроса токена");
    if (form.get("client_secret") !== "secret-xyz") fail("нет client_secret в теле запроса токена");
    if (form.get("grant_type") !== "client_credentials") fail("нет grant_type=client_credentials");
    if ((tokenCall.init.headers || {}).Authorization) fail("вместе с телом не должен уходить ещё и заголовок Authorization");
  }
  const searchCall = calls.find((c) => c.url.includes("/v2/images/search"));
  if (!searchCall || searchCall.init.headers.Authorization !== "Bearer tok123") fail("поиск Shutterstock ушёл без полученного токена");

  // 2. Лимит гостей
  const limits = memoryKV();
  const envNoLimit = { PIXABAY_KEY: "k", LIMITS: limits };
  for (let i = 0; i < 5; i++) {
    const r = await worker.fetch(request("/pixabay?q=cat"), envNoLimit);
    if (r.status !== 200) { fail(`без ANON_DAILY_LIMIT запрос №${i + 1} получил ${r.status}`); break; }
  }
  if (limits.writes !== 0) fail(`без ANON_DAILY_LIMIT воркер всё равно пишет счётчики в KV (${limits.writes} записей)`);

  const envLimit = { PIXABAY_KEY: "k", LIMITS: memoryKV(), ANON_DAILY_LIMIT: "2" };
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await worker.fetch(request("/pixabay?q=cat"), envLimit)).status);
  console.log("С ANON_DAILY_LIMIT=2 статусы:", statuses.join(", "));
  if (statuses.join() !== "200,200,429") fail("явно заданный лимит не срабатывает");

  console.log(ok ? "\n=== TEST19 OK ===" : "\n=== TEST19 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
