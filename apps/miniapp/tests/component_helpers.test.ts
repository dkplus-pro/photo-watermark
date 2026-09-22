// 骨架屏/图片组件纯逻辑边界(方案 §5 阶段 4b;六类边界:空值/零值/越界):
// 行数规范化、类名拼接、SafeImage 兜底判定。组件渲染极薄,逻辑全部抽出可测。
import { describe, expect, it } from "vitest";

import { normalizeRows, rowClassName } from "../src/component/skeleton-logic";
import { shouldUseFallback } from "../src/component/safe-image-logic";

describe("normalizeRows(行数规范化)", () => {
  it("undefined/0/负数/NaN 回退 1(空值与零值边界)", () => {
    for (const rows of [undefined, 0, -3, Number.NaN]) {
      expect(normalizeRows(rows)).toBe(1);
    }
  });
  it("正整数保留,小数向下取整,超过 12 截断(越界边界)", () => {
    expect(normalizeRows(5)).toBe(5);
    expect(normalizeRows(5.9)).toBe(5);
    expect(normalizeRows(100)).toBe(12);
  });
});

describe("rowClassName(类名拼接)", () => {
  it("单行无首尾修饰", () => {
    expect(rowClassName(0, 1)).toBe("skeleton-row");
  });
  it("多行首尾各有修饰类", () => {
    expect(rowClassName(0, 3)).toBe("skeleton-row skeleton-row--first");
    expect(rowClassName(1, 3)).toBe("skeleton-row");
    expect(rowClassName(2, 3)).toBe("skeleton-row skeleton-row--last");
  });
});

describe("shouldUseFallback(SafeImage 兜底判定)", () => {
  it("空串/纯空白/undefined 直接兜底,不发起加载", () => {
    expect(shouldUseFallback("")).toBe(true);
    expect(shouldUseFallback("   ")).toBe(true);
    expect(shouldUseFallback(undefined)).toBe(true);
  });
  it("合法 src 不兜底", () => {
    expect(shouldUseFallback("https://cdn.example.com/a.png")).toBe(false);
  });
});
