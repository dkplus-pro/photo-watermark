import { expect, test } from "@playwright/test";

// site e2e(docs/quality-and-site-plan.md 阶段 18):SSR 硬证据、双视口响应式冒烟、
// dev 不注入 RUM。site project 的 baseURL 指向 site dev(18081),后端为 e2e Go server
// (18085,e2e 库全新播种后站名即默认值「CMS 管理后台」)。
const SITE_NAME = "CMS 管理后台";

test.describe("SSR 硬证据", () => {
  // 禁用 JavaScript:页面仍渲染站名,证明内容来自服务端渲染而非客户端 hydration。
  test.use({ javaScriptEnabled: false });

  test("禁用 JS 的首页仍含站名与页头页脚", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-home-title")).toHaveText(SITE_NAME);
    await expect(page.locator(".site-name")).toHaveText(SITE_NAME);
    await expect(page.locator(".site-footer")).toContainText("© 2026 CMS Template");
  });

  test("未知路径渲染 404 兜底页(SSR)", async ({ page }) => {
    await page.goto("/definitely-not-exist");
    // Arco Result 的副标题在部分视口下可见性计算为 hidden,这里只断言 SSR 文本内容。
    await expect(page.locator(".arco-result-subtitle")).toHaveText("页面不存在或已被移除");
  });
});

test.describe("响应式双端冒烟", () => {
  test("桌面视口渲染横向导航,无汉堡按钮", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".site-nav")).toBeVisible();
    await expect(page.getByRole("button", { name: "打开导航" })).toHaveCount(0);
  });

  test("手机视口折叠为汉堡,抽屉可开合,布局不横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // 不横向溢出(scrollWidth 不超过视口宽)。
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);

    const trigger = page.getByRole("button", { name: "打开导航" });
    await expect(trigger).toBeVisible();

    // 打开抽屉 → 导航项出现。
    await trigger.click();
    const drawer = page.locator(".arco-drawer-wrapper");
    await expect(drawer).toBeVisible();
    await drawer.getByText("首页", { exact: true }).click();

    // 点导航项后抽屉收起(保留 DOM 但带 -hide 类)。
    await expect(drawer).toHaveClass(/arco-drawer-wrapper-hide/);
  });
});

test.describe("RUM(dev 默认关闭)", () => {
  test("dev 构建不发起 RUM 上报请求", async ({ page }) => {
    const rumRequests: string[] = [];
    page.on("request", (request) => {
      // ARMS/阿里云 RUM 上报域名;本地 chunk 名不含这些关键字。
      if (/aliyuncs\.com|\/arms/i.test(request.url())) {
        rumRequests.push(request.url());
      }
    });
    await page.goto("/");
    await expect(page.locator(".site-home-title")).toHaveText(SITE_NAME);
    expect(rumRequests).toEqual([]);
  });
});
