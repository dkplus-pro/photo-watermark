import { useMount } from "ahooks";
import { useCallback } from "react";

import { useFrameCatalogStore } from "../store/frame-catalog";
import type { FrameCatalogEntry, LogoCatalogEntry } from "../types";

export interface UseFrameCatalogResult {
  /** 已按 sortOrder 升序(同值按 id)排好的相框清单 */
  frames: FrameCatalogEntry[];
  /** 已按 id 排好的 logo 预设清单;「自定义上传」入口由页面在末尾固定追加,不在这里合成 */
  logos: LogoCatalogEntry[];
  /** idle 也计入:挂载首轮 effect 尚未跑完时按加载中处理,避免闪一帧空态 */
  loading: boolean;
  error: string | null;
  /** 显式重取:清状态后重新装载,用于错误提示里的「重试」按钮 */
  reload: () => Promise<void>;
}

/**
 * 订阅静态清单(阶段 6)。
 *
 * 装载是全站一次性动作:store 缓存结果 + in-flight 去重,因此多个页面同时挂载只会发一轮请求。
 * 这里不做「服务端数据」的语义 —— 本站无服务端,清单是随包静态文件,reload 只服务于
 * 「装载失败后用户点重试」这一条路径。
 */
export function useFrameCatalog(): UseFrameCatalogResult {
  const status = useFrameCatalogStore((state) => state.status);
  const frames = useFrameCatalogStore((state) => state.frames);
  const logos = useFrameCatalogStore((state) => state.logos);
  const error = useFrameCatalogStore((state) => state.error);
  const load = useFrameCatalogStore((state) => state.load);

  useMount(() => {
    void load();
  });

  const reload = useCallback(async () => {
    // setState 直接改状态机:load() 对 ready 短路,不清 idle 就永远重取不到。
    useFrameCatalogStore.setState({ status: "idle", error: null });
    await useFrameCatalogStore.getState().load();
  }, []);

  return {
    frames,
    logos,
    loading: status === "idle" || status === "loading",
    error,
    reload
  };
}
