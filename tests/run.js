// Запускает каждый тест из tests/unit в отдельном процессе (у каждого свой
// jsdom) параллельно и печатает сводку. Код выхода 1, если упал хоть один.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "unit");
const only = process.argv.slice(2);
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".js") && (only.length === 0 || only.some((o) => f.includes(o))))
  .sort((a, b) => (parseInt(a.replace(/\D+/g, ""), 10) || 0) - (parseInt(b.replace(/\D+/g, ""), 10) || 0));

function run(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(dir, file)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      const failed = code !== 0 || /\bFAIL\b|EXCEPTION|WINDOW ERROR:/.test(out);
      resolve({ file, failed, out, ms: Date.now() - started });
    });
  });
}

// Тесты завязаны на реальные задержки (setTimeout в моках источников) —
// если запустить все разом, машина перегружается и узкие окна времени в
// них "съезжают". Поэтому одновременно не больше CONCURRENCY процессов.
const CONCURRENCY = Number(process.env.TEST_CONCURRENCY || 3);

async function runAll() {
  const results = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      results[i] = await run(files[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return results;
}

(async () => {
  const results = await runAll();
  let failed = 0;
  for (const r of results) {
    console.log(`${r.failed ? "✗" : "✓"} ${r.file} (${(r.ms / 1000).toFixed(1)}s)`);
    if (r.failed) {
      failed++;
      console.log(r.out.split("\n").map((l) => "    " + l).join("\n"));
    }
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
