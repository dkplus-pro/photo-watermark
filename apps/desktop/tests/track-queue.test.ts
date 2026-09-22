// sdk/track 批量队列(docs/desktop-shell-plan.md §4 阶段 3):
// 满批阈值自动整批发送 / 未满批不自动发送 / 无桥降级静默丢弃 / 开关关闭整体 no-op。
// 队列与开关是模块级状态且在 import 期定格,故每个用例 vi.resetModules() + vi.doMock(config)
// + 动态 import 拿全新模块(快照式注入 rendererEnv);桥用 window.desktop 桩断言。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../src/renderer/src/sdk/bridge";

// 与 src/renderer/src/sdk/track.ts 的 FLUSH_BATCH_SIZE 对齐(模块内私有,不导出)。
const FLUSH_BATCH_SIZE = 10;

type TrackMock = ReturnType<typeof vi.fn<(payload: unknown) => Promise<boolean>>>;

// window.desktop 桥替身:只关心 report.track,其余方法空实现。
// 用泛型签名 + 无参实现(等价于忽略入参),避免 unused 参数触发 no-unused-vars。
function makeBridge(): { bridge: DesktopBridge; track: TrackMock } {
  const track = vi.fn<(payload: unknown) => Promise<boolean>>(async () => true);
  const bridge: DesktopBridge = {
    report: {
      track,
      error: vi.fn(async () => true)
    },
    log: { write: vi.fn(async () => undefined) },
    theme: { get: vi.fn(async () => ({ dark: false })) },
    openExternal: vi.fn(async () => ({ ok: true }))
  };
  return { bridge, track };
}

// 重置模块注册表后按用例注入 rendererEnv 快照,再动态加载全新 track 模块。
// (不用顶层 vi.mock:工厂结果会被快照化,跨用例可变状态不可靠。)
async function loadTrackModule(env: { trackDisabled?: boolean; dev?: boolean } = {}) {
  vi.resetModules();
  vi.doMock("../src/renderer/src/config", () => ({
    rendererEnv: {
      apiBase: "",
      trackDisabled: env.trackDisabled ?? false,
      dev: env.dev ?? false
    }
  }));
  return import("../src/renderer/src/sdk/track");
}

beforeEach(() => {
  // 假定时器:拦住 scheduleFlush 的 5s 定时 flush,避免悬空定时器泄漏进其他用例。
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.desktop;
});

describe("track 批量队列", () => {
  it("未满批不自动发送;手动 flush 整批发出并清空队列", async () => {
    const { bridge, track } = makeBridge();
    window.desktop = bridge;
    const { flushTrackQueue, trackEvent } = await loadTrackModule();

    trackEvent("app.launch", { surface: "shell" });
    trackEvent("page_view", { path: "/" });
    expect(track).not.toHaveBeenCalled(); // 未达阈值只进队列,5s 定时 flush 尚未到期

    const sent = await flushTrackQueue();
    expect(sent).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith([
      { event: "app.launch", payload: { surface: "shell" }, ts: expect.any(Number) },
      { event: "page_view", payload: { path: "/" }, ts: expect.any(Number) }
    ]);

    // 队列已清空:再次 flush 无事发生(空值边界)。
    expect(await flushTrackQueue()).toBe(false);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("满批阈值自动整批发送,溢出后新事件重新攒批", async () => {
    const { bridge, track } = makeBridge();
    window.desktop = bridge;
    const { trackEvent } = await loadTrackModule();

    for (let i = 0; i < FLUSH_BATCH_SIZE; i++) {
      trackEvent("app.tick", { i });
    }
    expect(track).toHaveBeenCalledTimes(1);
    const batch = track.mock.calls[0]?.[0] as { event: string }[] | undefined;
    expect(batch).toHaveLength(FLUSH_BATCH_SIZE);

    // 阈值后的新事件进新一轮攒批,不重复触发发送。
    trackEvent("app.tick", { i: FLUSH_BATCH_SIZE });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("无桥降级:静默丢弃并 console.debug,不抛错", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    delete window.desktop; // 桥未注入(preload 缺失/测试环境)
    const { flushTrackQueue, trackEvent } = await loadTrackModule();

    trackEvent("app.launch");
    const sent = await flushTrackQueue();
    expect(sent).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("桥缺失"));
  });

  it("开关关闭(VITE_TRACK_DISABLED=true / dev 构建)时整体 no-op", async () => {
    const { bridge, track } = makeBridge();
    window.desktop = bridge;
    const { flushTrackQueue, trackEvent } = await loadTrackModule({ trackDisabled: true });

    trackEvent("app.launch");
    expect(await flushTrackQueue()).toBe(false); // queueEvent 已被门控拦截,队列为空
    expect(track).not.toHaveBeenCalled();
  });
});
