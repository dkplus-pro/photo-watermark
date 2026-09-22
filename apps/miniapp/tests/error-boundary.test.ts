// ErrorBoundary 渲染兜底边界(方案 docs/hybrid-capability-plan.md 卡 5.1;
// 六类边界:空值/零值/越界/非法状态迁移)。
// 仓库不引入 jsdom / @testing-library / react-test-renderer:组件测试形态 =
// 直接 new 类实例 + render() 返回的 element 树结构断言 + vi.mock("@tarojs/components")。
import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ View: "View", Text: "Text" }));
vi.mock("../src/core/monitor", () => ({ captureError: vi.fn() }));

import { captureError } from "../src/core/monitor";
import { ErrorBoundary } from "../src/component/ErrorBoundary";
import { normalizeBoundaryError } from "../src/component/error-boundary-logic";

/** 读取 element 的 props(结构断言用;props 形状由用例自行约束)。 */
function propsOf(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

/** 取 element 的子节点数组。 */
function childrenOf(element: ReactElement): ReactElement[] {
  return Children.toArray(propsOf(element)["children"]) as ReactElement[];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeBoundaryError(渲染异常归一)", () => {
  it("EB1 Error:message/stack 透传,kind 为 js_error", () => {
    const error = new Error("boom");
    const payload = normalizeBoundaryError({ error });
    expect(payload.kind).toBe("js_error");
    expect(payload.message).toBe("页面渲染失败: boom");
    expect(payload.stack).toBe(error.stack);
  });

  it("EB2 空 message 的 Error:回退 error.name(空值)", () => {
    const payload = normalizeBoundaryError({ error: new Error("") });
    expect(payload.message).toBe("页面渲染失败: Error");
  });

  it("EB3 非 Error 入参:字符串原样,null/循环引用回退占位不抛(空值/越界)", () => {
    expect(normalizeBoundaryError({ error: "oops" }).message).toBe("页面渲染失败: oops");
    expect(normalizeBoundaryError({ error: null }).message).toBe(
      "页面渲染失败: [unknown render error]"
    );

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(normalizeBoundaryError({ error: circular }).message).toBe(
      "页面渲染失败: [unknown render error]"
    );
  });

  it("EB4 componentStack 合并:非空串写入 extra,空串/undefined 不写,extra 原字段保留(空值)", () => {
    const merged = normalizeBoundaryError({
      error: new Error("boom"),
      componentStack: "\n    in App",
      extra: { page: "pages/index/index" }
    });
    expect(merged.extra).toEqual({ page: "pages/index/index", componentStack: "\n    in App" });

    for (const componentStack of ["", undefined]) {
      const payload = normalizeBoundaryError({ error: new Error("boom"), componentStack });
      expect(payload.extra).toEqual({});
      expect(JSON.stringify(payload.extra)).not.toContain("componentStack");
    }
  });
});

describe("ErrorBoundary 上报", () => {
  it("EB5 getDerivedStateFromError 原样返回 error 引用", () => {
    const error = new Error("boom");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
    expect(ErrorBoundary.getDerivedStateFromError(error).error).toBe(error);
  });

  it("EB6 componentDidCatch 缺省路径:core/monitor captureError 收到 js_error 归一 payload", () => {
    const boundary = new ErrorBoundary({});
    boundary.componentDidCatch(new Error("boom"), {
      componentStack: "\n    in App"
    } as Parameters<ErrorBoundary["componentDidCatch"]>[1]);

    expect(vi.mocked(captureError)).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(captureError).mock.calls[0][0];
    expect(payload.kind).toBe("js_error");
    expect(payload.message).toBe("页面渲染失败: boom");
  });

  it("EB7 componentDidCatch 注入路径:onCapture 收到归一 payload,captureError 不被调", () => {
    const onCapture = vi.fn();
    const boundary = new ErrorBoundary({ onCapture, extra: { page: "pages/index/index" } });
    boundary.componentDidCatch(new Error("boom"), {
      componentStack: ""
    } as Parameters<ErrorBoundary["componentDidCatch"]>[1]);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toMatchObject({
      kind: "js_error",
      message: "页面渲染失败: boom",
      extra: { page: "pages/index/index" }
    });
    expect(vi.mocked(captureError)).not.toHaveBeenCalled();
  });
});

describe("ErrorBoundary render", () => {
  it("EB8 无错误:返回 children 同一引用(零值)", () => {
    const child = createElement("div", null, "content");
    const boundary = new ErrorBoundary({ children: child });
    expect(boundary.render()).toBe(child);
  });

  it("EB9 函数 fallback:收到 (error, reset)", () => {
    const error = new Error("boom");
    const fallback = vi.fn((caught: Error, reset: () => void) => {
      void caught;
      void reset;
      return createElement("div", null, "自定义");
    });
    const boundary = new ErrorBoundary({ fallback });
    boundary.state = { error };

    const tree = boundary.render();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0]).toBe(error);
    expect(typeof fallback.mock.calls[0][1]).toBe("function");
    expect(tree).toBeDefined();
  });

  it("EB10 默认兜底结构 + 重试重置语义(非法状态迁移)", () => {
    const boundary = new ErrorBoundary({});
    boundary.state = { error: new Error("boom") };

    const tree = boundary.render() as ReactElement;
    expect(propsOf(tree)["className"]).toBe("error-boundary-fallback");
    const [textNode, retryNode] = childrenOf(tree);
    expect(propsOf(textNode)["children"]).toBe("页面出错了,请稍后重试");
    expect(propsOf(retryNode)["children"]).toBe("重试");

    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => undefined);
    (propsOf(retryNode)["onClick"] as () => void)();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith({ error: null });
  });
});

describe("ErrorBoundaryProps 类型自检", () => {
  it("children 可缺省时 render 返回 null 而非抛错(空值)", () => {
    const boundary = new ErrorBoundary({});
    expect(boundary.render()).toBeNull();
    const typed: ReactNode = undefined;
    expect(typed).toBeUndefined();
  });
});
