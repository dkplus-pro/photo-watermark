// PageState 四态组件边界(方案 docs/hybrid-capability-plan.md 卡 5.2;
// 六类边界:空值/零值/越界/非法状态迁移)。
// 组件测试形态 = 直接调用函数组件 + element 树结构断言(无 jsdom/testing-library)。
import { Children, createElement, Fragment, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ View: "View", Text: "Text" }));

import { PageState } from "../src/component/PageState";
import { Skeleton } from "../src/component/Skeleton";
import {
  PAGE_STATE_DEFAULT_EMPTY_MESSAGE,
  PAGE_STATE_DEFAULT_ERROR_MESSAGE,
  PAGE_STATE_RETRY_LABEL,
  resolvePageStateCopy,
  type PageStatus
} from "../src/component/page-state-logic";

function propsOf(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

function childrenOf(element: ReactElement): ReactElement[] {
  return Children.toArray(propsOf(element)["children"]) as ReactElement[];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolvePageStateCopy(四态文案解析)", () => {
  it("PST1 默认文案:error/empty 不传文案时回退默认(空值)", () => {
    expect(resolvePageStateCopy({ status: "error", retryable: false }).message).toBe(
      PAGE_STATE_DEFAULT_ERROR_MESSAGE
    );
    expect(resolvePageStateCopy({ status: "empty", retryable: false }).message).toBe(
      PAGE_STATE_DEFAULT_EMPTY_MESSAGE
    );
    expect(PAGE_STATE_DEFAULT_ERROR_MESSAGE).toBe("加载失败,请稍后重试");
    expect(PAGE_STATE_DEFAULT_EMPTY_MESSAGE).toBe("暂无数据");
  });

  it("PST2 纯空白回退默认文案,合法文案原样(空值)", () => {
    expect(
      resolvePageStateCopy({ status: "error", errorMessage: "   ", retryable: false }).message
    ).toBe(PAGE_STATE_DEFAULT_ERROR_MESSAGE);
    expect(
      resolvePageStateCopy({ status: "empty", emptyMessage: " ", retryable: false }).message
    ).toBe(PAGE_STATE_DEFAULT_EMPTY_MESSAGE);
    expect(
      resolvePageStateCopy({ status: "error", errorMessage: "网络开小差", retryable: false })
        .message
    ).toBe("网络开小差");
  });

  it("PST3 loading/success 无文案无重试(零值)", () => {
    for (const status of ["loading", "success"] as const) {
      expect(resolvePageStateCopy({ status, retryable: true })).toEqual({
        message: "",
        showRetry: false
      });
    }
  });

  it("PST4 非法 status 兜底 error 默认文案且不给重试(非法状态迁移)", () => {
    const copy = resolvePageStateCopy({ status: "bogus" as PageStatus, retryable: true });
    expect(copy).toEqual({ message: PAGE_STATE_DEFAULT_ERROR_MESSAGE, showRetry: false });
  });

  it("PST5 retryable 派生:仅 error 态生效", () => {
    expect(resolvePageStateCopy({ status: "error", retryable: true }).showRetry).toBe(true);
    expect(resolvePageStateCopy({ status: "empty", retryable: true }).showRetry).toBe(false);
  });
});

describe("PageState 渲染", () => {
  it("PST6 loading 态复用 Skeleton", () => {
    const tree = PageState({ status: "loading" }) as ReactElement;
    expect(tree.type).toBe(Skeleton);
  });

  it("PST7 error 态重试回调透传;缺省 onRetry 无重试节点(空值)", () => {
    const onRetry = vi.fn();
    const tree = PageState({ status: "error", onRetry }) as ReactElement;
    expect(propsOf(tree)["className"]).toBe("page-state");
    const [textNode, retryNode] = childrenOf(tree);
    expect(propsOf(textNode)["children"]).toBe(PAGE_STATE_DEFAULT_ERROR_MESSAGE);
    expect(propsOf(retryNode)["className"]).toBe("page-state__retry");
    expect(propsOf(retryNode)["children"]).toBe(PAGE_STATE_RETRY_LABEL);
    (propsOf(retryNode)["onClick"] as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);

    const noRetry = PageState({ status: "error" }) as ReactElement;
    expect(childrenOf(noRetry)).toHaveLength(1);
  });

  it("PST8 success 态透传 children;empty 态渲染文案", () => {
    const child = createElement("div", null, "content");
    const tree = PageState({ status: "success", children: child }) as ReactElement;
    expect(tree.type).toBe(Fragment);
    expect(propsOf(tree)["children"]).toBe(child);

    const empty = PageState({ status: "empty" }) as ReactElement;
    expect(propsOf(childrenOf(empty)[0])["children"]).toBe(PAGE_STATE_DEFAULT_EMPTY_MESSAGE);
  });
});
