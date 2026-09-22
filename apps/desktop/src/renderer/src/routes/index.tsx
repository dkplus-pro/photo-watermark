import { lazy, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { trackPageView } from "../sdk/track";

// 路由表(Hash 模式,docs/desktop-shell-plan.md §2):页面一律 React.lazy 懒加载占位,
// 首屏只引壳代码,业务页面按 chunk 拆分(electron.vite.config.ts manualChunks 配合)。
const HomePage = lazy(() => import("./home"));
const NotFoundPage = lazy(() => import("./not-found"));

// pageView 埋点:路由变化即报一帧 page_view(sdk 关闭时内部 no-op)。
function RouteTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return null;
}

// 壳内路由出口:ErrorBoundary(component/error-boundary.tsx)在本组件外层兜渲染错误。
export default function AppRoutes() {
  return (
    <>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
