/**
 * IPC handle 白名单(纪律见 docs/desktop-shell-plan.md §5 与 apps/desktop AGENTS.md):
 * - 渲染层只能用 preload 暴露的 window.desktop.*,禁止直接 import electron/ipcRenderer;
 * - main 侧只注册下列 handle,新增能力三步缺一不可:这里注册 + preload 暴露 + AGENTS.md 登记;
 * - 所有 handler 对入参做类型防御(渲染层不可信),异常结果返回结构化值而不是 reject。
 */
import { ipcMain, nativeTheme, shell } from "electron";
import { isUrlAllowed } from "./config";
import type { DesktopConfig } from "./config";
import { logger } from "./logger";
import { enqueueReport } from "./transport";

export interface IpcResult {
  ok: boolean;
  reason?: string;
}

let registered = false;

export function registerIpcHandlers(config: DesktopConfig): void {
  // 幂等:防止重复装配导致 ipcMain.handle 重复注册抛错。
  if (registered) return;
  registered = true;

  // 埋点上报:渲染层 sdk/track → transport 队列批量发。
  ipcMain.handle("report:track", (_event, payload: unknown) => enqueueReport("track", payload));

  // 错误上报:渲染层 monitor/ErrorBoundary → transport 队列批量发。
  ipcMain.handle("report:error", (_event, payload: unknown) => enqueueReport("error", payload));

  // 渲染层日志经主进程落盘(渲染层自己不写文件)。
  ipcMain.handle("log:write", (_event, level: unknown, message: unknown) => {
    writeRendererLog(level, message);
  });

  // 打开外部链接:先过白名单域校验,非白名单 http(s) 一律拒绝。
  ipcMain.handle("shell:openExternal", async (_event, rawUrl: unknown): Promise<IpcResult> => {
    if (
      typeof rawUrl !== "string" ||
      !isUrlAllowed(rawUrl, config.navAllowlist, config.selfOrigin)
    ) {
      logger.warn(`ipc.openExternal 拒绝非白名单地址:${String(rawUrl)}`);
      return { ok: false, reason: "url not allowed" };
    }
    await shell.openExternal(rawUrl);
    return { ok: true };
  });

  // 主题查询:渲染层暗色跟随系统(配置坑)依赖该值。
  ipcMain.handle("theme:get", () => ({ dark: nativeTheme.shouldUseDarkColors }));
}

function writeRendererLog(level: unknown, message: unknown): void {
  const text = typeof message === "string" ? message : (JSON.stringify(message) ?? String(message));
  const prefixed = `[renderer] ${text}`;
  switch (level) {
    case "debug":
      logger.debug(prefixed);
      break;
    case "warn":
      logger.warn(prefixed);
      break;
    case "error":
      logger.error(prefixed);
      break;
    default:
      logger.info(prefixed);
  }
}
