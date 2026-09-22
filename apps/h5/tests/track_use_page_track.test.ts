// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePageTrack } from "../src/hooks/usePageTrack";

// usePageTrack 用例(jsdom + testing-library renderHook,照抄 admin hook 用例范式):
// 覆盖:挂载发一次 pageView(path 取 location.pathname)、额外 params 透传、
// rerender 不重发、卸载不追加调用且不抛错。
// core/track 打桩注入 tracker:SDK 初始化/采样/降级全部收口在 core/track 内部,hook 只消费 getTracker。

const trackState = vi.hoisted(() => ({
  pageView: vi.fn(),
  event: vi.fn()
}));

vi.mock("../src/core/track", () => ({
  getTracker: () => ({ pageView: trackState.pageView, event: trackState.event })
}));

describe("usePageTrack(页面 PV 自动埋点)", () => {
  beforeEach(() => {
    trackState.pageView.mockClear();
    trackState.event.mockClear();
  });

  it("挂载发一次 pageView,path 取 location.pathname", () => {
    window.history.pushState({}, "", "/lottery");
    renderHook(() => usePageTrack());
    expect(trackState.pageView).toHaveBeenCalledTimes(1);
    expect(trackState.pageView).toHaveBeenCalledWith({ path: "/lottery" });
    window.history.pushState({}, "", "/");
  });

  it("额外 params 透传到 pageView(零值字段原样保留)", () => {
    renderHook(() => usePageTrack({ campaign: "spring", slot: 0 }));
    expect(trackState.pageView).toHaveBeenCalledTimes(1);
    expect(trackState.pageView).toHaveBeenCalledWith({
      path: "/",
      campaign: "spring",
      slot: 0
    });
  });

  it("extra 缺省不抛错(空值边界)", () => {
    expect(() => renderHook(() => usePageTrack())).not.toThrow();
    expect(trackState.pageView).toHaveBeenCalledWith({ path: "/" });
  });

  it("rerender 不重复上报(挂载仅一次)", () => {
    const { rerender } = renderHook(() => usePageTrack());
    rerender();
    rerender();
    expect(trackState.pageView).toHaveBeenCalledTimes(1);
  });

  it("卸载不追加调用、不抛错(卸载行为幂等)", () => {
    const { unmount } = renderHook(() => usePageTrack());
    expect(trackState.pageView).toHaveBeenCalledTimes(1);
    expect(() => unmount()).not.toThrow();
    expect(trackState.pageView).toHaveBeenCalledTimes(1);
    expect(trackState.event).not.toHaveBeenCalled();
  });
});
