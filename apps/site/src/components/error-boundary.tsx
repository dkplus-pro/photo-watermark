// 崩溃兜底边界(参考 apps/admin/src/components/error-boundary.tsx,方案见
// docs/site-shell-plan.md 阶段 5.1):React 19 下错误边界仍只能用类组件实现
// (getDerivedStateFromError / componentDidCatch),不引第三方库。
//
// 与 admin 的差异:catch 时经 tracking facade 上报 react_render_error。装配为双层
// (layout.tsx:根层包整个应用树 + 页面层包 Outlet,两级各自上报,防单层失效)。
import "@arco-design/web-react/es/_util/react-19-adapter";
import { Button, Result } from "@arco-design/web-react";
import { useNavigate } from "@modern-js/runtime/router";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { track } from "../tracking";

// react_render_error 尚未登记进 config/tracking-events.ts 事件注册表(登记需改该文件,
// 属阶段 2/4 所有权,TODO 随注册表演进补登)。sink 端对事件名仅作字符串透传,经最小
// 断言走 facade 通道,开关门控(console/RUM/HTTP sink 组合)与普通事件完全一致。

// 上报载荷:仅可序列化基础字段(对齐注册表对载荷字段的约束),message 为空串时由
// 下游文案兜底。
function reportRenderError(error: Error, errorInfo: ErrorInfo): void {
  try {
    track("react_render_error", {
      message: error.message,
      component_stack: errorInfo.componentStack ?? undefined
    });
  } catch {
    // facade 契约本已静默 sink 失败;此处兜底保证上报环节绝不影响降级 UI。
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// 崩溃兜底卡片(Arco Result):错误摘要 + 重试(重置边界 state)+ 返回首页。
// 样式全部走 Arco 组件,不写死颜色。
function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const navigate = useNavigate();

  return (
    <Result
      status="error"
      title="页面出错了"
      subTitle={error.message || "渲染时发生未知错误,请稍后重试"}
      extra={[
        <Button key="retry" type="primary" onClick={onRetry}>
          重试
        </Button>,
        <Button
          key="home"
          onClick={() => {
            onRetry();
            navigate("/");
          }}
        >
          返回首页
        </Button>
      ]}
    />
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 不吞错误:console.error 保留原始错误与组件栈,便于定位。
    console.error("[ErrorBoundary] 渲染错误:", error, errorInfo.componentStack);
    // 上报仅在浏览器生命周期:SSR 渲染期错误边界不触发,typeof window 守卫双保险。
    if (typeof window === "undefined") {
      return;
    }
    reportRenderError(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      return <ErrorFallback error={error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
