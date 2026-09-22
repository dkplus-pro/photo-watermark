// 小程序更新检查(决策 8):wx.getUpdateManager 三分支(ready/failed/no-update);
// dev 环境跳过(微信开发者工具无更新流程);宿主全部可注入,单测用 fake 驱动。
import { appEnv, type AppEnv } from "../../config";

/** wx.getUpdateManager() 返回体子集。 */
export interface UpdateManagerLike {
  onCheckForUpdate?: (callback: (res: { hasUpdate?: boolean }) => void) => void;
  onUpdateReady?: (callback: () => void) => void;
  onUpdateFailed?: (callback: () => void) => void;
  applyUpdate?: () => void;
}

/** wx.showModal 入参子集。 */
export interface ShowModalOptions {
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  success?: (res: { confirm?: boolean }) => void;
}

/** 更新检查宿主(缺省读全局 wx)。 */
export interface UpdateHost {
  getUpdateManager?: () => UpdateManagerLike | undefined;
  showModal?: (options: ShowModalOptions) => void;
  canIUse?: (schema: string) => boolean;
}

export type UpdateCheckResult = "skipped_dev" | "unavailable" | "registered";

export interface CheckUpdateOptions {
  /** 注入宿主(单测);缺省全局 wx */
  host?: UpdateHost;
  /** 注入环境(单测);缺省读 config 的 appEnv */
  env?: AppEnv;
  /** 新版本下载失败回调(app.tsx 接 monitor.captureMessage) */
  onUpdateFailed?: () => void;
}

/** 更新就绪弹窗文案(锁定)。 */
export const UPDATE_MODAL_TITLE = "更新提示";
export const UPDATE_MODAL_CONTENT = "新版本已准备好,是否重启应用?";
export const UPDATE_MODAL_CONFIRM_TEXT = "重启";
export const UPDATE_MODAL_CANCEL_TEXT = "取消";

function defaultHost(): UpdateHost | undefined {
  return (globalThis as { wx?: UpdateHost }).wx;
}

/**
 * 注册更新检查:dev 跳过;宿主无能力静默降级;
 * ready → 弹窗(确认 → applyUpdate);failed → onUpdateFailed 回调。
 * 永不抛错。
 */
export function checkUpdate(options: CheckUpdateOptions = {}): UpdateCheckResult {
  const env = options.env ?? appEnv;
  if (env === "dev") return "skipped_dev";

  const host = options.host ?? defaultHost();
  if (host === undefined || typeof host.getUpdateManager !== "function") return "unavailable";
  if (typeof host.canIUse === "function" && !host.canIUse("getUpdateManager")) return "unavailable";

  let manager: UpdateManagerLike | undefined;
  try {
    manager = host.getUpdateManager();
  } catch {
    return "unavailable";
  }
  if (manager === undefined || manager === null) return "unavailable";

  manager.onUpdateReady?.(() => {
    const showModal = host.showModal;
    if (typeof showModal !== "function") {
      // 无弹窗能力:直接应用更新(新版本已下载完,停留旧版风险更大)
      manager.applyUpdate?.();
      return;
    }
    showModal({
      title: UPDATE_MODAL_TITLE,
      content: UPDATE_MODAL_CONTENT,
      confirmText: UPDATE_MODAL_CONFIRM_TEXT,
      cancelText: UPDATE_MODAL_CANCEL_TEXT,
      showCancel: true,
      success: (res) => {
        if (res?.confirm === true) manager.applyUpdate?.();
      }
    });
  });
  manager.onUpdateFailed?.(() => {
    options.onUpdateFailed?.();
  });
  return "registered";
}
