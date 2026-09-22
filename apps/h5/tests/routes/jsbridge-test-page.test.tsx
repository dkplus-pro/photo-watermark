import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { jsbMethodGroups } from "../../src/routes/jsbridge-test/method-groups";
import JSBridgeTestPage from "../../src/routes/jsbridge-test/page";

// jsdom 未实现 matchMedia,arco ContextProvider(PageShell 内部)挂载期会调用;
// tests/setup.ts 注明组件用例所需 shim 在用例侧补齐,这里只影响本文件。
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  }) as unknown as MediaQueryList;

const METHOD_NAMES = [
  "getDeviceInfo",
  "getNetworkType",
  "getAppVersion",
  "showToast",
  "showLoading",
  "hideLoading",
  "setNavigationBarTitle",
  "openPage",
  "closePage"
];

/** 按 method 名定位所在卡片容器(卡片标题行渲染灰字 method 名)。 */
function getCard(method: string): HTMLElement {
  const card = screen.getByText(method).closest("section");
  if (!card) {
    throw new Error(`card for method "${method}" not found`);
  }
  return card;
}

describe("JSBridgeTestPage", () => {
  it("P1 浏览器降级态:浏览器徽标 + BRIDGE_NOT_AVAILABLE 降级横幅,不出现 App 徽标", () => {
    render(<JSBridgeTestPage />);
    expect(screen.getByText("运行环境：浏览器")).toBeInTheDocument();
    expect(screen.queryByText("运行环境：App WebView")).not.toBeInTheDocument();
    expect(screen.getByText(/BRIDGE_NOT_AVAILABLE/)).toBeInTheDocument();
  });

  it("P2 方法卡片齐全:9 个 method、三个分组标题与事件订阅区", () => {
    render(<JSBridgeTestPage />);
    for (const name of METHOD_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("设备 / 网络 / 版本")).toBeInTheDocument();
    expect(screen.getByText("UI 交互")).toBeInTheDocument();
    expect(screen.getByText("页面跳转")).toBeInTheDocument();
    expect(screen.getByText("事件订阅")).toBeInTheDocument();
  });

  it("P3 参数 JSON 非法:PARSE_ERROR 展示,不发请求", async () => {
    const user = userEvent.setup();
    render(<JSBridgeTestPage />);
    const card = getCard("showToast");
    const textarea = within(card).getByLabelText("showToast 参数");
    // user.type 对 "{" 有按键语法歧义,受控值用 fireEvent 直设
    fireEvent.change(textarea, { target: { value: "{bad" } });
    await user.click(within(card).getByRole("button", { name: "调用" }));
    expect(await screen.findByText(/PARSE_ERROR: 参数 JSON 解析失败/)).toBeInTheDocument();
    expect(screen.queryByText(/BRIDGE_NOT_AVAILABLE: /)).not.toBeInTheDocument();
  });

  it("P4 无桥调用失败展示:BRIDGE_NOT_AVAILABLE 与耗时", async () => {
    const user = userEvent.setup();
    render(<JSBridgeTestPage />);
    const card = getCard("getAppVersion");
    await user.click(within(card).getByRole("button", { name: "调用" }));
    expect(
      await screen.findByText(/BRIDGE_NOT_AVAILABLE: window\.flutter_inappwebview\.callHandler/)
    ).toBeInTheDocument();
    expect(screen.getByText(/耗时：\d+ ms/)).toBeInTheDocument();
  });

  it("P5 事件订阅:dispatch 收到记录,退订后不再新增", async () => {
    const user = userEvent.setup();
    render(<JSBridgeTestPage />);
    expect(screen.getByLabelText("事件名")).toHaveValue("native.webview.ready");
    await user.click(screen.getByRole("button", { name: "订阅" }));
    act(() => {
      window.__JSB_BRIDGE__!.dispatchEvent("native.webview.ready", { url: "x" });
    });
    expect(screen.getByText(/收到事件 native\.webview\.ready/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消订阅" }));
    act(() => {
      window.__JSB_BRIDGE__!.dispatchEvent("native.webview.ready", { url: "y" });
    });
    expect(screen.getAllByText(/收到事件 native\.webview\.ready/)).toHaveLength(1);
  });
});

describe("jsbMethodGroups 元数据冒烟", () => {
  it("展平 9 项、method 名唯一、defaultParams 均可解析为对象", () => {
    const methods = jsbMethodGroups.flatMap((group) => group.methods);
    expect(methods).toHaveLength(9);
    expect(new Set(methods.map((meta) => meta.method)).size).toBe(9);
    for (const meta of methods) {
      const parsed: unknown = JSON.parse(meta.defaultParams);
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
    }
  });
});
