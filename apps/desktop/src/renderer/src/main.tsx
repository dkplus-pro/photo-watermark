import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initMonitor } from "./sdk/monitor";
import { initTrack } from "./sdk/track";

// 渲染层稳定性装配(docs/desktop-shell-plan.md 阶段 2):错误采集与埋点初始化均幂等,
// 无桥/开关关闭时静默降级,失败不影响渲染;上报链路全部经 window.desktop.* 桥汇入主进程。
initMonitor();
initTrack();

const container = document.getElementById("root");

if (container === null) {
  throw new Error("root container missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
