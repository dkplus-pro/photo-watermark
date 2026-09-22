/**
 * window.desktop 桥访问入口(sdk 基座,纪律见 docs/desktop-shell-plan.md §5):
 * - 渲染层禁止 import electron / ipcRenderer,一切跨进程能力只经本文件类型化的
 *   window.desktop.*(暴露面与 src/preload/index.ts 一一对应,新增能力时同步维护);
 * - 桥缺失(测试环境 / preload 未注入 / window 未定义)时经 getDesktopBridge 返回
 *   undefined,调用方用可选链降级,不允许抛错反噬业务;
 * - window.desktop 类型为可选全局声明,仅 sdk 层消费,业务层禁止绕过 sdk 直摸桥。
 */

export interface DesktopThemeInfo {
  dark: boolean;
}

export interface DesktopOpenExternalResult {
  ok: boolean;
  reason?: string;
}

export interface DesktopBridge {
  /** 渲染层埋点/错误上报(sdk/track、sdk/monitor 专用) */
  report: {
    track: (payload: unknown) => Promise<boolean>;
    error: (payload: unknown) => Promise<boolean>;
  };
  /** 渲染层日志经主进程落盘 */
  log: {
    write: (level: "debug" | "info" | "warn" | "error", message: string) => Promise<void>;
  };
  /** 查询系统主题(暗色跟随系统坑) */
  theme: {
    get: () => Promise<DesktopThemeInfo>;
  };
  /** 打开白名单内的外部链接 */
  openExternal: (url: string) => Promise<DesktopOpenExternalResult>;
}

declare global {
  interface Window {
    /** preload contextBridge 暴露的桥(src/preload/index.ts);非 electron 环境可能缺失。 */
    desktop?: DesktopBridge;
  }
}

// 取桥的唯一入口:window 未定义(SSR/测试)或桥未注入时返回 undefined。
export function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.desktop;
}
