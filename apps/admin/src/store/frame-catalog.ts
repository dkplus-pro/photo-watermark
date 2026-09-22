import { create } from "zustand";

import type { FrameCatalogEntry, LogoCatalogEntry } from "../types";
import { loadCatalogs, sortCatalogEntries } from "../utils/catalog";

/**
 * 清单装载状态机(zustand,阶段 6)。
 *
 * idle → loading → ready | error,error → loading(允许重试),ready/loading 自调用不重新发请求。
 * 清单是随包发布的静态文件,一次会话内不会变,所以装载结果常驻内存、不落 localStorage:
 * 缓存文件内容会让用户改了 JSON 后刷新仍看到旧数据,而两次 fetch 的代价可以忽略。
 */
export type FrameCatalogStatus = "idle" | "loading" | "ready" | "error";

export interface FrameCatalogState {
  status: FrameCatalogStatus;
  frames: FrameCatalogEntry[];
  logos: LogoCatalogEntry[];
  error: string | null;
  /** 幂等装载:ready/loading 中重复调用不重新 fetch,error 后调用可重试 */
  load(): Promise<void>;
}

// 组件外读写(事件回调、导出流水线)统一走 useFrameCatalogStore.getState()。
export const useFrameCatalogStore = create<FrameCatalogState>()((set, get) => ({
  status: "idle",
  frames: [],
  logos: [],
  error: null,
  load: async () => {
    const { status } = get();
    // 同步置 loading 是 in-flight 去重的关键:两个组件同一帧内挂载,
    // 第二个调用必然看到 loading 而不会重复请求。
    if (status === "loading" || status === "ready") return;
    set({ status: "loading", error: null });
    try {
      const { frames, logos } = await loadCatalogs();
      set({
        status: "ready",
        // 排序在这里做完:页面拿到的就是最终顺序,不必各自再排一遍。
        frames: sortCatalogEntries(frames.frames),
        logos: sortCatalogEntries(logos.logos)
      });
    } catch (error) {
      // 失败时保留上一次的数据:重载失败不该让已渲染的列表瞬间变空。
      set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
}));
