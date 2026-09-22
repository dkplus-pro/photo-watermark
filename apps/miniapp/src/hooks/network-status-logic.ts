// 网络状态纯逻辑(与 Taro 渲染解耦,便于 node 环境单测)。

/** 断网提示文案(锁定)。 */
export const OFFLINE_TIP_MESSAGE = "当前网络不可用,请检查网络设置";

/** 仅 "none" 视为断网;空值/未知/未取得一律按有网(保守不打扰)。 */
export function isOfflineNetworkType(networkType: string | null | undefined): boolean {
  return networkType === "none";
}
