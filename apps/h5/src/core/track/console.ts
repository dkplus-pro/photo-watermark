import type { Tracker } from "./index";

// ConsoleTracker:dev 本地观测实现,console.info 打印事件形状(仓库 eslint no-console
// 仅放行 error/info/warn,故用 info)。阶段 2.B 接远端上报后,本实现保留为兜底。

// PV 固定事件名(对齐常见埋点口径)。
export const PAGE_VIEW_EVENT = "page_view";

// 输出形状:{ name, payload, timestamp },payload 原样透传(含 0/undefined 等值)。
export const consoleTracker: Tracker = {
  pageView: (payload) => {
    console.info("[track]", { name: PAGE_VIEW_EVENT, payload, timestamp: Date.now() });
  },
  event: (name, payload) => {
    console.info("[track]", { name, payload, timestamp: Date.now() });
  }
};
