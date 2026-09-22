// 特性开关配置坑(方案见 docs/site-shell-plan.md 阶段 3.1):开关只由 env 派生,不含业务
// 语义;新开关在此集中声明,消费方统一读 readFeatureFlags,禁止在业务代码散判 env。
import { siteEnv, type SiteEnv } from "./env";

export interface FeatureFlags {
  /** ARMS RUM 上报;RUM_ENDPOINT/RUM_PID 任一缺失强制 false(对齐根 AGENTS.md 规则 21)。 */
  rum: boolean;
  /** 自定义埋点上报;TRACK_ENDPOINT 未配置时整体 no-op(docs/site-shell-plan.md 决策 2)。 */
  tracking: boolean;
  /** 接口幂等 GET 重试(docs/site-shell-plan.md 决策 5);默认开启,无 env 槽位。 */
  retry: boolean;
}

// 从类型化 env 派生开关;默认用启动校验过的 siteEnv,测试可注入 SiteEnv。
export function readFeatureFlags(env: SiteEnv = siteEnv): FeatureFlags {
  return {
    rum: env.rumEndpoint !== "" && env.rumPid !== "",
    tracking: env.trackEndpoint !== "",
    retry: true
  };
}
