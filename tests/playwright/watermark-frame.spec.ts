import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { devices, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * admin「水印相框」e2e(docs/watermark-frame-plan.md §8):
 * 一条黄金路径「选图 → 导出 → 拿到 zip」,桌面与移动视口各跑一轮。
 *
 * 跑法:`pnpm exec playwright test --project=admin`(只起 admin 的 dev server,无后端)。
 * dev 下 basePath 是 "/"(见 apps/admin/modern.config.ts),所以 URL 直接用应用内路径。
 *
 * 为什么这两轮值得为一条 e2e 付钱:整条链路(清单装载 → 文件解码 → Worker 渲染 → fflate 打包
 * → anchor 下载)只有跑在真浏览器里才算数,Vitest 那边全是 jsdom 与绘制指令断言。
 */

// 首轮请求会触发 Modern.js 的冷编译,30s 的全局 timeout 不够用。
test.setTimeout(120_000);
test.use({ navigationTimeout: 60_000 });

const TEST_PHOTO_NAME = "e2e-photo.jpg";
const TEST_PHOTO_BASE_NAME = "e2e-photo";

/** 产物名口径见 utils/file-name 的 buildZipFileName:frame-export-YYYY-MM-DD.zip。 */
const ZIP_NAME_PATTERN = /^frame-export-\d{4}-\d{2}-\d{2}\.zip$/u;

const PIXEL_5 = devices["Pixel 5"];

// describe 里只能改 test 级选项(带 worker 级的 defaultBrowserType 会强制换 worker 而报错)。
const MOBILE_VIEWPORT_USE = {
  userAgent: PIXEL_5.userAgent,
  viewport: PIXEL_5.viewport,
  deviceScaleFactor: PIXEL_5.deviceScaleFactor,
  hasTouch: PIXEL_5.hasTouch,
  isMobile: PIXEL_5.isMobile
};

/**
 * 造一张测试照片:让页面里的 canvas 现编一张 JPEG,再把 data URL 取回 Node 侧喂给 input。
 *
 * 为什么不在仓库里放一张 fixture 图:e2e 要的是「能被 createImageBitmap 解码、带真实宽高」的
 * 合法 JPEG,手写 base64 常量既占地方又没人能一眼看出它到底是几张像素;canvas 现编想换尺寸
 * 就改下面那两个数字。
 */
async function createTestPhoto(page: Page): Promise<{
  name: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("测试环境没有 2d canvas");
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#1f6feb");
    gradient.addColorStop(1, "#f5f5f5");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  });

  const base64 = dataUrl.split(",")[1] ?? "";
  return { name: TEST_PHOTO_NAME, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

/** 走完一次导出并校验落盘的 zip:两轮视口共用同一条断言链,差异只在 test.use 的设备预设。 */
async function runExportGoldenPath(page: Page): Promise<void> {
  // `/` 只做重定向(D14),顺带验一次它落到相框列表。
  await page.goto("/");
  await expect(page).toHaveURL(/\/frames$/u);

  // 清单是运行时同源取 public/frames.json:卡片出现即装载成功。
  const frameCards = page.getByRole("link", { name: "去导出" });
  await expect(frameCards.first()).toBeVisible();
  await frameCards.first().click();

  await expect(page).toHaveURL(/\/frames\/[^/]+\/export$/u);
  // 样式名回显:确认落地的是清单里的某一款,而不是 404 守卫页。
  await expect(page.getByText("相框样式:", { exact: false })).toBeVisible();

  const photoInput = page.locator('.image-picker-upload input[type="file"]');
  await photoInput.setInputFiles(await createTestPhoto(page));
  await expect(page.getByText("已选 1 张", { exact: false })).toBeVisible();
  // 列表项展示的是消毒后的主名(不含扩展名)。
  await expect(page.getByText(TEST_PHOTO_BASE_NAME, { exact: false })).toBeVisible();

  // 下载由流水线末尾的 anchor.click() 触发,事件必须在点击前挂上。
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();

  await expect(page.getByText("导出完成", { exact: false })).toBeVisible({ timeout: 60_000 });
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(ZIP_NAME_PATTERN);

  const savedAt = await download.path();
  if (!savedAt) throw new Error("下载没有落盘:download.path() 返回空。");
  const zipBytes = await readFile(savedAt);
  // 非空 + ZIP 魔数 "PK":证明拿到的不是错误页/blob 空引用。
  expect(zipBytes.byteLength).toBeGreaterThan(22);
  expect(zipBytes.subarray(0, 2).toString("latin1")).toBe("PK");
  // zip 用 STORE(fflate ZipPassThrough),条目名是明文:在主名里找得到刚导出那张照片。
  expect(zipBytes.includes(Buffer.from(TEST_PHOTO_BASE_NAME, "utf8"))).toBe(true);
}

test.describe("水印相框导出主链路(桌面视口)", () => {
  test("选图 → 导出 → 拿到 zip", async ({ page }) => {
    await runExportGoldenPath(page);
  });
});

test.describe("水印相框导出主链路(移动视口)", () => {
  // Pixel 5 预设(去掉 worker 级的 defaultBrowserType,describe 里不许改它)带 Mobile UA +
  // isMobile,命中 useIsMobile() 分支:抽屉壳、单列表单、「选择照片」按钮式触发区,
  // 以及 Worker 池的移动端内存预算(并发更低)。
  test.use(MOBILE_VIEWPORT_USE);

  test("选图 → 导出 → 拿到 zip", async ({ page }) => {
    await runExportGoldenPath(page);
  });
});

test.describe("Pages 深链 404 兜底(D11 / 阶段 17)", () => {
  // 真机语义:GitHub Pages 无 rewrite,深链刷新返回 404 状态码 + 404.html(与 index.html
  // 同字节),靠绝对资源前缀让 SPA 接管。dev server 没有这个语义,所以直接对 Pages 构建
  // 产物起一个仿真静态服务来验。产物不存在(还没跑 Pages 构建)时跳过而不是假绿。
  const artifact = "/tmp/admin-build-check/pages-live";
  test.skip(
    !existsSync(`${artifact}/404.html`),
    "缺 Pages 产物快照:先跑 GITHUB_PAGES_BASE_PATH=/photo-watermark pnpm --filter @monorepo-template/admin build && cp -R apps/admin/dist /tmp/admin-build-check/pages-live && cp apps/admin/dist/index.html /tmp/admin-build-check/pages-live/404.html"
  );

  test("404 状态码下 SPA 接管深链路由", async ({ page }) => {
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".woff2": "font/woff2",
      ".svg": "image/svg+xml"
    };
    const server = createServer(async (req, res) => {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = url.startsWith("/photo-watermark")
        ? url.slice("/photo-watermark".length) || "/"
        : url;
      try {
        const body = await readFile(artifact + rel);
        res.writeHead(200, {
          "content-type": mime[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream"
        });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/html" });
        res.end(await readFile(`${artifact}/404.html`));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await page.goto(
        `http://127.0.0.1:${port}/photo-watermark/frames/plain-frame/export`
      );
      expect(response?.status()).toBe(404);
      await expect(page.getByText("相框样式:", { exact: false })).toBeVisible();
      await expect(page).toHaveURL(/\/photo-watermark\/frames\/plain-frame\/export$/u);
    } finally {
      server.close();
    }
  });
});
