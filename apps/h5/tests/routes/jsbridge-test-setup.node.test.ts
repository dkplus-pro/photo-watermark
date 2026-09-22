// @vitest-environment node
import { describe, expect, it } from "vitest";

import { initJSBTestBridge } from "../../src/routes/jsbridge-test/jsb-setup";

// S1:SSR/Node 分支(无 window)——初始化必须返回 null 且不触碰任何浏览器 API。
// vitest docblock 是文件级开关,SSR 用例必须独立文件(见施工方案 §7.7)。
describe("initJSBTestBridge(node 环境)", () => {
  it("S1 无 window 时返回 null(纯 no-op)", () => {
    expect(initJSBTestBridge()).toBeNull();
  });
});
