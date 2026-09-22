import { useMount } from "ahooks";

import { getTracker } from "../core/track";

// 页面 PV 自动埋点:页面组件挂载时经 core/track 统一出口发一次 pageView
// (方案 docs/h5-shell-plan.md 阶段 2.B「页面 PV 自动化的坑」)。
//
// 约定:
// - 只消费 getTracker(),不做 SDK 初始化/采样判定(全部收口在 core/track 内部);
// - path 固定取浏览器地址 location.pathname,由路由层在页面组件挂载处调用;
// - extra 透传为上报附加字段(如活动 id、来源渠道),字段命名语义化由调用方负责。

/** 页面 PV 埋点:挂载时上报一次 pageView;extra 为业务附加字段(可缺省)。 */
export function usePageTrack(extra?: Record<string, unknown>): void {
  useMount(() => {
    // SSR 安全守卫:useEffect 本不在服务端执行,再判一次 window 防异常调用环境。
    if (typeof window === "undefined") {
      return;
    }
    getTracker().pageView({ path: window.location.pathname, ...extra });
  });
}
