// core/perf:性能打点极简接口(方案 §3 占位:启动耗时标记、资源计时上报埋点)。
//
// 依赖方向硬规则(同 core/monitor):core → config 允许;core 禁止 import routes/store;
// 业务代码经本目录接口打点。
// TODO(阶段 2):提供基于 performance.now()/PerformanceMark 的真实实现与实例选择
// (SSR 下退化为 noop),本卡只落接口 + noop 默认实现。

/** 性能打点接口:mark 记里程碑,measure 返回自同名 mark 起的耗时(ms),未 mark 返回 undefined。 */
export interface Perf {
  mark(name: string): void;
  measure(name: string): number | undefined;
}

export { noopPerf } from "./noop";
