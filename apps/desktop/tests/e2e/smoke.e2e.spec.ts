// e2e 冒烟(docs/desktop-shell-plan.md §4 阶段 3):_electron.launch 打 out/ 构建产物
// 起真实窗口,断言窗口标题 + 壳结构(Home 的 h1)+ window.desktop 桥存在。
// D3 卡不执行构建:产物缺失时整文件 skip,静态绿;收口卡(D4)build 后即实跑。
import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test, _electron as electron } from "@playwright/test";

const mainEntry = join(__dirname, "../../out/main/index.js");
const rendererEntry = join(__dirname, "../../out/renderer/index.html");

test.skip(
  !existsSync(mainEntry) || !existsSync(rendererEntry),
  "需先 build:pnpm --filter @monorepo-template/desktop build(产出 out/{main,preload,renderer})"
);

test("启动真实窗口:标题、首页壳结构、window.desktop 桥存在", async () => {
  const app = await electron.launch({ args: [mainEntry] });
  try {
    const win = await app.firstWindow();

    // 窗口标题来自渲染层 index.html 的 <title>(BrowserWindow 未覆写 title)。
    await expect(win).toHaveTitle("CMS Desktop");

    // 壳结构:Home 页 h1(渲染层已挂载;ping 文案依赖 API 联调,冒烟不依赖 server)。
    await expect(win.locator("h1")).toHaveText("CMS Desktop");

    // preload 桥:contextBridge 暴露的 window.desktop 已注入。
    const bridgeReady = await win.evaluate(
      () => typeof window.desktop === "object" && window.desktop !== null
    );
    expect(bridgeReady).toBe(true);
  } finally {
    await app.close();
  }
});
