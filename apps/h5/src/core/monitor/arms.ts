import packageJson from "../../../package.json";
import { env } from "../../config/env";
import { features } from "../../config/feature";

import type { ReportPayload, Reporter } from "./index";

// ArmsReporter:@arms/rum-browser 远端错误上报实现(方案 docs/h5-shell-plan.md 阶段 2.A)。
//
// 约束(与 core/track/arms.ts 同口径):
// - 动态 import SDK,不进首屏依赖;SSR 端(typeof window === "undefined")不初始化;
// - RUM_ENDPOINT/RUM_PID 任一缺失不初始化(noop 语义;选择逻辑在 index.ts 未启用分支
//   回 noop,ensureSdk 内再做一次兜底判定,防直接调用穿透);
// - SDK 加载失败/模块形状异常:降级为 noop 语义,不抛错、不重试(避免反复拉取),
//   仅初始化失败时 error 日志一次;
// - 初始化幂等:实例级缓存加载 Promise,并发/重复捕获共享同一次加载;
// - 采样:sampleRate < 1 时按概率丢弃(与 track 口径一致),random 可注入;
//   被丢弃的事件不触发 SDK 加载(采样率 0 时零网络行为)。
// SDK 类型面:仅按结构断言使用(见 ./arms.d.ts),不依赖完整类型;
// 调用禁直连:业务代码只允许经 core/monitor 接口(方案 §3 依赖方向)。

/** 应用版本随 init 上报,ARMS 控制台按版本过滤(对齐 site rum.ts)。 */
const APP_VERSION = packageJson.version;

/** 采样随机源签名:生产用 Math.random,测试注入固定值。 */
export type RandomSource = () => number;

/** SDK 最小调用面(结构断言;完整模型见 @arms/rum-core Shell 与 ./arms.d.ts)。 */
export interface ArmsRumSdk {
  init: (config: {
    pid: string;
    endpoint: string;
    version?: string;
    spaMode?: string;
  }) => unknown;
  sendException?: (payload: {
    source?: string;
    type?: string;
    name?: string;
    message?: string;
    stack?: string;
  }) => void;
  sendCustom?: (payload: { type: string; name: string; group?: string; value: number }) => void;
}

/** SDK 加载器签名:默认动态 import,测试注入 fake SDK。 */
export type ArmsSdkLoader = () => Promise<ArmsRumSdk | null>;

export interface ArmsReporterOptions {
  /** ARMS 上报端点,缺省读 env.rumEndpoint。 */
  endpoint?: string;
  /** ARMS 应用 pid,缺省读 env.rumPid。 */
  pid?: string;
  /** 采样率 [0,1],缺省读 features.monitorSampleRate。 */
  sampleRate?: number;
  /** SDK 加载器注入点,缺省动态 import("@arms/rum-browser")。 */
  loadSdk?: ArmsSdkLoader;
  /** 采样随机源注入点,缺省 Math.random。 */
  random?: RandomSource;
}

// 采样判定:>=1 全过(含上越界),<=0 全丢(含下越界),(0,1) 区间 random() < rate 保留;
// 采样率越界截断在 config/env.ts 收口。与 core/track/arms.ts 的 isSampled 同口径,
// 不跨分区 import,保持 monitor/track 实现互不依赖。
export function isSampled(rate: number, random: RandomSource): boolean {
  if (rate >= 1) {
    return true;
  }
  if (rate <= 0) {
    return false;
  }
  return random() < rate;
}

// 默认 SDK 加载器:动态 import + 结构断言(default 导出优先,对齐 site rum.ts 的取法)。
// import 结果按 unknown 处理后断言,不依赖 SDK 完整类型(依赖未安装期间仅靠 ./arms.d.ts)。
async function defaultLoadSdk(): Promise<ArmsRumSdk | null> {
  const mod: unknown = await import("@arms/rum-browser");
  const candidate = (mod as { default?: unknown }).default ?? mod;
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }
  return candidate as ArmsRumSdk;
}

/** 创建 ARMS 远端上报 Reporter;SDK 加载器/采样随机源可注入(测试用),实例间状态隔离。 */
export function createArmsReporter(options: ArmsReporterOptions = {}): Reporter {
  const endpoint = options.endpoint ?? env.rumEndpoint;
  const pid = options.pid ?? env.rumPid;
  const sampleRate = options.sampleRate ?? features.monitorSampleRate;
  const random = options.random ?? Math.random;
  const loadSdk = options.loadSdk ?? defaultLoadSdk;

  // 实例级加载态:Promise 缓存保证初始化幂等;degraded 标记加载失败(不重试)。
  let sdkPromise: Promise<ArmsRumSdk | null> | null = null;

  // 初始化编排:env 缺失 / SSR 静默返回 null(noop 语义);加载失败降级,均不抛错。
  function ensureSdk(): Promise<ArmsRumSdk | null> {
    if (sdkPromise) {
      return sdkPromise;
    }
    sdkPromise = (async (): Promise<ArmsRumSdk | null> => {
      // endpoint/pid 任一缺失不初始化(兜底判定;正常路径由 getReporter 未启用分支回 noop)。
      if (endpoint === "" || pid === "") {
        return null;
      }
      // client-only:SSR 服务端不初始化(动态 import 由 typeof window 守卫,服务端永不触达)。
      if (typeof window === "undefined") {
        return null;
      }
      try {
        const sdk = await loadSdk();
        // loader 返回 null:其内部已判定不可用(默认加载器已记日志),此处静默降级。
        if (sdk === null) {
          return null;
        }
        if (
          typeof sdk.init !== "function" ||
          typeof sdk.sendException !== "function" ||
          typeof sdk.sendCustom !== "function"
        ) {
          console.error("[monitor] ARMS SDK 模块形状异常,错误监控降级为 no-op");
          return null;
        }
        await sdk.init({ pid, endpoint, version: APP_VERSION, spaMode: "history" });
        return sdk;
      } catch (error) {
        console.error("[monitor] ARMS SDK 加载失败,错误监控降级为 no-op", error);
        return null;
      }
    })();
    return sdkPromise;
  }

  // 转发:错误走 sendException(RumExceptionEvent),消息走 sendCustom(RumCustomEvent);
  // payload.extra 不映射:SDK 异常/自定义事件模型无扩展字段,上下文采集由 SDK 自身完成。
  function forward(sdk: ArmsRumSdk, payload: ReportPayload, kind: "error" | "message"): void {
    if (kind === "error") {
      sdk.sendException?.({
        source: "h5",
        type: "error",
        name: payload.kind,
        message: payload.message,
        stack: payload.stack
      });
      return;
    }
    sdk.sendCustom?.({ type: "message", name: payload.kind, group: payload.message, value: 1 });
  }

  async function dispatch(payload: ReportPayload, kind: "error" | "message"): Promise<void> {
    // 采样判定先于 SDK 加载:被丢弃的事件零网络行为(采样率 0 时连 SDK 都不加载)。
    if (!isSampled(sampleRate, random)) {
      return;
    }
    const sdk = await ensureSdk();
    if (sdk) {
      forward(sdk, payload, kind);
    }
    // sdk 为 null(env 缺失/SSR/降级):按 noop 语义静默丢弃,不抛错、不重试。
  }

  return {
    captureError: (payload) => {
      void dispatch(payload, "error");
    },
    captureMessage: (payload) => {
      void dispatch(payload, "message");
    }
  };
}
