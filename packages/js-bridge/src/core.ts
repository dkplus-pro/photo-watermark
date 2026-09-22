/**
 * 卡 1.2:JSB 核心——transport 注入、callNative Promise 化
 * (id 分配、超时、应答归一、错误码映射)。
 */
import type { JSBErrorCode, JSBError, JSBRequest, JSBResult, JSBResultError } from "./protocol";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  JSB_ERROR_CODES,
  JSB_RESULT_OK,
  badResponseError,
  createJSBError,
  isJSBError,
  timeoutError
} from "./protocol";

/** 传输层抽象:call 接收请求信封,返回原生应答(未知形态,由 core 归一)。 */
export interface JSBTransport {
  call(req: JSBRequest): Promise<unknown>;
}

export interface JSBOptions {
  /** 默认超时(ms),默认 DEFAULT_CALL_TIMEOUT_MS;0 = 不超时。 */
  timeoutMs?: number;
  /** 时钟,默认 Date.now;仅用于默认 idFactory。测试注入以保证确定性。 */
  now?: () => number;
  /** callbackId 生成器,默认 `jsb_${now()}_${seq}`(seq 自 1 起,按 createJSB 实例独立计数)。 */
  idFactory?: () => string;
}

export interface CallNativeOptions {
  /** 单次调用覆盖默认超时;0 = 不超时;负数非法。 */
  timeoutMs?: number;
}

export interface JSBBridge {
  callNative<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: CallNativeOptions
  ): Promise<T>;
}

/**
 * native 失败应答 → JSBError 映射:已知归一错误码(如 METHOD_NOT_FOUND/BAD_PARAMS/CANCELLED)
 * 原样透传,未知错误码收口为 NATIVE_ERROR;原始诊断信息(wireCode ?? result.code)一律保留进 nativeCode。
 */
function mapNativeFailure(method: string, result: JSBResult): JSBError {
  const wireCode = result.error?.code;
  const wireMsg = result.error?.message;
  const known = wireCode !== undefined && (JSB_ERROR_CODES as readonly string[]).includes(wireCode);
  const code: JSBErrorCode = known ? (wireCode as JSBErrorCode) : "NATIVE_ERROR";
  const message = wireMsg ? wireMsg : `native call "${method}" failed with code ${result.code}`;
  return createJSBError(code, message, wireCode ?? result.code);
}

/**
 * 应答归一:接受 JSBResult 对象或 JSON 字符串(flutter_inappwebview 对复杂返回值可能给到字符串),
 * 输出 { code, data, error? } 新对象;不可归一时 throw JSBError(BAD_RESPONSE)。
 */
export function normalizeJSBResponse(raw: unknown): JSBResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badResponseError("response is a non-JSON string");
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badResponseError("response is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const code = obj["code"];
  if (typeof code !== "number" || Number.isNaN(code)) {
    throw badResponseError('response "code" is not a number');
  }
  // error 字段整形:仅当其为对象且 code/message 均为 string 时保留,否则视为 undefined(不因此抛错)
  const rawError = obj["error"];
  let error: JSBResultError | undefined;
  if (rawError !== null && typeof rawError === "object") {
    const errObj = rawError as Record<string, unknown>;
    const errCode = errObj["code"];
    const errMessage = errObj["message"];
    if (typeof errCode === "string" && typeof errMessage === "string") {
      error = { code: errCode, message: errMessage };
    }
  }
  const result: JSBResult = { code, data: obj["data"] };
  if (error !== undefined) {
    result.error = error;
  }
  return result;
}

export function createJSB(transport: JSBTransport, options?: JSBOptions): JSBBridge {
  if (!transport || typeof transport.call !== "function") {
    throw new TypeError("createJSB requires a transport exposing a call() function");
  }
  const now = options?.now ?? Date.now;
  const defaultTimeoutMs = options?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let seq = 0;
  const defaultIdFactory = (): string => {
    seq += 1;
    return `jsb_${now()}_${seq}`;
  };
  const idFactory = options?.idFactory ?? defaultIdFactory;

  return {
    async callNative<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      opts?: CallNativeOptions
    ): Promise<T> {
      // 入参校验全部走 reject(async 函数内 throw),禁止同步抛
      if (typeof method !== "string" || method.trim().length === 0) {
        throw createJSBError("BAD_PARAMS", 'callNative requires a non-empty "method" string');
      }
      const effectiveTimeout = opts?.timeoutMs ?? defaultTimeoutMs;
      if (
        typeof effectiveTimeout !== "number" ||
        !Number.isFinite(effectiveTimeout) ||
        effectiveTimeout < 0
      ) {
        throw createJSBError(
          "BAD_PARAMS",
          `callNative requires a finite non-negative "timeoutMs", got ${String(effectiveTimeout)}`
        );
      }

      // 组请求:params 省略时不得携带 params 键
      const req: JSBRequest =
        params === undefined ? { id: idFactory(), method } : { id: idFactory(), method, params };

      return new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        // settle-once:成功/失败/超时任一路径先行后,后续一律忽略;任何 settle 路径都清理计时器
        const finish = (settle: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          settle();
        };

        if (effectiveTimeout > 0) {
          timer = setTimeout(() => {
            finish(() => reject(timeoutError(method, effectiveTimeout)));
          }, effectiveTimeout);
        }

        const failWithTransportError = (err: unknown): void => {
          finish(() => {
            if (isJSBError(err)) {
              reject(err);
              return;
            }
            reject(
              createJSBError(
                "NATIVE_ERROR",
                `JSB transport error: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          });
        };

        let pending: Promise<unknown>;
        try {
          pending = Promise.resolve(transport.call(req));
        } catch (err) {
          failWithTransportError(err);
          return;
        }
        pending.then(
          (raw) => {
            finish(() => {
              let result: JSBResult;
              try {
                result = normalizeJSBResponse(raw);
              } catch (err) {
                reject(err);
                return;
              }
              if (result.code === JSB_RESULT_OK) {
                resolve(result.data as T);
                return;
              }
              reject(mapNativeFailure(method, result));
            });
          },
          (err) => {
            failWithTransportError(err);
          }
        );
      });
    }
  };
}
