// Общий счётчик скачиваний всех посетителей (/stats/downloads на воркере):
//  - на главной видно «Скачано через Picta: 1 234», во время поиска строка
//    уходит (body без is-home), а число есть в меню «Статистика и лимиты»
//    (надписи сверяем через I18N — язык в тестах зависит от окружения);
//  - скачивание сразу прибавляет к числу на экране и через пару секунд
//    одним POST-запросом (без предварительного OPTIONS) уходит на воркер;
//  - если воркер счётчика не знает (старая версия), строки просто нет.
const { buildPage, sleep } = require("../harness");

(async () => {
  let ok = true;
  const fail = (msg) => { console.error("FAIL:", msg); ok = false; };

  // Старый воркер: /stats/downloads отвечает 404 — счётчика не видно, ошибок нет.
  {
    const { window: win, document: doc } = await buildPage({
      providerBehavior: { downloads: { status: 404, errorBody: { error: "not found" } } },
    });
    win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
    await sleep(80);
    if (!doc.getElementById("homeCounter").hidden) fail("при старом воркере (404) строка счётчика не должна показываться");
    doc.getElementById("insightsToggle").click();
    if (/Picta/.test(doc.getElementById("insightsPanel").textContent)) fail("при старом воркере в статистике не должно быть общего счётчика");
  }

  const { window: win, document: doc } = await buildPage();
  win.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, err && err.stack); ok = false; };
  const $ = (id) => doc.getElementById(id);
  await sleep(80);

  const t = (k) => win.I18N.t(k);
  const num = (n) => n.toLocaleString(t("locale"));
  const homeText = () => $("homeCounter").textContent.replace(/\s+/g, " ");
  console.log("Главная:", homeText());
  if ($("homeCounter").hidden) fail("на главной не видно общего счётчика скачиваний");
  if (!homeText().includes(`${t("downloads_total")}: ${num(1234)}`)) fail(`на главной неверный текст счётчика: "${homeText()}"`);

  // Поиск: главный экран уходит, счётчик — в «Статистике и лимитах».
  $("searchInput").value = "cat";
  $("searchForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(150);
  if (doc.body.classList.contains("is-home")) fail("после поиска body остался в режиме главной — счётчик не спрячется");
  $("mainMenuToggle").click();
  $("insightsToggle").click();
  const panel = () => $("insightsPanel").textContent.replace(/\s+/g, " ");
  const openInsights = () => {
    if ($("mainMenu").hidden) $("mainMenuToggle").click();
    if ($("insightsPanel").hidden) $("insightsToggle").click();
  };
  if (!panel().includes(`${t("downloads_total")}${num(1234)}`)) fail(`в «Статистике» нет общего счётчика: "${panel()}"`);
  if (!panel().includes(t("insights_downloads"))) fail("в «Статистике» пропала личная строка скачиваний");

  // Скачивание: +1 сразу на экране, через ~2 с один POST на воркер.
  const posts = [];
  const mockFetch = win.fetch;
  win.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/stats/downloads") && opts.method === "POST") {
      posts.push(opts);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ downloads: 5000 }) });
    }
    if (/^https:\/\/x\//.test(u)) return Promise.resolve({ ok: true, status: 200, blob: async () => new win.Blob(["img"]) });
    return mockFetch(url, opts);
  };
  win.URL.createObjectURL = () => "blob:fake";
  win.URL.revokeObjectURL = () => {};

  doc.querySelector("#grid .card").click();
  await sleep(20);
  $("lbDownload").click();
  await sleep(50);
  $("lbDownload").click();
  await sleep(50);
  openInsights();
  console.log("После 2 скачиваний:", panel());
  if (!panel().includes(`${t("downloads_total")}${num(1236)}`)) fail(`число в «Статистике» не выросло сразу после скачиваний: "${panel()}"`);
  if (posts.length) fail("запрос на воркер ушёл сразу — скачивания должны копиться и уходить пачкой");

  await sleep(2300);
  console.log("POST на воркер:", posts.map((p) => p.body));
  if (posts.length !== 1) fail(`должен быть ровно один POST с пачкой скачиваний, а их ${posts.length}`);
  else {
    if (JSON.parse(posts[0].body).count !== 2) fail(`в пачке должно быть 2 скачивания: ${posts[0].body}`);
    if (posts[0].headers && /json/i.test(JSON.stringify(posts[0].headers))) fail("POST с Content-Type: application/json вызовет лишний запрос OPTIONS");
    if (!posts[0].keepalive) fail("POST счётчика без keepalive потеряется, если сразу закрыть вкладку");
  }
  await sleep(20);
  openInsights();
  if (!panel().includes(num(5000))) fail(`после ответа воркера число не обновилось до 5 000: "${panel()}"`);

  console.log(ok ? "\n=== TEST22 OK ===" : "\n=== TEST22 FAILED ===");
  if (!ok) process.exitCode = 1;
})().catch((err) => { console.error("EXCEPTION:", err); process.exit(1); });
