/**
 * 崩溃与兜底异常收集:
 * - crashReporter:submitURL 由 DESKTOP_CRASH_SUBMIT_URL 决定;缺省 uploadToServer=false,
 *   只在本地 crashes 目录存 dump 不上传(符号化消费留后续阶段);
 * - uncaughtException/unhandledRejection:统一收口进 logger,不弹默认对话框、不主动退出,
 *   由各模块自行决定降级策略(渲染层崩溃走 watchdog.ts 重载)。
 * 装配约束:crashReporter.start 必须在 app ready 之前调用,由 index.ts 装配顺序保证。
 */
import { crashReporter } from "electron";
import type { DesktopConfig } from "./config";
import { logger } from "./logger";

export function initCrashReporting(config: DesktopConfig): void {
  try {
    if (config.crashSubmitUrl == null) {
      // 缺省坑:无 submitURL 时只采集不上传,dump 留本地便于事后符号化。
      crashReporter.start({ uploadToServer: false, compress: true });
    } else {
      crashReporter.start({
        submitURL: config.crashSubmitUrl,
        uploadToServer: true,
        compress: true
      });
    }
  } catch (error) {
    logger.error("crash.reporter.start 失败", error);
  }
}

export function initProcessErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    logger.error("crash.uncaughtException", error instanceof Error ? error.stack : String(error));
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(
      "crash.unhandledRejection",
      reason instanceof Error ? reason.stack : String(reason)
    );
  });
}
