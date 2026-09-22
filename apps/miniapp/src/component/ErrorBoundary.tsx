// 渲染异常根兜底(方案 docs/hybrid-capability-plan.md 卡 5.1):
// 子树渲染抛错 → componentDidCatch 归一上报 core/monitor → 中文兜底页,不白屏。
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "@tarojs/components";

import { captureError, type MonitorPayload } from "../core/monitor";
import { normalizeBoundaryError } from "./error-boundary-logic";

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** 自定义兜底:静态节点或 (error, reset) 渲染函数;缺省渲染内置中文兜底 */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** 附加上报上下文(如页面标识) */
  extra?: Record<string, unknown>;
  /** 上报注入(单测);缺省 core/monitor captureError */
  onCapture?: (payload: MonitorPayload) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const capture = this.props.onCapture ?? captureError;
    capture(
      normalizeBoundaryError({
        error,
        componentStack: typeof info.componentStack === "string" ? info.componentStack : undefined,
        extra: this.props.extra
      })
    );
  }

  /** 重置回 children(重试入口);幂等。 */
  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children ?? null;
    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback(error, this.reset);
    if (fallback !== undefined && fallback !== null) return fallback;
    return (
      <View className="error-boundary-fallback">
        <Text className="error-boundary-fallback__text">页面出错了,请稍后重试</Text>
        <View className="error-boundary-fallback__retry" onClick={this.reset}>
          重试
        </View>
      </View>
    );
  }
}
