import type { Reporter } from "./index";

// NoopReporter:监控未启用(monitor 特性关闭)或骨架阶段尚无默认实现时的空实现。
// 约定:所有调用幂等、不抛错、无副作用;调用方传空载荷/缺省可选项均安全。
export const noopReporter: Reporter = {
  captureError: () => undefined,
  captureMessage: () => undefined
};
