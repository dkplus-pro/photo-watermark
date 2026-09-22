// 阿里云 ARMS 用户体验监控 RUM 初始化(规范见 docs/site.md「监控」)。
//
// 约束:
// - 仅客户端:SSR 服务端不执行(import 由 `typeof window` 守卫);
// - 动态 import:SDK 不阻塞首屏,也避免与 SSR 构建耦合;
// - env `RUM_ENDPOINT` 与 `RUM_PID` 任一缺失即不初始化——dev 默认关闭,
//   生产部署注入(占位见 apps/site/.env.example);
// - spaMode history(SPA PV 上报),version 取应用版本;
// - 客户端 bundle 里不存在 Node 的 process:默认 env 由 ./env 的 defaultEnv() 按成员访问
//   process.env.RUM_* 提供,该表达式由 modern.config.ts 的 source.define 构建期内联为
//   字面量(未配置为空串);SSR/测试下读真实 process.env(vi.stubEnv 可覆盖);
// - env 读取与校验收口在 ./env,rum 开关派生在 ./features,本文件只负责 SDK 初始化编排。
import { useEffect } from "react";

import packageJson from "../../package.json";

import { defaultEnv } from "./env";

export interface RumConfig {
  pid: string;
  endpoint: string;
  version: string;
}

// 从环境读取 RUM 配置;endpoint 与 pid 缺任一项返回 null(不初始化)。
export function readRumConfig(
  env: Record<string, string | undefined> = defaultEnv()
): RumConfig | null {
  const pid = env.RUM_PID;
  const endpoint = env.RUM_ENDPOINT;
  if (!pid || !endpoint) {
    return null;
  }
  return { pid, endpoint, version: packageJson.version };
}

interface RumSdk {
  init: (options: { pid: string; endpoint: string; version?: string; spaMode?: string }) => unknown;
}

// 初始化 RUM;返回是否真正初始化(供测试断言)。幂等:重复调用不重复初始化。
let initialized = false;

export async function initRum(
  env: Record<string, string | undefined> = defaultEnv()
): Promise<boolean> {
  const config = readRumConfig(env);
  // SSR 服务端或配置缺失:不初始化。
  if (typeof window === "undefined" || !config || initialized) {
    return false;
  }
  try {
    const mod = (await import("@arms/rum-browser")) as unknown as {
      default?: RumSdk;
    } & RumSdk;
    const sdk: RumSdk | undefined = mod.default ?? mod;
    if (!sdk?.init) {
      console.error("RUM SDK 加载异常,跳过初始化");
      return false;
    }
    sdk.init({
      pid: config.pid,
      endpoint: config.endpoint,
      version: config.version,
      spaMode: "history"
    });
    initialized = true;
    return true;
  } catch (error) {
    // SDK 加载失败只记日志,不影响站点功能。
    console.error("RUM 初始化失败", error);
    return false;
  }
}

// 根布局客户端侧挂载时调用(useEffect 在 SSR 不执行,天然仅客户端)。
export function useRum(): void {
  useEffect(() => {
    void initRum();
  }, []);
}
