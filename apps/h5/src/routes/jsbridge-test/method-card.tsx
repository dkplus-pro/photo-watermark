import { useState } from "react";
import type { JSX } from "react";

import type { JSBMethodMeta } from "./method-groups";

export interface JSBCallResult {
  /** 成功为 data(JSON 可序列化),失败为 null。 */
  data: unknown;
  /** 失败时的错误码(JSBError.code)或 "PARSE_ERROR"(参数 JSON 解析失败)。 */
  errorCode: string | null;
  errorMessage: string | null;
  /** nativeCode(JSBError.nativeCode)诊断透传,可空。 */
  nativeCode: string | number | null;
  /** 调用耗时(ms,performance.now 差值,四舍五入到整数)。 */
  elapsedMs: number;
}

interface MethodCardProps {
  meta: JSBMethodMeta;
  /** 实际调用(runtime.bridge.callNative 的引用透传)。 */
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/** rejection → 结果三元组(duck typing:JSBError 携带 code/message/nativeCode)。 */
function toFailure(err: unknown, elapsedMs: number): JSBCallResult {
  const candidate = err as { code?: unknown; message?: unknown; nativeCode?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "NATIVE_ERROR";
  const message = typeof candidate?.message === "string" ? candidate.message : String(err);
  const nativeCode =
    typeof candidate?.nativeCode === "string" || typeof candidate?.nativeCode === "number"
      ? candidate.nativeCode
      : null;
  return { data: null, errorCode: code, errorMessage: message, nativeCode, elapsedMs };
}

export default function MethodCard({ meta, call }: MethodCardProps): JSX.Element {
  const [paramsText, setParamsText] = useState(meta.defaultParams);
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<JSBCallResult | null>(null);

  const handleCall = async (): Promise<void> => {
    if (calling) {
      return;
    }
    // 先解析参数:解析失败不发请求(空值/越界守卫)
    let params: Record<string, unknown> | undefined;
    let parseFailure: JSBCallResult | null = null;
    try {
      const parsed: unknown = JSON.parse(paramsText);
      if (parsed === null) {
        params = undefined;
      } else if (typeof parsed !== "object" || Array.isArray(parsed)) {
        parseFailure = {
          data: null,
          errorCode: "PARSE_ERROR",
          errorMessage: "参数必须是 JSON 对象",
          nativeCode: null,
          elapsedMs: 0
        };
      } else {
        params = parsed as Record<string, unknown>;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      parseFailure = {
        data: null,
        errorCode: "PARSE_ERROR",
        errorMessage: `参数 JSON 解析失败：${reason}`,
        nativeCode: null,
        elapsedMs: 0
      };
    }
    if (parseFailure !== null) {
      setResult(parseFailure);
      return;
    }
    setCalling(true);
    const startedAt = performance.now();
    try {
      const data = await call(meta.method, params);
      setResult({
        data,
        errorCode: null,
        errorMessage: null,
        nativeCode: null,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    } catch (err) {
      setResult(toFailure(err, Math.round(performance.now() - startedAt)));
    } finally {
      setCalling(false);
    }
  };

  return (
    <section className="jsb-card">
      <div className="jsb-card-head">
        <span className="jsb-card-label">{meta.label}</span>
        <code className="jsb-card-method">{meta.method}</code>
      </div>
      <p className="jsb-card-desc">{meta.description}</p>
      <textarea
        className="jsb-card-input"
        value={paramsText}
        onChange={(event) => setParamsText(event.target.value)}
        rows={4}
        spellCheck={false}
        aria-label={`${meta.method} 参数`}
      />
      <button
        type="button"
        className="jsb-btn jsb-btn--primary"
        disabled={calling}
        onClick={handleCall}
      >
        {calling ? "调用中…" : "调用"}
      </button>
      {result !== null ? (
        <div
          className={
            result.errorCode !== null ? "jsb-result jsb-result--error" : "jsb-result jsb-result--ok"
          }
        >
          <pre className="jsb-result-data">
            {result.errorCode !== null
              ? `${result.errorCode}: ${result.errorMessage ?? ""}${
                  result.nativeCode !== null ? `（native 原始码：${result.nativeCode}）` : ""
                }`
              : result.data === undefined
                ? "(无返回值)"
                : JSON.stringify(result.data, null, 2)}
          </pre>
          <p className="jsb-result-elapsed">耗时：{result.elapsedMs} ms</p>
        </div>
      ) : null}
    </section>
  );
}
