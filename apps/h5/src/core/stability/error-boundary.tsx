// core/stability/error-boundary.tsx:渲染错误边界(方案 §3「稳定性」)。
// 用 React class 组件:getDerivedStateFromError/componentDidCatch 是捕获子树渲染错误的
// 唯一可靠钩子,函数组件无等价能力。捕获后渲染降级 UI,上报经 core/monitor 接口
// (kind=react_render_error)。core 层禁引 UI 组件库:内置降级用原生标签,零组件依赖。
import { Component, type ErrorInfo, type ReactNode } from "react";

import { getReporter } from "../monitor";

import type { StabilityError } from "./index";

/** 内置降级 UI 标题(面向用户的人话)。 */
export const FALLBACK_TITLE = "页面出了点小问题";

/**
 * 渲染错误上报:仅在浏览器生命周期执行。SSR 服务端渲染不触发实例错误钩子,
 * 这里再用 typeof window 双重守卫,杜绝监控调用泄漏到服务端(方案 §3「SSR 安全」)。
 * 独立导出以便单测分别覆盖浏览器/SSR 两条分支。
 */
export function captureRenderError(error: Error, componentStack?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: StabilityError = {
    kind: "react_render_error",
    // 空值边界:throw 的可能不是带 message 的 Error,回落 String 化,保证 message 非空。
    message: error.message || String(error),
    stack: error.stack,
    extra: { componentStack: componentStack ?? "" }
  };
  getReporter().captureError(payload);
}

export interface ErrorBoundaryProps {
  /** 正常态子树。 */
  children: ReactNode;
  /** 自定义降级 UI;缺省渲染内置友好文案 + 重试按钮。 */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 渲染错误边界:捕获子树渲染期错误 → 降级 UI;重试 = 仅重置错误态重新渲染子树。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureRenderError(error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        this.props.fallback ?? (
          <div className="h5-stability-fallback" role="alert">
            <p className="h5-stability-fallback-title">{FALLBACK_TITLE}</p>
            <p className="h5-stability-fallback-desc">
              请稍后重试;若持续出现,请联系活动负责人。
            </p>
            <button
              className="h5-stability-fallback-retry"
              type="button"
              onClick={this.handleRetry}
            >
              重试
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
