import Axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { readErrorMessage, unwrapEnvelope } from "./envelope";

// 桌面端请求客户端(orval axios 客户端的 mutator,签名与 site/miniapp 端一致:
// customInstance<T>(config: AxiosRequestConfig): Promise<T>)。
// 匿名受众无会话,不做 token 注入与 401 跳转,只保留 {code, message, data} 解包与错误提示。
//
// baseURL 留空走同源相对路径:dev 由 electron-vite 渲染层 dev server 把 /api
// 代理到 Go server(http://127.0.0.1:18085,见 electron.vite.config.ts),
// 生产由部署侧网关同域转发。
const axiosInstance = Axios.create({ baseURL: "" });

axiosInstance.interceptors.response.use(
  (response) => {
    // 服务端 {code, message, data} 包装,这里统一解包,业务层直接拿 data。
    response.data = unwrapEnvelope(response.data);
    return response;
  },
  (error: AxiosError) => {
    console.error(readErrorMessage(error.response?.data, error.response?.status));
    return Promise.reject(error);
  }
);

// orval axios 客户端 mutator:生成代码调用 customInstance<T>(config),返回解包后的 data。
export function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  return axiosInstance.request(config).then((response) => response.data as T);
}
