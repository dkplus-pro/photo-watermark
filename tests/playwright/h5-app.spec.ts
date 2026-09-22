import { expect, test } from "@playwright/test";

// h5 首组 e2e(移动视口,docs/h5-shell-plan.md §4):SSR 数据链路硬证据——
// 首页 message 来自 Go server 的 /api/h5/ping(SSR loader),壳组件渲染正常。
// 用例运行于 playwright.config.ts 的 "h5" project(18082,H5_API_BASE 指向 e2e server)。

test.describe("h5 首页(SSR 数据链路)", () => {
  test("渲染 ping 返回的 message(移动视口)", async ({ page }) => {
    await page.goto("/");

    // SSR loader 成功:ShareHeader 渲染服务端 message
    await expect(page.getByText("pong from h5 api")).toBeVisible();
    // 壳结构:副标题占位文案可见
    await expect(page.getByText("活动 H5 占坑页", { exact: false })).toBeVisible();
    // 降级视图不应出现
    await expect(page.getByText("服务暂不可用,请稍后重试")).toHaveCount(0);
  });

  test("移动视口下横向无溢出", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
