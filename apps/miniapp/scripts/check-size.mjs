// 主包体积门禁:微信主包(不含分包)2MB 硬限制,>1.5MB 警告(配置坑在此文件顶部)。
// 检查对象:dist 下主包产物(排除分包目录);用法:node scripts/check-size.mjs
// 挂进 package.json 的 check:size script;构建后手动或 CI 执行。
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// 预算坑(字节):调整须在提交说明里写理由
const HARD_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB 微信硬限制
const WARN_LIMIT_BYTES = 1.5 * 1024 * 1024; // 1.5MB 警告线

const distDir = resolve(import.meta.dirname, "../dist");
const SUBPACKAGE_ROOTS = []; // 分包目录名(业务分包落地后在此登记,不计入主包)

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (SUBPACKAGE_ROOTS.includes(name)) continue;
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

let files;
try {
  files = walk(distDir);
} catch {
  console.error("[check-size] 无法读取 dist:先执行 taro build --type weapp");
  process.exit(1);
}

const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
const kb = Math.round(total / 1024);
console.info(`[check-size] 主包体积: ${kb} kB(硬限 ${Math.round(HARD_LIMIT_BYTES / 1024)} kB / 警告 ${Math.round(WARN_LIMIT_BYTES / 1024)} kB)`);

if (total > HARD_LIMIT_BYTES) {
  console.error("[check-size] 超过微信主包 2MB 硬限制:必须分包或瘦身");
  process.exit(1);
}
if (total > WARN_LIMIT_BYTES) {
  console.warn("[check-size] 超过 1.5MB 警告线:请评审分包与体积优化");
}
console.info("[check-size] 通过");
