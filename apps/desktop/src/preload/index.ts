/**
 * preload 是 main ↔ renderer 唯一桥梁(纪律见 docs/desktop-shell-plan.md §5 与 apps/desktop AGENTS.md):
 * - 渲染层禁止 import electron / ipcRenderer,只能调本文件白名单暴露的 window.desktop.*;
 * - 新增能力三步缺一不可:main ipc.ts 注册 handler → 本文件暴露 → AGENTS.md 登记;
 * - 暴露面保持最小:只暴露白名单方法,不透传 ipcRenderer / webContents 等底层对象。
 */
import { contextBridge, ipcRenderer } from "electron";

export type RendererLogLevel = "debug" | "info" | "warn" | "error";

export interface ThemeInfo {
  dark: boolean;
}

export interface OpenExternalResult {
  ok: boolean;
  reason?: string;
}

contextBridge.exposeInMainWorld("desktop", {
  /** 渲染层埋点上报(sdk/track 专用) */
  report: {
    track: (payload: unknown): Promise<boolean> => ipcRenderer.invoke("report:track", payload),
    error: (payload: unknown): Promise<boolean> => ipcRenderer.invoke("report:error", payload)
  },
  /** 渲染层日志经主进程落盘 */
  log: {
    write: (level: RendererLogLevel, message: string): Promise<void> =>
      ipcRenderer.invoke("log:write", level, message)
  },
  /** 查询系统主题(暗色跟随系统坑) */
  theme: {
    get: (): Promise<ThemeInfo> => ipcRenderer.invoke("theme:get")
  },
  /** 打开白名单内的外部链接 */
  openExternal: (url: string): Promise<OpenExternalResult> =>
    ipcRenderer.invoke("shell:openExternal", url)
});
