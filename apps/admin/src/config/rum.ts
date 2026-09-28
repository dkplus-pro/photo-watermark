// 腾讯云可观测平台 RUM(前端性能监控)PV/UV 统计接入。
// 本站唯一的出网请求就是它的上报,生产 CSP 的 connect-src 必须与 hostUrl 同步放行
// (见 modern.config.ts,漏放行 PV 会静默丢失)。规范见 apps/admin/AGENTS.md「静态化纪律」。
//
// 约束:
// - 仅生产环境初始化:dev 与单测(NODE_ENV=development/test)不上报,不污染线上数据;
// - 动态 import:SDK 不阻塞首屏,加载失败只记日志、不影响站点功能;
// - 只保留 PV/UV 与 JS 错误:本站无 API,接口/资源测速与 Web Vitals 等采集全部关闭,
//   上报量压到最小;
// - spa: true 走 history 路由钩子,页面切换自动补报 PV;UV 由 SDK 在 localStorage
//   生成的设备 aid 区分,匿名站无需业务侧用户标识;
// - gzip: false:SDK 的压缩 Worker 用 Blob URL 创建,会被生产 CSP 的 script-src 拦截,
//   PV/UV 载荷极小也无需压缩。
import { useEffect } from "react";

import packageJson from "../../package.json";

import type { WebConfig } from "aegis-web-sdk";

// 控制台「应用管理」的上报 ID(业务系统 rum-g5sgyVtEaj931a.demo / 应用 watermark);
// ID 本身随页面公开,防刷靠控制台的数据上报域名校验(填 GitHub Pages 线上域名)。
const RUM_REPORT_ID = "mZqg2ULvmmagqX9nYP";

// 上报域名默认 https://rumt-zh.com(SDK 内置);如改 hostUrl,modern.config.ts 的 CSP 同批改。
export interface RumEnv {
  nodeEnv?: string;
}

// 初始化 RUM;返回是否真正初始化(供测试断言)。幂等:重复调用不重复初始化。
let initialized = false;

export async function initRum(env: RumEnv = {}): Promise<boolean> {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  // 非生产环境(dev/单测)不初始化。
  if (typeof window === "undefined" || nodeEnv !== "production" || initialized) {
    return false;
  }
  try {
    const mod = await import("aegis-web-sdk");
    const Aegis = mod.default;
    const config: WebConfig = {
      id: RUM_REPORT_ID,
      version: packageJson.version,
      spa: true,
      reportApiSpeed: false,
      reportAssetSpeed: false,
      pagePerformance: false,
      webVitals: false,
      blankScreen: false,
      lagMonitor: false,
      memoryMonitor: false,
      gzip: false
    };
    new Aegis(config);
    initialized = true;
    return true;
  } catch (error) {
    console.error("RUM 初始化失败", error);
    return false;
  }
}

// 根布局挂载时调用:一次装配、全站生效,随 SPA 路由切换自动补报 PV。
export function useRum(): void {
  useEffect(() => {
    void initRum();
  }, []);
}
