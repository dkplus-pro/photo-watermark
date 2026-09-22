// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

// useUiStore(移动端菜单开合)状态机;纯客户端逻辑,node 环境即可。
import { useUiStore } from "../../src/store/ui";

describe("useUiStore", () => {
  beforeEach(() => {
    useUiStore.setState({ mobileMenuOpen: false });
  });

  it("初始关闭", () => {
    expect(useUiStore.getState().mobileMenuOpen).toBe(false);
  });

  it("toggleMobileMenu 开合切换", () => {
    useUiStore.getState().toggleMobileMenu();
    expect(useUiStore.getState().mobileMenuOpen).toBe(true);
    useUiStore.getState().toggleMobileMenu();
    expect(useUiStore.getState().mobileMenuOpen).toBe(false);
  });

  it("setMobileMenuOpen 显式置开/关", () => {
    useUiStore.getState().setMobileMenuOpen(true);
    expect(useUiStore.getState().mobileMenuOpen).toBe(true);
    useUiStore.getState().setMobileMenuOpen(false);
    expect(useUiStore.getState().mobileMenuOpen).toBe(false);
  });
});
