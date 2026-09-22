// 特性开关集中(方案 §3 config 分区):监控/埋点的启用判定与采样率透传。
//
// 启用语义与 site RUM 一致(docs/site.md「监控」):地址/pid 任一缺失即不启用,
// dev 默认关闭,生产部署在构建(CI)阶段注入(见 .env.example 与 modern.config.ts)。
import { env } from "./env";

export interface FeatureFlags {
  /** 错误监控上报:RUM_ENDPOINT 与 RUM_PID 齐全才启用。 */
  monitor: boolean;
  /** 业务埋点:TRACK_ENDPOINT 配置才启用(未启用时 core/track 走 no-op)。 */
  track: boolean;
  /** 监控采样率(0~1,env 解析与越界截断见 config/env.ts)。 */
  monitorSampleRate: number;
  /** 埋点采样率(0~1)。 */
  trackSampleRate: number;
}

// 只读开关:模块加载时按 env 求值一次,运行期不变。
export const features: Readonly<FeatureFlags> = {
  monitor: env.rumEndpoint !== "" && env.rumPid !== "",
  track: env.trackEndpoint !== "",
  monitorSampleRate: env.monitorSampleRate,
  trackSampleRate: env.trackSampleRate
};
