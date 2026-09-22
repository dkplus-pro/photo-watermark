import { ContextProvider } from "@arco-design/mobile-react";
import type { ReactNode } from "react";

import "./page-shell.css";

interface PageShellProps {
  /** 页头插槽(通常放 ShareHeader),渲染在内容区之上。 */
  header?: ReactNode;
  /** 页脚插槽(活动说明/备案等),渲染在内容区之下。 */
  footer?: ReactNode;
  /** 页面主内容。 */
  children: ReactNode;
  /** 追加到最外层容器的类名,便于单页微调。 */
  className?: string;
}

// 页面壳:活动页统一套这一层布局(方案 §3「业务页优先用壳封装组件」)。
// ContextProvider 只渲染 arco 的全局 context(主题/系统/语言,无额外 DOM),SSR 安全;
// React 19 下 Dialog/Toast 等 Portal 组件需从外部传入 createRoot,当前壳不涉及 Portal,
// 待接入弹层时在壳这一层补齐(避免业务页各自处理)。
export default function PageShell({ header, footer, children, className }: PageShellProps) {
  return (
    <ContextProvider>
      <div className={className ? `h5-page-shell ${className}` : "h5-page-shell"}>
        {header}
        <main className="h5-page-shell-main">{children}</main>
        {footer}
      </div>
    </ContextProvider>
  );
}
