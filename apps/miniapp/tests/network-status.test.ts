// 网络状态判定边界(方案 docs/hybrid-capability-plan.md 卡 5.4;六类边界:空值)。
// hook 为薄壳(useNetworkStatus 只做 Taro 接线),判定逻辑在本文件的纯函数。
import { describe, expect, it } from "vitest";

import { OFFLINE_TIP_MESSAGE, isOfflineNetworkType } from "../src/hooks/network-status-logic";

describe("isOfflineNetworkType(断网判定)", () => {
  it("NT1 none 视为断网", () => {
    expect(isOfflineNetworkType("none")).toBe(true);
  });

  it("NT2 有网与未知一律 false(空值)", () => {
    for (const networkType of ["wifi", "4g", "5g", "unknown", "", null, undefined]) {
      expect(isOfflineNetworkType(networkType)).toBe(false);
    }
  });

  it("NT3 断网文案常量锁定", () => {
    expect(OFFLINE_TIP_MESSAGE).toBe("当前网络不可用,请检查网络设置");
  });
});
