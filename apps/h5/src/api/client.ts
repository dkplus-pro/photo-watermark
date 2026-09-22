import Axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";

// 活动 H5 请求客户端(orval axios 客户端的 mutator,见 docs/multi-audience-contracts.md):
// h5 为匿名受众,无会话,token 注入与 401 跳转一概不做;只保留 {code, message, data} 解包与错误提示。
//
// baseURL 双端规则(照抄 apps/site,见 docs/site.md「SSR 注意事项」):
// - SSR 服务端进程内没有"同源"概念,相对路径不可用,必须用绝对地址(env H5_API_BASE,
//   默认 http://127.0.0.1:18085 指向 Go server;dev 与生产部署各自注入);
// - 浏览器端保持空串走同源相对路径(dev 由 Modern.js 代理 /api,生产由网关同域转发)。
const isServer = typeof window === "undefined";
const baseURL = isServer ? (process.env.H5_API_BASE ?? "http://127.0.0.1:18085") : "";

const axiosInstance = Axios.create({ baseURL });

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

// orval axios 客户端 mutator:生成代码调用 customInstance<T>(config),返回解包后的 data。
export function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  return axiosInstance.request(config).then((response) => response.data as T);
}
