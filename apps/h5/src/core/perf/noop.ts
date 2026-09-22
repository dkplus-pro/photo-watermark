import type { Perf } from "./index";

// NoopPerf:性能打点空实现(阶段 2 真实实现接线前的兜底)。
// 约定:幂等不抛错,measure 恒返回 undefined(未记录任何里程碑)。
export const noopPerf: Perf = {
  mark: () => undefined,
  measure: () => undefined
};
