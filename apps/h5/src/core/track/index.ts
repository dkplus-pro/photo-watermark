// core/track:页面 PV 与自定义事件埋点统一出口(方案 docs/h5-shell-plan.md §3)。
//
// 依赖方向硬规则(同 core/monitor):core → config 允许;core 禁止 import routes/store;
// 业务代码只允许经本目录接口埋点,禁止直连上报 SDK/远端端点。
import { features } from "../../config/feature";

import { createArmsTracker } from "./arms";

/** 页面浏览参数:path 必填,referrer 可选,其余键为业务附加字段(随上报 properties 透传)。 */
export interface PageViewParams {
  path: string;
  referrer?: string;
  [key: string]: unknown;
}

/** 埋点接口:pageView 记页面浏览,event 记自定义事件。 */
export interface Tracker {
  pageView(params: PageViewParams): void;
  event(name: string, payload?: Record<string, unknown>): void;
}

export { consoleTracker, PAGE_VIEW_EVENT } from "./console";

// no-op 实现:未启用(TRACK_ENDPOINT 未配置)时丢弃一切埋点,幂等不抛错。
export const noopTracker: Tracker = {
  pageView: () => undefined,
  event: () => undefined
};

// 当前实例选择逻辑:未启用走 no-op;启用走 ARMS 远端上报,
// SDK 加载失败由 arms.ts 内部降级 console 本地观测(console 实现保留为兜底)。
export function getTracker(): Tracker {
  return features.track ? createArmsTracker() : noopTracker;
}
