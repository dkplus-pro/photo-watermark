// miniapp 配置唯一入口:多环境表(dev / test / prod)+ 环境选择 + 构建期常量的安全读取。
// 小程序运行时没有"同源"概念,wx.request 只接受绝对地址,API_BASE_URL 只能写绝对地址;
// 开发期直连本机(http://localhost:18085)时,微信开发者工具需勾选
// 「详情 → 本地设置 → 不校验合法域名、web-view(业务域名)、TLS 版本以及 HTTPS 证书」才能访问。
// 环境差异一律写在本文件的环境表里,业务与 core 代码禁止散落 process.env 判断
// (见 docs/miniapp-shell-plan.md §3.4、§4 配置坑清单)。

import type { AppConfig, AppEnv } from "./types";

/** dev:本地联调,`taro build --type weapp --watch`(NODE_ENV=development) */
const devEnv: AppConfig = {
  API_BASE_URL: "http://localhost:18085",
  MONITOR_ENDPOINT: "",
  TRACK_ENDPOINT: "",
  MONITOR_SAMPLE_RATE: 1,
  TRACK_SAMPLE_RATE: 1,
  MONITOR_ENABLED: true,
  TRACK_ENABLED: true
};

/** test:测试环境,`taro build --type weapp --env test`(NODE_ENV=test) */
const testEnv: AppConfig = {
  // 占坑期与 dev 同址,测试环境域名部署后替换
  API_BASE_URL: "http://localhost:18085",
  // 空串 = 禁用 HTTP sink(server 侧 /track、/error 端点落地后填入即启用)
  MONITOR_ENDPOINT: "",
  TRACK_ENDPOINT: "",
  MONITOR_SAMPLE_RATE: 1,
  TRACK_SAMPLE_RATE: 1,
  MONITOR_ENABLED: true,
  TRACK_ENABLED: true
};

/** prod:生产,`taro build --type weapp`(NODE_ENV=production) */
const prodEnv: AppConfig = {
  // 占坑期与 dev 同址,接入网关后替换为正式域名(并在微信后台配置合法域名)
  API_BASE_URL: "http://localhost:18085",
  // 空串 = 禁用 HTTP sink(server 侧端点落地后填入即启用)
  MONITOR_ENDPOINT: "",
  TRACK_ENDPOINT: "",
  MONITOR_SAMPLE_RATE: 1,
  TRACK_SAMPLE_RATE: 1,
  MONITOR_ENABLED: true,
  TRACK_ENABLED: true
};

/** 环境表全集:新增环境时同步 AppEnv(src/config/types.ts),否则此处类型报错 */
export const envConfigs: Record<AppEnv, AppConfig> = {
  dev: devEnv,
  test: testEnv,
  prod: prodEnv
};

/** 兜底环境:未注入 NODE_ENV 或取值未知时用 dev——宁可打到本地,也不误连生产 */
export const DEFAULT_APP_ENV: AppEnv = "dev";

/** Taro / Node 的 NODE_ENV 取值 → 环境表键(构建期由 webpack DefinePlugin 内联,运行时零分支开销) */
const APP_ENV_BY_NODE_ENV: Record<string, AppEnv> = {
  development: "dev",
  test: "test",
  production: "prod"
};

/**
 * 环境选择(按 Taro 工程惯例,以 process.env.NODE_ENV 为准):
 * - `development`(--watch 开发构建)→ dev;
 * - `test`(--env test 构建、vitest 单测)→ test;
 * - `production`(默认 build)→ prod;
 * - 其余(含未注入)→ DEFAULT_APP_ENV(dev)。
 * process.env.TARO_ENV 只表达编译目标平台(weapp/h5/...),不参与环境表选择。
 * 参数仅供单测注入,业务代码不要传参。
 */
export function resolveAppEnv(nodeEnv: string | undefined = process.env.NODE_ENV): AppEnv {
  return APP_ENV_BY_NODE_ENV[nodeEnv ?? ""] ?? DEFAULT_APP_ENV;
}

/** 当前生效的环境标识 */
export const appEnv: AppEnv = resolveAppEnv();

/** 当前生效的环境表 */
export const appConfig: AppConfig = envConfigs[appEnv];

// 兼容既有引用形态(src/api/client.ts 直接 `import { API_BASE_URL } from "../config"`),
// 其余键同风格导出,后续 core/monitor、core/track 直接用常量即可。
export const API_BASE_URL = appConfig.API_BASE_URL;
export const MONITOR_ENDPOINT = appConfig.MONITOR_ENDPOINT;
export const TRACK_ENDPOINT = appConfig.TRACK_ENDPOINT;
export const MONITOR_SAMPLE_RATE = appConfig.MONITOR_SAMPLE_RATE;
export const TRACK_SAMPLE_RATE = appConfig.TRACK_SAMPLE_RATE;
export const MONITOR_ENABLED = appConfig.MONITOR_ENABLED;
export const TRACK_ENABLED = appConfig.TRACK_ENABLED;

/** 应用版本号:构建期常量未注入(vitest 单测)时兜底,避免读取 __APP_VERSION__ 抛 ReferenceError */
export function getAppVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

/** 构建时刻(ISO 8601):构建期常量未注入(vitest 单测)时返回空串 */
export function getBuildTime(): string {
  return typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
}

export type { AppConfig, AppEnv } from "./types";
