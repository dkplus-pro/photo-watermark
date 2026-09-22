// miniapp 配置类型:环境表(src/config/index.ts)与构建期注入的全局常量都在此声明类型。
// 环境差异只允许收敛在 src/config/(见 docs/miniapp-shell-plan.md §3.4),
// 业务与 core 代码禁止散落 process.env 判断。

/** 环境标识:dev(本地联调)/ test(测试环境)/ prod(生产) */
export type AppEnv = "dev" | "test" | "prod";

/**
 * 环境表结构(三道坑,详见 docs/miniapp-shell-plan.md §4):
 * - endpoint 为空串 = 禁用对应 HTTP sink(降级到 console / 微信实时日志);
 * - 采样率取值 0~1,1 表示全量;
 * - 总开关为 false 时对应能力整体短路(不采集、不上报)。
 */
export interface AppConfig {
  /** API 基地址:小程序没有"同源"概念,wx.request 只接受绝对地址 */
  API_BASE_URL: string;
  /** 错误监控 HTTP sink 地址,空串 = 禁用 HTTP sink */
  MONITOR_ENDPOINT: string;
  /** 埋点 HTTP sink 地址,空串 = 禁用 HTTP sink */
  TRACK_ENDPOINT: string;
  /** 错误监控采样率,0~1 */
  MONITOR_SAMPLE_RATE: number;
  /** 埋点采样率,0~1 */
  TRACK_SAMPLE_RATE: number;
  /** 错误监控总开关 */
  MONITOR_ENABLED: boolean;
  /** 埋点总开关 */
  TRACK_ENABLED: boolean;
}

declare global {
  /**
   * 应用版本号,构建时由 Taro defineConstants 注入(读 apps/miniapp/package.json 的 version)。
   * 单测(vitest)环境不会注入该常量,读取请走 src/config/index.ts 的 getAppVersion() 兜底。
   */
  const __APP_VERSION__: string;
  /** 构建时刻(ISO 8601 字符串),构建时由 Taro defineConstants 注入,用于问题定位 */
  const __BUILD_TIME__: string;
}
