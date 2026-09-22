import Taro from "@tarojs/taro";
import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL, appEnv } from "../config";
import { captureError, normalizeApiError } from "../core/monitor";
import { readErrorMessage, unwrapEnvelope } from "./envelope";

// 小程序端请求客户端(orval axios 客户端的 mutator,签名与 site 端一致:
// customInstance<T>(config: AxiosRequestConfig): Promise<T>)。
// 公开受众无会话,匿名端不做 token 注入与 401 跳转,只保留 {code, message, data} 解包与错误提示。
//
// 为什么直桥 Taro.request 而不是 axios + axios-miniprogram-adapter:
// 小程序运行时没有 XMLHttpRequest,axios 默认适配器不可用;社区适配器 axios-miniprogram-adapter
// 深度依赖 axios 0.x 内部模块(axios/lib/core/settle、axios/lib/core/createError 等),
// 而 axios 1.x 已删除 createError 且 exports 白名单不再暴露 ./lib/* 深路径,
// 与本项目钉定的 axios ^1.20.0 不兼容。因此这里仅复用 axios 的配置类型约定 mutator 签名,
// 传输层直接走 Taro.request(即 wx.request)。
//
// 只覆盖 orval 生成代码会用到的配置子集:url / method / params / data / headers / timeout。

type WeappMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE" | "CONNECT";

function toWeappMethod(method: AxiosRequestConfig["method"]): WeappMethod {
  return (method ?? "GET").toUpperCase() as WeappMethod;
}

function toQueryString(params: unknown): string {
  if (params === null || typeof params !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  return parts.join("&");
}

function buildRequestUrl(config: AxiosRequestConfig): string {
  const requestUrl = config.url ?? "";
  const isAbsolute = /^https?:\/\//i.test(requestUrl);
  const base = isAbsolute ? "" : API_BASE_URL.replace(/\/+$/, "");
  const path = [base, requestUrl.replace(/^\/+/, "")].filter((part) => part !== "").join("/");
  const query = toQueryString(config.params);
  if (query === "") return path;
  return path.includes("?") ? `${path}&${query}` : `${path}?${query}`;
}

// 鉴权挂点(预留,决策 1 / 根规则 23):C 端用户体系落地后,在此向 header 注入
// Authorization: Bearer <token>(token 来源为未来的 TokenStore),并在 fail 分支接 401 语义。
// 当前为匿名公开受众:禁止实现任何鉴权逻辑,本注释仅为挂点标记。
function normalizeHeaders(headers: AxiosRequestConfig["headers"]): Record<string, string> {
  if (headers === undefined || headers === null) return {};
  if (typeof (headers as { toJSON?: unknown }).toJSON === "function") {
    return { ...(headers as unknown as { toJSON: () => Record<string, string> }).toJSON() };
  }
  return { ...(headers as Record<string, string>) };
}

// 韧性参数(N3):超时 10s 起步;幂等 GET 失败重试 1 次;错误统一挂钩 monitor(api_error)。
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_GET_RETRIES = 1;

/** 单请求超时覆盖:非法值(非有限数 / <=0)回退默认 10s;合法值原样(ms,不设上限,平台侧 60s 上限兜底)。 */
export function resolveTimeoutMs(timeout: unknown): number {
  return typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_TIMEOUT_MS;
}

/** dev 环境输出请求日志(控制台);其余环境静默。导出供单测。 */
export function shouldLogRequests(env: string): boolean {
  return env === "dev";
}

/** 请求取消错误:调用方主动 abort 的载体;不参与重试、不上报 monitor。 */
export class RequestAbortedError extends Error {
  constructor() {
    super("请求已取消");
    this.name = "RequestAbortedError";
  }
}

export function isRequestAbortedError(value: unknown): value is RequestAbortedError {
  return value instanceof RequestAbortedError;
}

/** 请求失败载体:保留 statusCode 供重试判定与监控分类。 */
class RequestFailure extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** axios 风格 signal 子集(AbortSignal 结构化鸭子类型;小程序运行时可能无 AbortController,守卫访问)。 */
interface SignalLike {
  aborted?: boolean;
  addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
}

function requestOnce<T>(config: AxiosRequestConfig, method: WeappMethod, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = (config as { signal?: SignalLike }).signal;
    if (signal?.aborted === true) {
      reject(new RequestAbortedError());
      return;
    }
    let settled = false;
    const task = Taro.request({
      url,
      method,
      data: config.data,
      header: normalizeHeaders(config.headers),
      timeout: resolveTimeoutMs(config.timeout),
      success: (response) => {
        if (settled) return;
        settled = true;
        const isOk = response.statusCode >= 200 && response.statusCode < 300;
        if (!isOk) {
          reject(
            new RequestFailure(
              readErrorMessage(response.data, response.statusCode),
              response.statusCode
            )
          );
          return;
        }
        resolve(unwrapEnvelope<T>(response.data));
      },
      fail: (error) => {
        if (settled) return;
        settled = true;
        reject(new RequestFailure(error.errMsg || "网络请求失败"));
      }
    });
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          (task as { abort?: () => void })?.abort?.();
          reject(new RequestAbortedError());
        },
        { once: true }
      );
    }
  });
}

// orval axios 客户端 mutator:生成代码调用 customInstance<T>(config),返回解包后的 data。
// 失败路径(网络/超时/信封错误)最终失败时挂钩 monitor(api_error),不影响异常语义。
export async function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const method = toWeappMethod(config.method);
  const url = buildRequestUrl(config);
  const maxRetries = method === "GET" ? MAX_GET_RETRIES : 0;
  const startedAt = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const data = await requestOnce<T>(config, method, url);
      if (shouldLogRequests(appEnv)) {
        // eslint-disable-next-line no-console -- dev 请求日志为规格锁定行为(卡 5.5)
        console.debug("[api]", method, url, { ok: true, durationMs: Date.now() - startedAt });
      }
      return data;
    } catch (error) {
      if (error instanceof RequestAbortedError) {
        throw error; // 调用方主动取消:不重试、不上报、原样抛出
      }
      lastError = error;
      const statusCode = error instanceof RequestFailure ? error.statusCode : undefined;
      const transient = statusCode === undefined || statusCode >= 500;
      // 重试只给幂等 GET 的瞬时失败(网络/超时/5xx);4xx 业务错误重试无意义
      if (!(method === "GET" && transient) || attempt === maxRetries) {
        break;
      }
    }
  }

  const statusCode = lastError instanceof RequestFailure ? lastError.statusCode : undefined;
  const errMsg = lastError instanceof Error ? lastError.message : "请求失败";
  captureError(normalizeApiError({ endpoint: url, errMsg, code: statusCode }));
  if (shouldLogRequests(appEnv)) {
    // eslint-disable-next-line no-console -- dev 请求日志为规格锁定行为(卡 5.5)
    console.debug("[api]", method, url, {
      ok: false,
      statusCode,
      durationMs: Date.now() - startedAt
    });
  }
  throw lastError;
}
