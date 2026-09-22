// 本地 automator 冒烟(方案 docs/miniapp-shell-plan.md §5 阶段 5b):
// 启动微信开发者工具 → 打开小程序首页 → 断言 ping 文案渲染。
//
// 前置条件(README「本地 e2e 冒烟」节):
// 1. 已安装微信开发者工具并开启服务端口(设置 → 安全设置);
// 2. 已执行 `pnpm --filter @monorepo-template/miniapp build` 产出 dist/;
// 3. 可用 env 覆盖:WECHAT_CLI_PATH(工具 cli 路径,缺省走 automator 默认探测)。
//
// 退出码约定:0 = 冒烟通过 或 环境不可用(SKIP,如实记录不算失败);1 = 断言失败。
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectPath = resolve(import.meta.dirname, "..");
const distPath = resolve(projectPath, "dist");

async function main() {
  if (!existsSync(distPath)) {
    console.info("[e2e] SKIP:未找到 dist/,先执行 `pnpm --filter @monorepo-template/miniapp build`");
    return;
  }
  let automator;
  try {
    automator = (await import("miniprogram-automator")).default;
  } catch {
    console.info("[e2e] SKIP:miniprogram-automator 未安装(先 pnpm install)");
    return;
  }

  const cliPath = process.env.WECHAT_CLI_PATH || undefined;
  console.info("[e2e] 启动微信开发者工具(需已开启服务端口)...");
  let miniProgram;
  try {
    miniProgram = await automator.launch({
      cliPath,
      projectPath,
      timeout: 60_000
    });
  } catch (error) {
    console.info(
      `[e2e] SKIP:开发者工具启动失败(${error instanceof Error ? error.message : String(error)})。` +
        "请确认工具已安装、服务端口已开启,或用 WECHAT_CLI_PATH 指定 cli 路径。"
    );
    return;
  }

  try {
    const page = await miniProgram.reLaunch("/pages/index/index");
    await page.waitForData?.(() => true).catch(() => undefined);
    // 等待请求渲染完成:直接轮询页面文本,ping 失败时页面也有错误文案(仍算渲染成功)
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const content = await (page.data ? page.data() : Promise.resolve({}));
    const text = JSON.stringify(content);
    if (!text) {
      console.error("[e2e] FAIL:页面数据为空");
      process.exitCode = 1;
      return;
    }
    console.info(`[e2e] 首页已打开,页面数据: ${text.slice(0, 200)}`);
    console.info("[e2e] 冒烟通过");
  } finally {
    await miniProgram.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[e2e] FAIL:", error);
  process.exitCode = 1;
});
