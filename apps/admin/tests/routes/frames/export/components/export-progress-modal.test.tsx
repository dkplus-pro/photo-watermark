// 导出进度弹框用例(阶段 13)。
//
// 弹框是纯受控组件,所以这里只喂 props、只断言「状态 → 视图」的映射与三条硬口径:
// exporting/preparing 期间不可逃避、失败逐条列(D7)、进度按 (done+failedCount)/total 算。
// 取消/迟到回报那套时序在页面侧(store 才是状态机),见 page.test.tsx。
//
// 六类边界覆盖:
//   空值 —— visible=false 不挂载;failures 为空时不渲染明细区;
//   零值 —— total 为 0/负数/NaN 时进度按 0% 计,不许出现 NaN%;
//   越界 —— done+failedCount 冲过 total 时封顶 100%;失败明细 30 条全列不截断(「只报总数」即失败);
//   权限缺失 —— 不适用:本站匿名公开、无鉴权与权限码(apps/admin/AGENTS.md 第 3 节);
//   上游失败 —— status=failed 时整批错误消息与逐张失败原因都要露出;
//   非法状态迁移 —— 跑着的时候遮罩、Esc、关闭图标三条逃逸路径必须全关,唯一出口是「取消导出」。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// arco 内部走 findDOMNode(React 19 已移除),真机由 routes/layout.tsx 统一补适配层;
// 用例直接渲染弹框,故这里补同一入口,免得只有测试环境炸。
import "@arco-design/web-react/es/_util/react-19-adapter";

import ExportProgressModal from "../../../../../src/routes/frames/[styleId]/export/components/export-progress-modal";
import type { ExportProgressModalProps } from "../../../../../src/routes/frames/[styleId]/export/components/export-progress-modal";
import { MOBILE_SOFT_LIMIT } from "../../../../../src/store/export";
import type { FrameFailure } from "../../../../../src/utils/frame/types";

import { exportTestDoubles, makeFailure, resetExportTestDoubles } from "../export-test-harness";

// 弹框只读断点 hook,不读 store:唯一的模块边界就是响应式判定。
vi.mock("../../../../../src/hooks/use-responsive", () => ({
  useIsMobile: () => exportTestDoubles.responsive.isMobile,
  useIsTablet: () => exportTestDoubles.responsive.isTablet
}));

const TITLE = "导出进度";

const onCancelExport = vi.fn();
const onRedownload = vi.fn();
const onDismiss = vi.fn();

function makeProps(overrides: Partial<ExportProgressModalProps> = {}): ExportProgressModalProps {
  return {
    visible: true,
    status: "exporting",
    total: 4,
    done: 1,
    failedCount: 0,
    failures: [],
    zipFileName: null,
    error: null,
    canRedownload: false,
    onCancelExport,
    onRedownload,
    onDismiss,
    ...overrides
  };
}

function renderModal(overrides: Partial<ExportProgressModalProps> = {}) {
  const view = render(<ExportProgressModal {...makeProps(overrides)} />);
  return { ...view, modal: () => document.body.querySelector(".arco-modal") };
}

/** 弹框内容在 body 末尾的 portal 里,container 查不到,统一从 body 取。 */
function wrapper(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>(".arco-modal-wrapper");
  if (!node) throw new Error("弹框 wrapper 未挂载");
  return node;
}

function progressValue(): string | null {
  return document.body.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") as
    string | null;
}

function failureRows(): string[] {
  return Array.from(document.body.querySelectorAll(".export-progress-failure-item")).map(
    (row) => row.textContent ?? ""
  );
}

/** 点遮罩 = wrapper 上 mousedown + click(target 必须是 wrapper 自身,arco 以此判定「点在遮罩上」)。 */
function clickMask(): void {
  const node = wrapper();
  fireEvent.mouseDown(node);
  fireEvent.click(node);
}

function pressEscape(): void {
  const modal = document.body.querySelector(".arco-modal");
  fireEvent.keyDown(modal as Element, { key: "Escape" });
}

beforeEach(() => {
  resetExportTestDoubles();
  onCancelExport.mockClear();
  onRedownload.mockClear();
  onDismiss.mockClear();
});

afterEach(cleanup);

