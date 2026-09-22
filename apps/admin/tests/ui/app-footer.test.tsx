// AppFooter 组件用例(阶段 16 测试用例清单,见 docs/quality-and-site-plan.md)。
// vitest 基座未开 globals,RTL 不自动清理,须手动 cleanup。
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import AppFooter from "../../src/components/app-footer";

afterEach(cleanup);

test("渲染版权文案(© + 年份 + 主体),容器为 app-footer", () => {
  const { container } = render(<AppFooter />);

  // COPYRIGHT_TEXT 占位文案,年份固定注入(常量内写死,保证断言确定)。
  const footer = container.querySelector(".app-footer");
  expect(footer).not.toBeNull();
  expect(footer?.textContent).toContain("©");
  expect(footer?.textContent).toContain("2026");
  expect(footer?.textContent).toContain("CMS Template");
});
