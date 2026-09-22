// 应用根组件:仅做壳层装配,不承载业务(docs/desktop-shell-plan.md §2)。
// - react-19-adapter 必须先于一切 Arco 组件执行(与 admin/site 同做法),Arco 的
//   命令式 API 才能在 React 19 下工作;
// - ConfigProvider 统一 zh-CN locale;暗色跟随系统经 use-system-theme 的 body
//   arco-theme 属性生效(按需样式下的暗色边界见该文件注释);
// - Hash 路由 + ErrorBoundary 包在 Router 内(降级 UI 依赖路由上下文做"返回首页"),
//   兜住全部路由的渲染错误;页面本身经 routes/index.tsx 的 React.lazy 拆 chunk;
// - 若 Arco 按需插件被关闭(electron.vite.config.ts enableArcoImportPlugin),
//   全量 CSS 兜底在本文件最上方补:import "@arco-design/web-react/dist/css/arco.css"。
import "@arco-design/web-react/es/_util/react-19-adapter";
import { ConfigProvider } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import { Suspense } from "react";
import { HashRouter } from "react-router-dom";

import ErrorBoundary from "./component/error-boundary";
import { useSystemTheme } from "./hooks/use-system-theme";
import AppRoutes from "./routes";

export default function App() {
  useSystemTheme();

  return (
    <ConfigProvider locale={zhCN}>
      <HashRouter>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <AppRoutes />
          </Suspense>
        </ErrorBoundary>
      </HashRouter>
    </ConfigProvider>
  );
}
