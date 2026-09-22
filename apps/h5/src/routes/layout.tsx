import { useEffect } from "react";
import { Outlet } from "@modern-js/runtime/router";

import { shareConfig } from "../config/share";
import { getReporter, installGlobalCapture } from "../core/monitor";
import { getTracker } from "../core/track";
import { ErrorBoundary, startWhiteScreenCheck } from "../core/stability";

// 全局根布局(阶段 3.1 装配收口):
// - 分享/SEO 槽位:消费 config/share.ts,经 React 19 head 标签提升把
//   <title>/meta description/og:image 写入 <head>(SSR 与浏览器同规则,无 hydration 分歧);
//   modern.config.ts 的 html.title 是构建期兜底,取值须与 shareConfig.title 保持一致;
//   微信 JSSDK 分享只留配置位(wechatShareSlot),TODO 见 config/share.ts;
// - ErrorBoundary 包裹页面子树:渲染崩溃降级为友好文案 + 重试,上报走 monitor 接口;
// - 壳初始化副作用集中在 ShellBootstrap(client-only,SSR 渲染为 null):
//   全局错误捕获(window error/unhandledrejection/资源错误)与白屏检测随挂载安装、
//   卸载时释放;monitor/track 经各自的 get*() 懒初始化,首次调用即完成装配
//   (endpoint 缺失时内部自动降级 noop,dev 默认关闭)。
export default function H5Layout() {
  return (
    <>
      <title>{shareConfig.title}</title>
      <meta name="description" content={shareConfig.description} />
      {shareConfig.ogImage !== "" ? (
        <meta property="og:image" content={shareConfig.ogImage} />
      ) : null}
      <ShellBootstrap />
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </>
  );
}

// 壳初始化副作用组件:不渲染任何内容,只负责挂载/卸载全局捕获与检测。
function ShellBootstrap() {
  useEffect(() => {
    const reporter = getReporter();
    // 首次调用触发 tracker 懒初始化(endpoint 缺失内部降级,无副作用放大)。
    getTracker();
    const uninstallCapture = installGlobalCapture(reporter);
    const cancelWhiteScreen = startWhiteScreenCheck();
    return () => {
      uninstallCapture();
      cancelWhiteScreen();
    };
  }, []);
  return null;
}
