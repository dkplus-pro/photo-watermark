import { env } from "../../config/env";
import { features } from "../../config/feature";

import { consoleTracker, PAGE_VIEW_EVENT } from "./console";
import type { Tracker } from "./index";

// ArmsTracker:@arms/rum-browser 远端上报实现(方案 docs/h5-shell-plan.md 阶段 2.B)。
//
// 约束:
// - 动态 import SDK,不进首屏依赖;SSR 端(typeof window === "undefined")不初始化;
// - TRACK_ENDPOINT 缺失不启用(选择逻辑在 index.ts 的 getTracker 未启用分支回 no-op,
//   loadSdk 内再做一次兜底判定,防直接调用穿透);
// - SDK 加载失败/模块形状异常:降级 console 本地观测(consoleTracker 兜底),不抛错;
// - 初始化幂等:模块级缓存加载 Promise,并发/重复调用共享同一次加载;
// - 采样:features.trackSampleRate < 1 时按概率丢弃,random 可注入便于测试;
//   被丢弃的事件不触发 SDK 加载(采样率 0 时零网络行为)。
// SDK 类型面:仅声明最小 API(见 ./arms-sdk.d.ts),调用处按 site rum.ts 的模式做结构断言。

/** 采样随机源签名:生产用 Math.random,测试注入固定值。 */
export type RandomSource = () => number;

export interface ArmsTrackerOptions {
  /** 采样随机源注入点,缺省 Math.random。 */
  random?: RandomSource;
}

/** ARMS 自定义事件载荷(仅本实现用到的最小字段,完整模型见 SDK 文档)。 */
type ArmsCustomEvent = {
  event_type: "custom";
  /** 事件类别:PV 固定 page_view;自定义事件取事件名。 */
  type: string;
  /** 事件名:PV 取页面 path;自定义事件取事件名。 */
  name: string;
  /** ARMS 自定义事件数值位,埋点无指标语义,固定 0。 */
  value: number;
  properties?: Record<string, unknown>;
};

type SendEventFn = (event: ArmsCustomEvent) => void;

/** SDK 最小调用面(结构断言,对齐 site rum.ts 的 RumSdk 模式)。 */
interface ArmsRumSdk {
  init: (config: { endpoint: string; spaMode?: string; version?: string }) => unknown;
  sendEvent?: SendEventFn;
}

// 采样判定:>=1 全过(含上越界截断),<=0 全丢(含下越界),(0,1) 区间 random() < rate 保留。
export function isSampled(rate: number, random: RandomSource): boolean {
  if (rate >= 1) {
    return true;
  }
  if (rate <= 0) {
    return false;
  }
  return random() < rate;
}

// SDK 加载态:Promise 与降级标记均为模块级单例,保证初始化幂等(失败不重试,避免反复拉取)。
let sdkPromise: Promise<SendEventFn | null> | null = null;
let degraded = false;

function loadSdk(): Promise<SendEventFn | null> {
  if (sdkPromise) {
    return sdkPromise;
  }
  sdkPromise = (async (): Promise<SendEventFn | null> => {
    // client-only:SSR 服务端不初始化(动态 import 由 typeof window 守卫,服务端永不触达)。
    if (typeof window === "undefined") {
      return null;
    }
    // endpoint 缺失不启用(兜底判定;正常路径由 getTracker 未启用分支回 no-op)。
    if (!features.track) {
      return null;
    }
    try {
      const mod = await import("@arms/rum-browser");
      const sdk = mod.default ?? (mod as unknown as ArmsRumSdk);
      const send = typeof mod.sendEvent === "function" ? mod.sendEvent : sdk.sendEvent;
      if (typeof sdk.init !== "function" || typeof send !== "function") {
        degraded = true;
        console.error("[track] ARMS SDK 模块形状异常,埋点降级为本地观测");
        return null;
      }
      sdk.init({ endpoint: env.trackEndpoint, spaMode: "history" });
      return send;
    } catch (error) {
      degraded = true;
      console.error("[track] ARMS SDK 加载失败,埋点降级为本地观测", error);
      return null;
    }
  })();
  return sdkPromise;
}

// 降级路径:SDK 异常时走 console 本地观测(consoleTracker 兜底),不抛错。
function fallbackToConsole(event: ArmsCustomEvent): void {
  if (event.type === PAGE_VIEW_EVENT) {
    consoleTracker.pageView({ path: event.name, ...(event.properties ?? {}) });
    return;
  }
  consoleTracker.event(event.type, event.properties);
}

async function dispatch(event: ArmsCustomEvent): Promise<void> {
  const send = await loadSdk();
  if (send) {
    send(event);
    return;
  }
  // SSR/未启用(loadSdk 返回 null 且未 degraded)静默丢弃;仅降级态走 console。
  if (degraded) {
    fallbackToConsole(event);
  }
}

// 采样判定先于 SDK 加载:被丢弃的事件零网络行为(采样率 0 时连 SDK 都不加载)。
function sendWithSampling(
  type: string,
  name: string,
  properties: Record<string, unknown> | undefined,
  random: RandomSource
): void {
  if (!isSampled(features.trackSampleRate, random)) {
    return;
  }
  void dispatch({ event_type: "custom", type, name, value: 0, properties });
}

/** 创建 ARMS 远端上报 Tracker;采样随机源可注入(测试用),缺省 Math.random。 */
export function createArmsTracker(options: ArmsTrackerOptions = {}): Tracker {
  const random = options.random ?? Math.random;
  return {
    pageView: (params) => {
      const { path, referrer, ...extra } = params;
      const properties: Record<string, unknown> = { ...extra };
      if (referrer !== undefined) {
        properties.referrer = referrer;
      }
      sendWithSampling(PAGE_VIEW_EVENT, path, properties, random);
    },
    event: (name, payload) => {
      sendWithSampling(name, name, payload, random);
    }
  };
}