describe("挂载与可见性", () => {
  test("空值:visible=false 时内容不挂载(未点导出绝不该看到进度框)", () => {
    renderModal({ visible: false });

    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  test("标题常驻:打开即有「导出进度」,不随状态改名(用户认标题定位窗口)", () => {
    renderModal({ status: "preparing" });

    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });
});

describe("准备中(preparing)", () => {
  test("只报「正在准备」,不渲染进度条(总数还没定,任何百分比都是假数字)", () => {
    renderModal({ status: "preparing" });

    expect(screen.getByText(/正在准备/u)).toBeInTheDocument();
    expect(document.body.querySelector('[role="progressbar"]')).toBeNull();
  });

  test("非法状态迁移:preparing 同样锁死逃逸路径,底部一个按钮都没有", () => {
    renderModal({ status: "preparing" });

    expect(screen.queryByRole("button", { name: /取消导出/u })).not.toBeInTheDocument();
    expect(document.body.querySelector(".arco-modal-close-icon")).toBeNull();
    clickMask();
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onCancelExport).not.toHaveBeenCalled();
  });
});

describe("导出中(exporting)", () => {
  test("进度按「已回报 / 总数」算,计数文案把成功与失败分开报", () => {
    renderModal({ done: 2, failedCount: 1, total: 6 });

    expect(progressValue()).toBe("50");
    expect(screen.getByText(/已完成 2\/6 张, 失败 1 张/u)).toBeInTheDocument();
  });

  test("越界:done+failedCount 冲过 total 时封顶 100%,进度条不许溢出", () => {
    renderModal({ done: 3, failedCount: 1, total: 2 });
    expect(progressValue()).toBe("100");

    cleanup();
    renderModal({ done: 99, failedCount: 0, total: 1 });
    expect(progressValue()).toBe("100");
  });

  test("零值:total 为 0、负数、NaN 一律按 0%,进度条上不出现 NaN%", () => {
    for (const total of [0, -3, Number.NaN]) {
      renderModal({ total, done: 0, failedCount: 0 });
      expect(progressValue()).toBe("0");
      expect(
        document.body.querySelector(".arco-progress-line-text")?.textContent ?? ""
      ).not.toContain("NaN");
      cleanup();
    }
  });

  test("全失败的那一批也要走到 100%:只算 done 会让进度条永远停在 0", () => {
    renderModal({ done: 0, failedCount: 5, total: 5 });

    expect(progressValue()).toBe("100");
  });

  test("D7:失败逐条列,文件名与原因都在,三十条不许截断", () => {
    const failures: FrameFailure[] = Array.from({ length: 30 }, (_unused, index) =>
      makeFailure(`bad-${String(index)}.jpg`, `解码失败 ${String(index)}`)
    );
    renderModal({ failures, failedCount: failures.length, total: 40, done: 5 });

    const rows = failureRows();
    expect(rows).toHaveLength(30);
    expect(rows[0]).toContain("bad-0.jpg");
    expect(rows[0]).toContain("解码失败 0");
    expect(rows[29]).toContain("bad-29.jpg");
    // 「只报总数」的写法:明细区必须可滚动而不是被裁掉。
    expect(document.body.querySelector(".export-progress-failure-list")).not.toBeNull();
  });

  test("非法状态迁移:exporting 期间遮罩、Esc、关闭图标三条路都不回调,唯一出口是取消", () => {
    renderModal();

    expect(document.body.querySelector(".arco-modal-close-icon")).toBeNull();
    clickMask();
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onCancelExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /取消导出/u }));
    expect(onCancelExport).toHaveBeenCalledTimes(1);
  });

  test("D19:移动端大批量给软提示,且提示里没有按钮(不阻断)", () => {
    exportTestDoubles.responsive.isMobile = true;
    renderModal({ total: MOBILE_SOFT_LIMIT + 1 });

    expect(screen.getByText(/会较慢且占内存/u)).toBeInTheDocument();
    expect(document.body.querySelectorAll(".arco-modal-footer .arco-btn")).toHaveLength(1);
  });

  test("桌面同张数不提示(预算讲的是移动端),窄屏弹框换全宽", () => {
    renderModal({ total: MOBILE_SOFT_LIMIT + 1 });
    expect(screen.queryByText(/会较慢且占内存/u)).not.toBeInTheDocument();

    cleanup();
    exportTestDoubles.responsive.isMobile = true;
    renderModal({ total: MOBILE_SOFT_LIMIT + 1 });
    const modal = document.body.querySelector(".arco-modal") as HTMLElement;
    expect(modal.getAttribute("style") ?? "").toContain("calc(100vw - 24px)");
  });
});

