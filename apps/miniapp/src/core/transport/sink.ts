// core/transport 的 sink 实现与组装(console / 微信实时日志 / HTTP)。
//
// 纪律与依据(见 docs/miniapp-shell-plan.md §3 决策 1、§4 目标架构):
// 1. core/ 零第三方运行时依赖:本文件不 import 任何第三方包;Taro / wx / console / 定时器
//    一律经 TransportRuntime 间接访问(默认实现读 globalThis),单测可整体替换;
// 2. sink 接口保持最小:只要求 write(events): Promise<void>,queue 面向接口编程;
//    后续无论接自研端点还是 SaaS,都只是新增一个 sink,业务与壳代码零改动;
// 3. 降级优先:微信实时日志不可用(canIUse 判空失败 / API 缺失 / 调用抛错)时降级 console;
//    HTTP sink 的 endpoint 为空字符串(或纯空白)即禁用,工厂返回 null,不产生任何请求。

/** 上报事件等级:微信实时日志按等级落盘,console sink 按等级选择输出通道。 */
export type TransportLevel = "info" | "warn" | "error";

// transport 只声明自己消费的字段;业务字段(公共参数、错误堆栈等)由上层用扩展接口补充,
// 结构类型天然兼容,避免在这里堆领域字段。
export interface TransportEvent {
  /** 事件名,建议 `域.动作` 形式(如 monitor.error.js / track.page_view) */
  readonly event: string;
  /** 事件发生时间(ms epoch) */
  readonly timestamp: number;
  /** 事件等级,缺省按 info 处理 */
  readonly level?: TransportLevel;
}

