// 产物体积预算检查:h5 的构建产物(build 后的 dist/)按 JS/CSS 汇总,
// 与 size-budget.json 的预算比较,超限退出码 1(挂进 build 后检查)。
// 预算是配置坑:调预算改 size-budget.json 并在报告中说明理由,不在脚本里硬编码。
// 用法:node scripts/check-size.mjs [--dist <distDir>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const distArgIdx = process.argv.indexOf("--dist");
const distDir = resolve(
  distArgIdx > -1 ? process.argv[distArgIdx + 1] : join(repoRoot, "dist")
);
const budget = JSON.parse(
  readFileSync(join(repoRoot, "size-budget.json"), "utf8")
);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

let files;
try {
  files = walk(distDir);
} catch {
  console.error(`[check-size] 无法读取构建产物目录 ${distDir}:先执行 build`);
  process.exit(1);
}

const kb = bytes => Math.round(bytes / 1024);
const sumBy = (files, ext) =>
  files.filter(f => f.endsWith(ext)).reduce((total, f) => total + statSync(f).size, 0);

const results = [
  { name: "jsTotal", actual: sumBy(files, ".js") },
  { name: "cssTotal", actual: sumBy(files, ".css") },
  { name: "htmlTotal", actual: sumBy(files, ".html") }
];

let failed = false;
for (const { name, actual } of results) {
  const limitKb = budget[name]?.maxKb;
  if (typeof limitKb !== "number") {
    continue;
  }
  const actualKb = kb(actual);
  const ok = actualKb <= limitKb;
  console.info(
    `[check-size] ${name}: ${actualKb} kB / 预算 ${limitKb} kB ${ok ? "✓" : "✗ 超限"}`
  );
  if (!ok) {
    failed = true;
  }
}

if (failed) {
  console.error("[check-size] 产物超预算:确有增量需求时先调 size-budget.json 并说明理由");
  process.exit(1);
}
console.info("[check-size] 全部通过");
