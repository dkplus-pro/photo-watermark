import { expect, test } from "@playwright/test";

// h5 降级变体 e2e:webServer 的 H5_API_BASE 指向死端口(见 playwright.config.ts
// "h5-fallback" project),SSR loader 请求失败自捕获降级为 null,页面渲染降级文案。
// 验证 loader 降级契约(docs/h5-shell-plan.md §3 稳定性:SSR 失败不阻断渲染)。

test.describe("h5 首页(SSR 失败降级)", () => {
  test("API 不可达时渲染降级文案而非白屏", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("服务暂不可用,请稍后重试")).toBeVisible();
    // 壳仍完整:错误视图描述与页面壳可见
    await expect(page.getByText("首页数据(/api/h5/ping)加载失败,请稍后重试。")).toBeVisible();
    // 成功态副标题不应出现
    await expect(page.getByText("活动 H5 占坑页", { exact: false })).toHaveCount(0);
  });
});
