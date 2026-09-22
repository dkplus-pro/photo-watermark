import type { CancelToken } from "./types";

/**
 * 导出的取消信号(阶段 10)。
 *
 * 为什么单独成文件:取消语义同时被页面(弹框持有令牌)、流水线(派发循环查它)和
 * 用例(断言「取消后不再产出」)三方消费,把它留在流水线主文件里会让三方都要 import 流水线,
 * 而流水线是唯一有状态、也最难 mock 的那一层。
 */

/** 取消时抛出的错误消息:页面靠 `isCancelledExport()` 与它区分「用户取消」与「导出失败」。 */
export const CANCELLED_ERROR_MESSAGE = "导出已取消。";

/** 一张图都没选(或选择结果被清空)时的守卫消息。 */
export const NO_FILES_ERROR_MESSAGE = "没有可导出的图片, 请先选择至少一张照片。";

/** `cancel()` 抛出的错误类型;`isCancelledExport()` 同时认消息文本,防跨包副本 instanceof 失效。 */
export class CancelledExportError extends Error {
  constructor() {
    super(CANCELLED_ERROR_MESSAGE);
    this.name = "CancelledExportError";
  }
}

/** 这个错误是不是「用户取消」(页面据此走 `cancelExport()` 而不是 `failExport()`)。 */
export const isCancelledExport = (error: unknown): boolean =>
  error instanceof CancelledExportError ||
  (error instanceof Error && error.message === CANCELLED_ERROR_MESSAGE);

/**
 * 造一个取消令牌(契约里 `CancelToken` 的实现,由导出弹框持有)。
 *
 * 两条语义都是页面会踩的坑:
 * - `cancel()` 幂等且只通知一次:取消按钮可能被连点,二次通知会让 store 状态机走成
 *   「已取消之后又收到进度」;
 * - `onChange` 在已取消之后注册时立刻补一次通知:否则「取消后才挂上的监听」永远不触发,
 *   在途流水线的派发循环就停不下来(表现是点了取消还在跑完剩下的几十张)。
 */
export const createCancelToken = (): CancelToken => {
  const listeners: Array<() => void> = [];
  let cancelled = false;
  return {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      // 先摘空再通知:监听器里可能再调 onChange(例如页面重挂进度条),那属于下一次信号。
      const pending = listeners.splice(0, listeners.length);
      for (const listener of pending) listener();
    },
    onChange(listener) {
      if (cancelled) {
        listener();
        return;
      }
      listeners.push(listener);
    }
  };
};
