// 服务端响应信封 {code, message, data, logID} 的解包与错误信息读取。
// 纯逻辑、不依赖 axios/electron 运行时,便于 vitest 冒烟测试直接覆盖;
// 解包约定与 site/miniapp 端一致。
export interface Envelope {
  code: number;
  message?: string;
  data?: unknown;
}

export function isEnvelope(payload: unknown): payload is Envelope {
  return typeof payload === "object" && payload !== null && "code" in payload && "data" in payload;
}

// 解包信封:信封响应取 data 载荷,非信封载荷原样返回。
export function unwrapEnvelope<T>(payload: unknown): T {
  return (isEnvelope(payload) ? payload.data : payload) as T;
}

export function readErrorMessage(payload: unknown, statusCode?: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return `请求失败(${statusCode ?? "无响应"})`;
}
