// AppFooter 组件用例:版权文案来自 constants,年份写死以保证断言确定。
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import AppFooter from "../../src/components/app-footer";
import { COPYRIGHT_TEXT } from "../../src/constants";

afterEach(cleanup);

test("渲染版权文案(© + 年份 + 主体),容器为 app-footer", () => {
  const { container } = render(<AppFooter />);

  const footer = container.querySelector(".app-footer");
  expect(footer).not.toBeNull();
  expect(footer?.textContent).toContain("©");
  expect(footer?.textContent).toContain("2026");
  expect(footer?.textContent).toBe(COPYRIGHT_TEXT);
});
