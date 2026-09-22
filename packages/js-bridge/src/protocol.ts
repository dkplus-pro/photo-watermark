/**
 * 卡 1.1:JSB 协议层——类型、错误码、错误类、错误工厂、超时常量。
 * 纯协议定义,不 import 任何模块、不含运行逻辑之外的代码。
 */

/** JSB 成功码:native 应答 {code:0} 表示成功。 */
export const JSB_RESULT_OK = 0;

/** callNative 默认超时(ms);0 = 不超时(决策 3)。 */
export const DEFAULT_CALL_TIMEOUT_MS = 30000;

/**
 * JSB 归一化错误码(7 值联合的来源)。
 *
 * | code                 | 含义                                                                       | 产生方   |
 * | -------------------- | -------------------------------------------------------------------------- | -------- |
 * | BRIDGE_NOT_AVAILABLE | 非 webview 环境 / flutter_inappwebview.callHandler 缺失 / getJSB() 未初始化 | js 侧    |
 * | TIMEOUT              | 调用超时                                                                   | js 侧    |
 * | METHOD_NOT_FOUND     | native 无该 method 的注册 handler                                          | native 透传 |
 * | BAD_PARAMS           | js 侧入参非法(空 method、负 timeout)或 native 参数校验失败透传              | 双侧     |
 * | BAD_RESPONSE         | native 应答无法归一(非 JSON 字符串、非对象、code 非数字)                    | js 侧    |
 * | NATIVE_ERROR         | native 业务失败(含未识别的 native error.code)与 transport 层异常           | 双侧     |
 * | CANCELLED            | 用户在 native 流程中主动取消(为阶段 6 媒体方法预留)                         | native 透传 |
 */
export const JSB_ERROR_CODES = [
  "BRIDGE_NOT_AVAILABLE",
  "TIMEOUT",
  "METHOD_NOT_FOUND",
  "BAD_PARAMS",
  "BAD_RESPONSE",
  "NATIVE_ERROR",
  "CANCELLED"
] as const;

export type JSBErrorCode = (typeof JSB_ERROR_CODES)[number];

/** js→native 请求信封。id 由 js 侧 idFactory 生成(callbackId),native 原样回传用于日志关联。 */
export interface JSBRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSBResultError {
  code: string;
  message: string;
}

/** native→js 应答信封。code===0(JSB_RESULT_OK) 成功取 data;否则读 error。 */
export interface JSBResult<T = unknown> {
  code: number;
  data?: T;
  error?: JSBResultError;
}

/**
 * transport 层的原始应答形态:flutter_inappwebview.callHandler 在 iOS/Android
 * 对复杂返回值可能给到 JSON 字符串,故为 JSBResult 对象与 string 的联合。
 */
export type JSBResponse = JSBResult | string;

/** JSB 统一错误:code 为归一后的 7 值联合,nativeCode 保留 native 侧原始错误码用于诊断。 */
export class JSBError extends Error {
  /** 归一后的错误码(7 值联合)。 */
  readonly code: JSBErrorCode;
  /** native 侧原始错误码(字符串或数字),用于诊断;js 侧自产错误为 undefined。 */
  readonly nativeCode?: string | number;

  constructor(code: JSBErrorCode, message: string, nativeCode?: string | number) {
    super(message);
    this.name = "JSBError";
    this.code = code;
    this.nativeCode = nativeCode;
  }
}

export function createJSBError(
  code: JSBErrorCode,
  message: string,
  nativeCode?: string | number
): JSBError {
  return new JSBError(code, message, nativeCode);
}

export function isJSBError(value: unknown): value is JSBError {
  return value instanceof JSBError;
}

export function bridgeNotAvailableError(detail?: string): JSBError {
  return createJSBError(
    "BRIDGE_NOT_AVAILABLE",
    detail ?? "JSB bridge is not available (not running inside flutter_inappwebview)"
  );
}

export function timeoutError(method: string, timeoutMs: number): JSBError {
  return createJSBError("TIMEOUT", `callNative("${method}") timed out after ${timeoutMs}ms`);
}

export function badResponseError(detail: string): JSBError {
  return createJSBError("BAD_RESPONSE", `invalid JSB response: ${detail}`);
}
