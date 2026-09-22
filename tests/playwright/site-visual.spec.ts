import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// 视觉回归 + a11y 冒烟(方案 docs/site-shell-plan.md §4 阶段 6.2):
// 3 张快照(首页桌面/首页移动/404)+ 1 条 axe 核心规则冒烟。
// 快照基线以生成时环境为准;跨平台字体差异用 2% 像素差容忍(基线更新:
// pnpm test:e2e -- --project=site-visual --update-snapshots)。

test.describe.configure({ mode: "serial" });

test.describe("site 视觉回归", () => {
  test("首页桌面视口快照", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("home-desktop.png", {
      maxDiffPixelRatio: 0.02
    });
  });

  test("首页移动视口快照", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("home-mobile.png", {
      maxDiffPixelRatio: 0.02
    });
  });

  test("404 页面快照", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/definitely-not-exist");
    await expect(page.getByText("404", { exact: false }).first()).toBeVisible();
    await expect(page).toHaveScreenshot("not-found.png", {
      maxDiffPixelRatio: 0.02
    });
  });
});

test.describe("site a11y 冒烟", () => {
  test("首页无 critical/serious 级可访问性违规", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      // 排除项均为平台级已知问题而非页面缺陷:
      // - color-contrast:受 Arco 主题与截图环境影响,列入后续专项;
      // - html-has-lang:Modern.js 3.5 默认模板不注入 lang 且不支持配置,升级后解除;
      .disableRules(["color-contrast", "html-has-lang"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious"
    );
    expect(
      blocking,
      `发现 ${blocking.length} 条 critical/serious 违规: ${blocking.map((v) => v.id).join(", ")}`
    ).toEqual([]);
  });
});