describe("完成(done)", () => {
  test("成功态报出成功/失败张数与压缩包文件名,并留一条「浏览器没自动下载」的退路", () => {
    renderModal({
      status: "done",
      done: 2,
      failedCount: 1,
      total: 3,
      zipFileName: "frame-export.zip"
    });

    expect(screen.getByText("导出完成")).toBeInTheDocument();
    expect(screen.getByText(/成功 2 张, 失败 1 张/u)).toBeInTheDocument();
    expect(screen.getByText(/frame-export\.zip/u)).toBeInTheDocument();
    expect(screen.getByText(/浏览器没有自动下载/u)).toBeInTheDocument();
  });

  test("零值:产物引用已被页面丢弃时「重新下载」禁用(按钮在、点不动)", () => {
    renderModal({ status: "done", done: 2, total: 2 });

    const button = screen.getByRole("button", { name: /重新下载/u });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRedownload).not.toHaveBeenCalled();
  });

  test("页面还持有产物引用时,点「重新下载」把同一个 Blob 再交出去一次", () => {
    renderModal({ status: "done", done: 2, total: 2, canRedownload: true });

    fireEvent.click(screen.getByRole("button", { name: /重新下载/u }));
    expect(onRedownload).toHaveBeenCalledTimes(1);
  });

  test("解锁:终态下关闭按钮与遮罩都能收掉弹框(对照 exporting 的三条锁死)", async () => {
    renderModal({ status: "done", done: 1, total: 1 });

    clickMask();
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onCancelExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /关闭/u }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  test("部分成功的失败明细不许消失:哪几张没进包必须还能查(D7)", () => {
    renderModal({
      status: "done",
      done: 2,
      failedCount: 1,
      total: 3,
      zipFileName: "frame-export.zip",
      failures: [makeFailure("broken.jpg", "源图解码失败")]
    });

    expect(failureRows()).toEqual(["broken.jpg源图解码失败"]);
    expect(screen.getByText("导出完成")).toBeInTheDocument();
  });
});

describe("失败(failed)", () => {
  test("整批失败:错误消息原文露出,附逐张失败明细", () => {
    renderModal({
      status: "failed",
      done: 0,
      failedCount: 2,
      total: 2,
      error: "渲染引擎异常: Worker 全部退出",
      failures: [makeFailure("a.jpg", "解码失败"), makeFailure("b.jpg", "写入失败")]
    });

    expect(screen.getByText("导出失败")).toBeInTheDocument();
    expect(screen.getByText("渲染引擎异常: Worker 全部退出")).toBeInTheDocument();
    expect(failureRows()).toEqual(["a.jpg解码失败", "b.jpg写入失败"]);
  });

  test("空值:一条明细都没有时仍报整批消息,不渲染空列表", () => {
    renderModal({ status: "failed", failedCount: 0, total: 0, error: "打包失败" });

    expect(screen.getByText("打包失败")).toBeInTheDocument();
    expect(document.body.querySelector(".export-progress-failures")).toBeNull();
  });

  test("越界:error 为空串时回落到「未知错误」,不给用户一个空白弹框", () => {
    renderModal({ status: "failed", error: null });

    expect(screen.getByText("未知错误")).toBeInTheDocument();
  });
});

describe("idle", () => {
  test("取消后 store 归 idle:正文与页脚都空、关闭图标不再被锁(弹框由页面按 visible 收掉)", () => {
    renderModal({ status: "idle", total: 0, done: 0 });

    const content = document.body.querySelector(".arco-modal-content") as HTMLElement;
    expect(content.textContent).toBe("");
    expect(document.body.querySelector(".arco-modal-footer")).toBeNull();
    expect(document.body.querySelector('[role="progressbar"]')).toBeNull();
    expect(document.body.querySelector(".arco-modal-close-icon")).not.toBeNull();
  });
});
