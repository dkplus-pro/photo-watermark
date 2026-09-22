// ErrorBoundary 纯逻辑:渲染异常 → MonitorPayload 归一(永不抛错)。
import type { MonitorPayload } from "../core/monitor";

export interface BoundaryErrorInput {
  error: unknown;
  componentStack?: string;
  extra?: Record<string, unknown>;
}

/** 渲染异常归一为 monitor js_error;message 前缀固定「页面渲染失败: 」。 */
export function normalizeBoundaryError(input: BoundaryErrorInput): MonitorPayload {
  const { error, componentStack, extra } = input;
  let message: string;
  let stack: string | undefined;
  if (error instanceof Error) {
    message = error.message !== "" ? error.message : error.name;
    stack = error.stack;
  } else if (typeof error === "string" && error !== "") {
    message = error;
  } else if (error === null || error === undefined) {
    // 空值护栏:JSON.stringify(null) 会产出字符串 "null",此处按未知形状归档占位文案
    message = "[unknown render error]";
  } else {
    try {
      message = JSON.stringify(error) ?? "[unknown render error]";
    } catch {
      message = "[unknown render error]";
    }
  }
  const mergedExtra: Record<string, unknown> = { ...(extra ?? {}) };
  if (typeof componentStack === "string" && componentStack !== "") {
    mergedExtra["componentStack"] = componentStack;
  }
  return {
    kind: "js_error",
    message: `页面渲染失败: ${message}`,
    stack,
    extra: mergedExtra
  };
}
