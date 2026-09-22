import "@testing-library/jest-dom/vitest";

// jsdom 缺失的浏览器 API shim(Arco 组件与媒体 hook 依赖):
// matchMedia(响应式/Trigger)、ResizeObserver(Trigger/弹出层定位)、
// scrollIntoView(弹出层滚动)、URL.createObjectURL/revokeObjectURL(媒体 blob 预览)。
// setup 对 node 环境的纯逻辑用例同样执行,故全部做环境守卫。
if (typeof window !== "undefined") {
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

  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: () => "blob:mock"
    });
  }
  if (typeof URL.revokeObjectURL !== "function") {
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: () => undefined
    });
  }
}