/** 上报终端。queue 只依赖这一条约定。 */
export interface Sink {
  /** sink 标识,用于降级日志与排障(不属于 write 契约) */
  readonly name: string;
  write(events: readonly TransportEvent[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// 宿主对象与依赖注入
// ---------------------------------------------------------------------------

/** 小程序请求返回体(Taro.request / wx.request 的成功回调入参子集)。 */
export interface TaroRequestSuccess {
  statusCode: number;
  data?: unknown;
}

/** 小程序请求失败入参子集。 */
export interface TaroRequestFailure {
  errMsg?: string;
}

/** Taro.request 选项子集(HTTP sink 只用到这些字段)。 */
export interface TaroRequestOptions {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
  success?: (response: TaroRequestSuccess) => void;
  fail?: (failure: TaroRequestFailure) => void;
}

/** 全局 Taro 对象子集(小程序运行时由框架挂到 globalThis.Taro)。 */
export interface TaroLike {
  request?: (options: TaroRequestOptions) => unknown;
  onAppHide?: (handler: () => void) => unknown;
  offAppHide?: (handler: () => void) => unknown;
}

/** wx.getRealtimeLogManager() 返回的实时日志管理器子集。 */
export interface WxLogManagerLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/** 全局 wx 对象子集。 */
export interface WxLike {
  canIUse?: (schema: string) => boolean;
  getRealtimeLogManager?: () => WxLogManagerLike | undefined;
  onAppHide?: (handler: () => void) => unknown;
  offAppHide?: (handler: () => void) => unknown;
}

/** console 子集(只用到按等级输出的三个方法)。 */
export interface ConsoleLike {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/**
 * transport 依赖的全部宿主能力。定时器句柄是不透明标记(仅原样回传给 clearInterval),
 * 不引入平台定时器类型,便于在 node 单测里注入假定时器。
 */
export interface TransportRuntime {
  /** 取全局 Taro 对象;宿主未注入或非小程序环境返回 undefined */
  getTaro(): TaroLike | undefined;
  /** 取全局 wx 对象;非微信环境返回 undefined */
  getWx(): WxLike | undefined;
  /** 取 console;宿主未提供返回 undefined */
  getConsole(): ConsoleLike | undefined;
  /** 注册 app hide 监听(用于把缓冲事件在切后台时 flush),返回解绑函数 */
  onAppHide(handler: () => void): () => void;
  /** 周期性定时器 */
  setInterval(handler: () => void, intervalMs: number): unknown;
  /** 清理周期性定时器 */
  clearInterval(handle: unknown): void;
}

function readGlobal<T>(name: string): T | undefined {
  const value = (globalThis as Record<string, unknown>)[name];
  return value === undefined || value === null ? undefined : (value as T);
}

// 默认 hide 监听实现:优先全局 Taro(小程序框架统一入口),退回 wx 原生 API;
// 两者都不可用(如纯 node 环境)时退化为空实现,不抛错。
function registerGlobalAppHide(handler: () => void): () => void {
  const taro = readGlobal<TaroLike>("Taro");
  if (taro !== undefined && typeof taro.onAppHide === "function") {
    try {
      taro.onAppHide(handler);
    } catch {
      return () => {};
    }
    return () => {
      try {
        taro.offAppHide?.(handler);
      } catch {
        // 解绑失败不影响后续流程
      }
    };
  }

  const wx = readGlobal<WxLike>("wx");
  if (wx !== undefined && typeof wx.onAppHide === "function") {
    try {
      wx.onAppHide(handler);
    } catch {
      return () => {};
    }
    return () => {
      try {
        wx.offAppHide?.(handler);
      } catch {
        // 解绑失败不影响后续流程
      }
    };
  }

  return () => {};
}

/** 默认运行时:宿主能力全部取自全局对象。 */
export const defaultTransportRuntime: TransportRuntime = {
  getTaro: () => readGlobal<TaroLike>("Taro"),
  getWx: () => readGlobal<WxLike>("wx"),
  getConsole: () => readGlobal<ConsoleLike>("console"),
  onAppHide: registerGlobalAppHide,
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => {
    clearInterval(handle as Parameters<typeof clearInterval>[0]);
  }
};

/** 在默认运行时基础上覆盖部分能力(单测与宿主注入用)。 */
export function createTransportRuntime(
  overrides: Partial<TransportRuntime> = {}
): TransportRuntime {
  return { ...defaultTransportRuntime, ...overrides };
}

/** 上报日志统一前缀,便于在开发者工具 / 微信实时日志后台过滤。 */
export const TRANSPORT_LOG_PREFIX = "[transport]";

function resolveLevel(level: TransportLevel | undefined): TransportLevel {
  return level ?? "info";
}

function pickMethod<T>(
  methods: Record<string, T | undefined>,
  level: TransportLevel,
  fallbackKey: string
): T | undefined {
  return methods[level] ?? methods[fallbackKey];
}

// ---------------------------------------------------------------------------
// console sink(dev 默认)
// ---------------------------------------------------------------------------

export interface ConsoleSinkOptions {
  runtime?: TransportRuntime;
}

/** dev 用 sink:按事件等级逐条打到 console,永不失败。 */
export function createConsoleSink(options: ConsoleSinkOptions = {}): Sink {
  const runtime = options.runtime ?? defaultTransportRuntime;

  return {
    name: "console",
    write(events) {
      const logger = runtime.getConsole();
      if (logger === undefined) return Promise.resolve();
      for (const event of events) {
        const method = pickMethod(
          { info: logger.info, warn: logger.warn, error: logger.error },
          resolveLevel(event.level),
          "info"
        );
        method?.call(logger, `${TRANSPORT_LOG_PREFIX} ${event.event}`, event);
      }
      return Promise.resolve();
    }
  };
}

// ---------------------------------------------------------------------------
// 微信实时日志 sink(prod 默认)
// ---------------------------------------------------------------------------

export interface WechatSinkOptions {
  runtime?: TransportRuntime;
  /** 实时日志不可用时的降级 sink,默认 console sink */
  fallback?: Sink;
}

// canIUse 缺失(宿主未提供判空能力)时不拦,以 getRealtimeLogManager 是否存在为准;
// 判空、取值、调用三段任一失败都视为不可用,由调用方降级。
function resolveRealtimeLogManager(runtime: TransportRuntime): WxLogManagerLike | undefined {
  const wx = runtime.getWx();
  if (wx === undefined) return undefined;
  if (typeof wx.canIUse === "function" && !wx.canIUse("getRealtimeLogManager")) return undefined;
  if (typeof wx.getRealtimeLogManager !== "function") return undefined;
  try {
    return wx.getRealtimeLogManager();
  } catch {
    return undefined;
  }
}

function writeRealtimeLog(manager: WxLogManagerLike, event: TransportEvent): void {
  const method = pickMethod(
    { info: manager.info, warn: manager.warn, error: manager.error },
    resolveLevel(event.level),
    "info"
  );
  if (typeof method !== "function") throw new Error("实时日志管理器缺少可用写方法");
  method.call(manager, `${TRANSPORT_LOG_PREFIX} ${event.event}`, event);
}

/** 生产默认 sink:wx.getRealtimeLogManager(零成本零依赖);不可用时降级 fallback。 */
export function createWechatSink(options: WechatSinkOptions = {}): Sink {
  const runtime = options.runtime ?? defaultTransportRuntime;
  const fallback = options.fallback ?? createConsoleSink({ runtime });

  return {
    name: "wechat",
    async write(events) {
      const manager = resolveRealtimeLogManager(runtime);
      if (manager === undefined) return fallback.write(events);
      for (let index = 0; index < events.length; index += 1) {
        try {
          writeRealtimeLog(manager, events[index]);
        } catch {
          // 写入中途失败:剩余事件走降级通道,已写入的不重复
          return fallback.write(events.slice(index));
        }
      }
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP sink(endpoint 留坑,空则禁用)
// ---------------------------------------------------------------------------

/** 上报请求超时(ms)。 */
export const DEFAULT_HTTP_TIMEOUT_MS = 10000;

export interface HttpSinkOptions {
  /** 上报端点(绝对地址);空字符串或纯空白视为禁用 */
  endpoint: string;
  runtime?: TransportRuntime;
  timeoutMs?: number;
}

function resolveTaroRequest(
  runtime: TransportRuntime
): ((options: TaroRequestOptions) => unknown) | undefined {
  const taro = runtime.getTaro();
  if (taro === undefined || typeof taro.request !== "function") return undefined;
  return (options) => taro.request?.(options);
}

// Taro.request 薄封装:回调式 API 转 Promise,只保留 transport 需要的字段。
function requestByTaro(
  request: (options: TaroRequestOptions) => unknown,
  options: Omit<TaroRequestOptions, "success" | "fail">
): Promise<TaroRequestSuccess> {
  return new Promise<TaroRequestSuccess>((resolve, reject) => {
    request({
      ...options,
      success: (response) => resolve(response),
      fail: (failure) => reject(new Error(failure?.errMsg || "上报请求失败"))
    });
  });
}

// 按 api 信封约定 {code, message, data} 判定结果:
// - 非 2xx → 失败;
// - 2xx + 信封 code !== 0 → 失败(取服务端 message);
// - 2xx + 信封 code === 0 → 成功;
// - 2xx + 非信封响应体(含空体,如网关直返)→ 按 HTTP 语义视为成功。
function readEnvelopeFailure(response: TaroRequestSuccess): string | undefined {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return `上报失败(HTTP ${response.statusCode})`;
  }
  const payload = response.data;
  if (typeof payload !== "object" || payload === null) return undefined;
  const { code, message } = payload as { code?: unknown; message?: unknown };
  if (code === undefined || code === 0) return undefined;
  if (typeof message === "string" && message !== "") return message;
  return `上报失败(code ${String(code)})`;
}

/** HTTP sink:POST { events } 到 endpoint;endpoint 为空时返回 null(禁用该 sink)。 */
export function createHttpSink(options: HttpSinkOptions): Sink | null {
  const endpoint = options.endpoint.trim();
  if (endpoint === "") return null;

  const runtime = options.runtime ?? defaultTransportRuntime;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  return {
    name: "http",
    async write(events) {
      const request = resolveTaroRequest(runtime);
      if (request === undefined) throw new Error("HTTP sink 不可用:宿主缺少 Taro.request");
      const response = await requestByTaro(request, {
        url: endpoint,
        method: "POST",
        data: { events },
        header: { "content-type": "application/json" },
        timeout: timeoutMs
      });
      const failure = readEnvelopeFailure(response);
      if (failure !== undefined) throw new Error(failure);
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

export interface TransportSinksOptions {
  /** dev 模式:挂 console sink;非 dev 挂微信实时日志 sink(内部自动降级 console) */
  dev?: boolean;
  /** HTTP 上报端点,空字符串禁用 HTTP sink */
  httpEndpoint?: string;
  runtime?: TransportRuntime;
}

// 组合口径(见方案 §3 决策 1):console 是 dev 默认,微信实时日志是 prod 默认;
// HTTP sink 与运行模式无关,配了 endpoint 就挂,便于联调自研端点。
export function createTransportSinks(options: TransportSinksOptions = {}): Sink[] {
  const runtime = options.runtime ?? defaultTransportRuntime;
  const sinks: Sink[] = [
    options.dev === true ? createConsoleSink({ runtime }) : createWechatSink({ runtime })
  ];
  const httpSink = createHttpSink({ endpoint: options.httpEndpoint ?? "", runtime });
  if (httpSink !== null) sinks.push(httpSink);
  return sinks;
}
