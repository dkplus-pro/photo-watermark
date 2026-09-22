// 产物体积预算检查(方案 docs/site-shell-plan.md §2 决策 3):
// 对 dist/static 客户端资产做 gzip 体积汇总,与 config/budgets.json 比较,超限退出码 1。
// 预算是配置坑:调预算改 config/budgets.json 并在提交说明里写理由,不在脚本里硬编码。
// 用法:node scripts/check-budgets.mjs [--dist <distDir>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const distArgIdx = process.argv.indexOf("--dist");
const distDir = resolve(
  distArgIdx > -1 ? process.argv[distArgIdx + 1] : join(repoRoot, "dist", "static")
);
const budget = JSON.parse(readFileSync(join(repoRoot, "config", "budgets.json"), "utf8"));

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
  console.error(`[check-budgets] 无法读取构建产物目录 ${distDir}:先执行 build`);
  process.exit(1);
}

const gzipKbBy = (files, ext) =>
  Math.round(
    files
      .filter((f) => f.endsWith(ext))
      .reduce((total, f) => total + gzipSync(readFileSync(f)).length, 0) / 1024
  );

const results = [
  { name: "jsTotalGzipKb", actual: gzipKbBy(files, ".js") },
  { name: "cssTotalGzipKb", actual: gzipKbBy(files, ".css") }
];

let failed = false;
for (const { name, actual } of results) {
  const limitKb = budget[name];
  if (typeof limitKb !== "number") {
    continue;
  }
  const ok = actual <= limitKb;
  console.info(`[check-budgets] ${name}: ${actual} kB / 预算 ${limitKb} kB ${ok ? "✓" : "✗ 超限"}`);
  if (!ok) {
    failed = true;
  }
}

if (failed) {
  console.error("[check-budgets] 产物超预算:确有增量需求时先调 config/budgets.json 并说明理由");
  process.exit(1);
}
console.info("[check-budgets] 全部通过");
