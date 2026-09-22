import "@testing-library/jest-dom/vitest";

// node 环境用例(// @vitest-environment node)没有 window,浏览器 API shim 全部跳过。
if (typeof window !== "undefined") {
  // jsdom 缺失的浏览器 API shim(与 admin 同款,Arco 组件与响应式 hook 依赖):
  // matchMedia(断点/Trigger)、ResizeObserver(Trigger/弹出层定位)、scrollIntoView(弹出层滚动)。
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined, // 已废弃,兼容旧实现
          removeListener: () => undefined, // 已废弃,兼容旧实现
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false
        }) as MediaQueryList
    });
  }

  if (typeof window.ResizeObserver !== "function") {
    class ResizeObserverShim {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: ResizeObserverShim
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      writable: true,
      value: ResizeObserverShim
    });
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => undefined;
  }
}
