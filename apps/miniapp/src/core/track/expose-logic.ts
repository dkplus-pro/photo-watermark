// 曝光判定与去重纯逻辑(决策 11):≥50% 可见持续 300ms 触发;页面实例级去重。

/** 可见比例阈值:≥0.5。 */
export const EXPOSE_RATIO_THRESHOLD = 0.5;
/** 持续时长阈值(ms):≥300。 */
export const EXPOSE_DURATION_THRESHOLD_MS = 300;

/** 曝光触发判定:比例与时长双阈值;非有限数一律 false。 */
export function shouldExpose(ratio: number, durationMs: number): boolean {
  return (
    Number.isFinite(ratio) &&
    Number.isFinite(durationMs) &&
    ratio >= EXPOSE_RATIO_THRESHOLD &&
    durationMs >= EXPOSE_DURATION_THRESHOLD_MS
  );
}

/** 页面实例级去重器:同一实例内同 trackId 只放行一次;reset 后可再放行。 */
export interface ExposeDedup {
  /** 首次返回 true 并登记;已登记返回 false */
  tryMark(trackId: string): boolean;
  has(trackId: string): boolean;
  reset(): void;
  /** 已登记条数(诊断/测试用) */
  size(): number;
}

export function createExposeDedup(): ExposeDedup {
  const marked = new Set<string>();
  return {
    tryMark(trackId) {
      if (marked.has(trackId)) return false;
      marked.add(trackId);
      return true;
    },
    has: (trackId) => marked.has(trackId),
    reset: () => marked.clear(),
    size: () => marked.size
  };
}

export interface ExposeSessionOptions {
  trackId: string;
  /** 满足条件时的上报回调(由 hook 接到 core/track 的 expose) */
  report: (trackId: string) => void;
  /** 注入定时器(单测);缺省全局 setTimeout/clearTimeout */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** 持续时长阈值,默认 EXPOSE_DURATION_THRESHOLD_MS */
  durationMs?: number;
}

export interface ExposeSession {
  /** observer 回调喂入当前可见比例(0~1;非法值按 0 处理) */
  onVisible(ratio: number): void;
  /** 释放:清掉待定计时器;之后 onVisible 不再生效 */
  dispose(): void;
}

/**
 * 曝光会话(一个埋点位实例一个 session):
 * hidden →(ratio ≥ 阈值)pending(起计时)→(持续达标)report 一次 → exposed(本会话不再报);
 * pending 中比例跌回阈值下 → 撤计时回 hidden;dispose 幂等。
 */
export function createExposeSession(options: ExposeSessionOptions): ExposeSession {
  const { trackId, report } = options;
  const durationMs = options.durationMs ?? EXPOSE_DURATION_THRESHOLD_MS;
  const setTimeoutFn = options.setTimeoutFn ?? ((h: () => void, ms: number) => setTimeout(h, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  const dedup = createExposeDedup();

  let phase: "hidden" | "pending" | "exposed" = "hidden";
  let timer: unknown;
  let disposed = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
  }

  return {
    onVisible(ratio) {
      if (disposed || phase === "exposed") return;
      const visible = Number.isFinite(ratio) && ratio >= EXPOSE_RATIO_THRESHOLD;
      if (!visible) {
        cancelTimer();
        phase = "hidden";
        return;
      }
      if (phase === "pending") return; // 计时已在跑,不重复起表
      phase = "pending";
      timer = setTimeoutFn(() => {
        timer = undefined;
        if (disposed || phase !== "pending") return;
        phase = "exposed";
        if (dedup.tryMark(trackId)) {
          report(trackId);
        }
      }, durationMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimer();
    }
  };
}
