// core/monitor:错误/消息上报统一出口(方案 docs/h5-shell-plan.md §3)。
//
// 依赖方向硬规则(方案 §3,后续落 apps/h5/AGENTS.md):
// - core → config 允许;core 禁止 import routes/store;
// - 业务代码(routes/component)只允许经本目录导出的接口使用监控上报,
//   禁止直接 import @arms/rum-browser。
import { features } from "../../config/feature";

import { createArmsReporter } from "./arms";
import { noopReporter } from "./noop";

/** 上报载荷:kind 区分事件类别(错误/资源/白屏等),message 写人话,stack/extra 可缺省。 */
export interface ReportPayload {
  kind: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/** 监控上报接口:默认实现为 arms.ts(@arms/rum-browser,见 docs/h5-shell-plan.md 阶段 2.A)。 */
export interface Reporter {
  captureError(payload: ReportPayload): void;
  captureMessage(payload: ReportPayload): void;
}

export { noopReporter };
// capture(全局捕获接线)同属本模块公开 API:业务侧统一从 core/monitor 导入。
export { installGlobalCapture } from "./capture";

// ARMS 实现单例:懒初始化(首次捕获才动态加载 SDK),模块加载零副作用、SSR 安全;
// endpoint/pid/采样率经 config/env + config/feature 注入,SDK 加载失败内部降级 noop。
const armsReporter: Reporter = createArmsReporter();

// 当前实例选择逻辑:未启用或 SSR/Node 环境返回 noop,业务侧拿到的 Reporter 恒可用、
// 无需判空;客户端且监控启用时返回 ARMS 实现体(ARMS 仅客户端初始化)。
export function getReporter(): Reporter {
  if (!features.monitor || typeof window === "undefined") {
    return noopReporter;
  }
  return armsReporter;
}
