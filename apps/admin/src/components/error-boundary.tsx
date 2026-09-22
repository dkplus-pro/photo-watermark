import { Button, Result } from "@arco-design/web-react";
import { useNavigate } from "@modern-js/runtime/router";
import { Component, type ErrorInfo, type ReactNode } from "react";

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

// React 19 下错误边界仍只能用类组件实现(getDerivedStateFromError / componentDidCatch),
// 不引第三方库。双层使用(见 docs/admin-enhancement-plan.md 阶段 9B):
// 根级兜住壳层渲染错误,页面级兜住 Outlet 内页面错误(此时侧边栏/顶栏仍可用)。
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 不吞错误:console.error 保留原始错误与组件栈,便于定位。
    console.error("[ErrorBoundary] 渲染错误:", error, errorInfo.componentStack);
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
