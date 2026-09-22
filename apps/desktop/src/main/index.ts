import { BrowserWindow, app } from "electron";
import { loadDesktopConfig } from "./config";
import { initCrashReporting, initProcessErrorHandlers } from "./crash";
import { registerIpcHandlers } from "./ipc";
import { initLogger } from "./logger";
import { createWindow } from "./window";
import { attachWatchdog } from "./watchdog";
import { createUpdater } from "./updater";
import { disposeTransport, flushReports, initTransport } from "./transport";

// 1. 单实例锁:第二个实例直接退出,已有窗口在 second-instance 里拉到前台。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win != null) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // 2. logger:electron-log 文件滚动 + DESKTOP_LOG_LEVEL 级别。
  const config = loadDesktopConfig();
  initLogger(config);

  // 3. crash:crashReporter(app ready 前必须 start)+ 未捕获异常收口进 logger。
  initCrashReporting(config);
  initProcessErrorHandlers();

  // 4. transport:上报管道(endpoint/pid 缺任一整条管道不初始化,dev 默认关)。
  const transportEnabled = initTransport(config);

  // 5. ipc:白名单 handle(report/log/shell/theme)。
  registerIpcHandlers(config);

  // 主窗口创建 + 逐窗口挂 watchdog,macOS activate 重建窗口时同路径复用。
  const createMainWindow = (): BrowserWindow => {
    const win = createWindow(config);
    attachWatchdog(win);
    return win;
  };

  void app.whenReady().then(() => {
    if (transportEnabled) {
      void flushReports(); // 启动重发上次溢出落盘的事件(net.fetch 需 ready)。
    }

    // 6. window:主窗口(含 window-state 持久化 + 安全基线)。
    createMainWindow();

    // 7. watchdog:渲染进程崩溃退避重载,已在 createMainWindow 内逐窗口挂载。

    // 8. updater 坑:DESKTOP_UPDATE_URL 只提示不消费,不接 electron-updater。
    createUpdater(config);

    // macOS:关闭全部窗口后点 Dock 图标重新创建窗口。
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // 退出前停掉 transport 定时器并把未发送事件落盘,下次启动重发。
  app.on("before-quit", () => {
    disposeTransport();
  });
}
