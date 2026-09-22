// React 19 下 Arco 的命令式 API 必须先启用官方 react-19 适配器(与 admin 同做法,
// 见 admin/src/routes/layout.tsx);放在根布局顶部保证所有 Arco 组件之前执行。
import "@arco-design/web-react/es/_util/react-19-adapter";
import { ConfigProvider } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import { useEffect } from "react";
import { Outlet, useLoaderData } from "@modern-js/runtime/router";

import ErrorBoundary from "../components/error-boundary";
import SiteFooter from "../components/site-footer";
import SiteHeader from "../components/site-header";
import { useRum } from "../config/rum";
import { siteTheme } from "../config/site-theme";
import { FALLBACK_SITE_NAME } from "../config/site";
import { initTracking } from "../tracking";
import type { SiteLayoutData } from "./layout.data";

import "./layout.css";

// 全局根布局:页头(站名/Logo/导航,数据来自本路由的 layout.data loader)+ 页面 + 页脚。
// 稳定性装配(docs/site-shell-plan.md 阶段 5.1):ErrorBoundary 双层(根层兜壳层渲染
// 错误,页面层兜 Outlet 内页面错误,两级各自上报)+ 客户端埋点初始化。
export default function SiteLayout() {
  // RUM 仅客户端初始化(useEffect 不在 SSR 执行;env 缺失时为 no-op)。
  useRum();
  // web-vitals 埋点初始化(无参调用走默认 sink 组合):client-only —— useEffect 不在
  // SSR 执行,initTracking 内部另有 typeof window 守卫;tracking 开关关闭时整体 no-op。
  useEffect(() => {
    initTracking();
  }, []);
  const siteInfo = useLoaderData() as SiteLayoutData;
  const siteName = siteInfo?.siteName || FALLBACK_SITE_NAME;

  return (
    <ConfigProvider locale={zhCN} theme={siteTheme}>
      {/* TODO(阶段 2 site-theme):src/config/site-theme.ts 落地后在此接入 theme token;
          该文件属阶段 2 所有权,本卡不自建。 */}
      {/* 根层边界:兜住壳层(页头/页脚)渲染错误,此时整树降级。 */}
      <ErrorBoundary>
        <div className="site-shell">
          <SiteHeader siteName={siteName} logoUrl={siteInfo?.logoUrl || undefined} />
          <div className="site-main">
            {/* 页面层边界:兜住 Outlet 内页面错误,此时壳层仍可用。 */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
          <SiteFooter />
        </div>
      </ErrorBoundary>
    </ConfigProvider>
  );
}
