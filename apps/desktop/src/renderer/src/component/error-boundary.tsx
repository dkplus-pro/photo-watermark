// 崩溃兜底边界(参考 apps/site/src/components/error-boundary.tsx,方案见
// docs/desktop-shell-plan.md §2):React 19 下错误边界仍只能用类组件实现
// (getDerivedStateFromError / componentDidCatch),不引第三方库。
//
// 与 site 的差异:上报不走 tracking facade,经 sdk/monitor 的 reportRenderError 汇入
// window.desktop.report.error → 主进程 transport;降级 UI 的"返回首页"用
// react-router-dom 跳转(桌面壳为 Hash 路由)。装配为单层,包在 HashRouter 内
// (降级 UI 依赖路由上下文);后续落持久壳层(侧栏/顶栏)时在 Outlet 处再加第二层。
import "@arco-design/web-react/es/_util/react-19-adapter";
import { Button, Result } from "@arco-design/web-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { reportRenderError } from "../sdk/monitor";

// react_render_error 暂未登记事件注册表(desktop 尚无该文件,site 先例见
// config/tracking-events.ts);上报通道对事件名仅作透传,不影响管道行为。

// 上报载荷:仅可序列化基础字段;message 为空串时由下游文案兜底。上报环节任何异常
// 都被 sdk 静默,不影响降级 UI 渲染。
function reportBoundaryError(error: Error, errorInfo: ErrorInfo): void {
  try {
    reportRenderError(error, errorInfo.componentStack);
  } catch {
    // 双保险兜底:上报环节绝不影响降级 UI。
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
  // noImplicitOverride 开启(base tsconfig),覆写 React.Component 成员需显式 override。
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 不吞错误:console.error 保留原始错误与组件栈,便于定位。
    console.error("[ErrorBoundary] 渲染错误:", error, errorInfo.componentStack);
    reportBoundaryError(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (error) {
      return <ErrorFallback error={error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
