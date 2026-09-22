// 网络状态订阅 hook(方案 docs/hybrid-capability-plan.md 卡 5.4):
// 进入页面拉一次 Taro.getNetworkType + 监听网络变化;判定逻辑在 network-status-logic(纯函数,已单测)。
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";

import { isOfflineNetworkType } from "./network-status-logic";

export interface NetworkStatus {
  /** 微信网络类型(wifi/4g/none/...);未取得前为 "unknown" */
  networkType: string;
  isOffline: boolean;
}

/** 网络状态订阅:进入页面拉一次 + 监听变化;失败保持 "unknown"。 */
export function useNetworkStatus(): NetworkStatus {
  const [networkType, setNetworkType] = useState("unknown");
  useEffect(() => {
    const apply = (value: unknown) => {
      if (typeof value === "string" && value !== "") setNetworkType(value);
    };
    try {
      Taro.getNetworkType({ success: (res) => apply(res?.networkType) });
    } catch {
      // 读取失败保持 unknown
    }
    const handler = (res: { isConnected?: boolean; networkType?: string }) => {
      apply(res?.networkType);
    };
    Taro.onNetworkStatusChange(handler);
    return () => {
      Taro.offNetworkStatusChange(handler);
    };
  }, []);
  return { networkType, isOffline: isOfflineNetworkType(networkType) };
}
