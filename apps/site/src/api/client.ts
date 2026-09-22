import Axios, { isAxiosError, AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";

// 公开站请求客户端(orval axios 客户端的 mutator,见 docs/multi-audience-contracts.md):
// 公开站无会话,token 注入与 401 跳转一概不做;只保留 {code, message, data} 解包与错误提示。
//
// baseURL 双端规则(见 docs/site.md「SSR 注意事项」):
// - SSR 服务端进程内没有"同源"概念,相对路径不可用,必须用绝对地址(env SITE_API_BASE,
//   默认 http://127.0.0.1:8080 指向 Go server;dev 与生产部署各自注入);
// - 浏览器端保持空串走同源相对路径(dev 由 Modern.js 代理 /api,生产由网关同域转发)。
const isServer = typeof window === "undefined";
const baseURL = isServer ? (process.env.SITE_API_BASE ?? "http://127.0.0.1:8080") : "";

// 接口韧性(阶段 5.2):超时 10s;幂等 GET 失败(网络错误/5xx/超时)指数退避重试 1 次;
// 最终失败经 tracking facade 上报(kind=api_error),调用方语义不变(仍然 reject)。
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_IDEMPOTENT_RETRIES = 1;

const axiosInstance = Axios.create({ baseURL, timeout: DEFAULT_TIMEOUT_MS });

function isEnvelope(
  payload: unknown
): payload is { code: number; message?: string; data: unknown } {
  return typeof payload === "object" && payload !== null && "code" in payload && "data" in payload;
}

axiosInstance.interceptors.response.use(
  (response) => {
    // 服务端 {code, message, data} 包装,这里统一解包,业务层直接拿 data。
    if (isEnvelope(response.data)) {
      response.data = response.data.data;
    }
    return response;
  },
  (error: AxiosError) => {
    console.error(readErrorMessage(error.response));
    return Promise.reject(error);
  }
);

function readErrorMessage(response?: AxiosResponse): string {
  const payload: unknown = response?.data;
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return `请求失败(${response?.status ?? "无响应"})`;
}

// 幂等方法判定:GET(参数化查询,可安全重发);写操作一律不重试防重复提交。
function isIdempotentMethod(config: AxiosRequestConfig): boolean {
  return (config.method ?? "get").toLowerCase() === "get";
}

// 瞬时失败判定:无响应(网络/超时)或 5xx;4xx 业务错误重试无意义。
function isTransientFailure(error: AxiosError): boolean {
  if (error.response) {
    return error.response.status >= 500;
  }
  return true;
}

// 指数退避等待:attempt 从 0 计,首次重试 250ms、二次 500ms……封顶 1s。
function backoffDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 1000);
}

function reportApiFailure(error: AxiosError): void {
  if (isServer) {
    return; // SSR 侧没有 tracking(浏览器-only facade),失败已走 console.error
  }
  void import("../tracking").then(
    ({ track }) => {
      track("api_error", {
        endpoint: error.config?.url ?? "",
        message: readErrorMessage(error.response),
        status: error.response?.status ?? 0
      });
    },
    () => undefined
  );
}

// orval axios 客户端 mutator:生成代码调用 customInstance<T>(config),返回解包后的 data。
export async function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const retryable = isIdempotentMethod(config);
  let attempt = 0;
  for (;;) {
    try {
      return (await axiosInstance.request(config)).data as T;
    } catch (error) {
      const axiosError = isAxiosError(error) ? (error as AxiosError) : undefined;
      const canRetry =
        retryable && attempt < MAX_IDEMPOTENT_RETRIES && axiosError !== undefined && isTransientFailure(axiosError);
      if (!canRetry || axiosError === undefined) {
        if (axiosError !== undefined) {
          reportApiFailure(axiosError);
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
      attempt += 1;
    }
  }
}
