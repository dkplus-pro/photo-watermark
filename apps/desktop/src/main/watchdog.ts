/**
 * 渲染进程崩溃 watchdog:render-process-gone 后按 1s/2s/4s 退避重载,连续 3 次失败后
 * 放弃并记 error 日志;窗口正常加载完成(did-finish-load)即重置计数,避免长期运行中
 * 偶发崩溃累积次数。clean-exit(窗口正常关闭)不触发重载。
 */
import type { BrowserWindow } from "electron";
import { logger } from "./logger";

const MAX_RETRIES = 3;
const BACKOFF_MS: readonly number[] = [1000, 2000, 4000];

export function attachWatchdog(win: BrowserWindow): void {
  let failures = 0;
  let reloadTimer: NodeJS.Timeout | null = null;

  win.webContents.on("did-finish-load", () => {
    failures = 0;
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || win.isDestroyed()) {
      return;
    }
    if (failures >= MAX_RETRIES) {
      logger.error(`watchdog 重载次数已达上限(${MAX_RETRIES}),放弃恢复:${details.reason}`);
      return;
    }
    const delay = BACKOFF_MS[failures] ?? 4000;
    failures += 1;
    logger.warn(`watchdog 渲染进程退出(${details.reason}),${delay}ms 后第 ${failures} 次重载`);
    if (reloadTimer != null) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.reload();
      }
    }, delay);
  });
}
