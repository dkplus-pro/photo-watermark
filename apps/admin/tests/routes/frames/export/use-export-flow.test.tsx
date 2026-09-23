// 导出主流程用例(阶段 13,`src/routes/frames/[styleId]/export/use-export-flow.ts`)。
// 六类边界落点:空值(一张都没选)、零值(total=0 的守卫由 store 用例锁,这里锁页面不建流水线)、
// 越界(在途流水线只允许一条)、权限缺失不适用(本站匿名公开、无鉴权,apps/admin/AGENTS.md 第 3 节)、
// 上游失败(普通异常 → failExport;非 Error 异常 → 兜底文案)、
// 非法状态迁移(取消后迟到的 onJobDone 不再计数;done 之后重复点导出)。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// harness 必须排在被测源码之前:下面的 vi.mock 工厂引用它的替身对象(vi.mock 会被提到顶部注册,
// 但工厂在被 mock 模块被求值时才执行,顺序错了就是 TDZ)。
import {
  exportTestDoubles,
  makeFailure,
  makeImageFile,
  makeSummary,
  makeTaskResult,
  resetExportStore,
  resetExportTestDoubles,
  storeFiles,
  storeState
} from "./export-test-harness";
import { useExportStore } from "../../../../src/store/export";
import { CancelledExportError } from "../../../../src/utils/frame/export-cancel";
import type {
  CancelToken,
  FrameExportSummary,
  FrameProgressHandlers,
  FrameRenderSettings
} from "../../../../src/utils/frame/types";
import { useExportFlow } from "../../../../src/routes/frames/[styleId]/export/use-export-flow";

vi.mock("../../../../src/utils/frame/export-pipeline", () => ({ ...exportTestDoubles }));
vi.mock("../../../../src/utils/download", () => ({ downloadBlob: exportTestDoubles.downloadBlob }));

/** 流水线被调用时页面传进来的四样东西,用例据此对账。 */
interface PipelineCall {
  files: readonly File[];
  settings: FrameRenderSettings;
  handlers: FrameProgressHandlers | undefined;
  token: CancelToken | undefined;
}

function enqueue(count: number) {
  useExportStore.getState().addFiles(Array.from({ length: count }, () => makeImageFile()));
  return storeFiles();
}

function renderFlow(files = storeFiles()) {
  return renderHook(() =>
    useExportFlow({
      files,
      styleId: "plain-frame",
      sizeTier: "small",
      logoSize: 8,
      logo: { logoMark: "JUZI", logoBlob: new Blob(["svg"]) }
    })
  );
}

/** 把一次 `await startExport()` 包进 act,顺手把微任务冲干净。 */
async function run(action: () => Promise<unknown> | void): Promise<void> {
  await act(async () => {
    await action();
  });
}

type Flow = ReturnType<typeof useExportFlow>;

/**
 * 发起一次「不会自己结束」的导出(流水线替身挂起,等用例推进)。
 * 这里必须 fire-and-forget:`await startExport()` 在替身永不 resolve 时就是 5s 超时,
 * 而且超时会把 act 队列留下脏状态,后面每个用例都变成 `result.current` 为 null 的连锁假失败。
 */
async function launch(flow: { current: Flow }): Promise<void> {
  await run(() => {
    void flow.current.startExport();
  });
  await waitFor(() => expect(storeState().status).toBe("exporting"));
}

function pipelineCalls(): PipelineCall[] {
  // `mock.calls[i]` 是**参数元组**不是命名对象;直接 `.files` 取到的是 undefined(运行时不报错,
  // 只在下一个断言上炸),所以这里显式拆成有名字的四样入参。
  return exportTestDoubles.runFrameExport.mock.calls.map(
    ([callFiles, callSettings, callHandlers, callToken]) => ({
      files: callFiles as readonly File[],
      settings: callSettings as FrameRenderSettings,
      handlers: callHandlers as FrameProgressHandlers | undefined,
      token: callToken as CancelToken | undefined
    })
  );
}

beforeEach(() => {
  resetExportTestDoubles();
  resetExportStore();
});

describe("空批次拦截", () => {
  test("空值:一张都没选 → 只给提示,不进 exporting、不建流水线", async () => {
    const { result } = renderFlow([]);

    await run(() => result.current.startExport());

    expect(result.current.noFilesHint).toBe(true);
    expect(storeState().status).toBe("idle");
    expect(storeState().total).toBe(0);
    expect(exportTestDoubles.runFrameExport).not.toHaveBeenCalled();
    expect(result.current.modalVisible).toBe(false);
  });

  test("提示在下一次发起时消失(不能让用户点过一次空批次就永久挂着黄条)", async () => {
    const files = enqueue(1);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());
    expect(result.current.noFilesHint).toBe(false);
  });
});

describe("成功分支", () => {
  test("端到端:入参、进度回报、finishExport、下载一次不落", async () => {
    const summary = makeSummary({ succeeded: 2, total: 2 });
    exportTestDoubles.runFrameExport.mockImplementation(
      async (): Promise<FrameExportSummary> => summary
    );
    const files = enqueue(2);
    const { result } = renderFlow(files);

    await run(() => result.current.startExport());

    const [call] = pipelineCalls();
    expect(call.files.map((file) => file.name)).toEqual(files.map((entry) => entry.file.name));
    expect(call.settings).toEqual({
      tier: "small",
      styleId: "plain-frame",
      logoMark: "JUZI",
      logoBlob: expect.any(Blob),
      // 滑杆档位原样进设置,scale 换算发生在渲染侧(use-export-flow 不参与)
      logoSize: 8
    });
    expect(call.token).toMatchObject({ cancelled: false });
    expect(storeState().status).toBe("done");
    expect(storeState().zipFileName).toBe(summary.zipFileName);
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledTimes(1);
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledWith(summary.zip, summary.zipFileName);
    expect(result.current.canRedownload).toBe(true);
  });

  test("handlers 直连 store:逐张回报进 done 计数,失败回报进失败列表", async () => {
    let observedHandlers: FrameProgressHandlers | undefined;
    exportTestDoubles.runFrameExport.mockImplementation(
      async (_files, _settings, handlers): Promise<FrameExportSummary> => {
        observedHandlers = handlers;
        return new Promise((resolve) => {
          queueMicrotask(() => resolve(makeSummary()));
        });
      }
    );
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    expect(storeState().status).toBe("done");
    // 终态之后的回报必须被 store 丢掉(否则进度条会在结果页上「复活」)。
    await run(() => observedHandlers?.onJobDone?.(makeTaskResult("job-late")));
    expect(storeState().done).toBe(0);
    expect(storeState().failures).toEqual([]);
    expect(result.current.exporting).toBe(false);
  });

  test("在途回报:exporting 中每回报一张就加一格,失败进列表", async () => {
    let handlers: FrameProgressHandlers | undefined;
    let release!: (summary: FrameExportSummary) => void;
    exportTestDoubles.runFrameExport.mockImplementation((_files, _settings, passedHandlers) => {
      handlers = passedHandlers;
      return new Promise<FrameExportSummary>((resolve) => {
        release = resolve;
      });
    });
    const files = enqueue(3);
    const { result } = renderFlow(files);
    await launch(result);

    expect(storeState().total).toBe(3);

    await run(() => handlers?.onJobDone?.(makeTaskResult("job-1")));
    await run(() => handlers?.onJobFailed?.(makeFailure("坏图.jpg", "无法解码")));
    expect(storeState().done).toBe(1);
    expect(storeState().failedCount).toBe(1);
    expect(storeState().failures).toEqual([makeFailure("坏图.jpg", "无法解码")]);
    expect(result.current.modalVisible).toBe(true);

    await run(() => release(makeSummary({ succeeded: 1, total: 3 })));
    await waitFor(() => expect(storeState().status).toBe("done"));
  });

  test("规则 7:产物 Blob 绝不进 store(store 里出现任何 Blob 都是内存事故)", async () => {
    exportTestDoubles.runFrameExport.mockResolvedValue(makeSummary());
    const files = enqueue(1);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    const blobs = Object.values(storeState()).filter((value) => value instanceof Blob);
    expect(blobs).toEqual([]);
    expect(storeState().zipFileName).toBe("frame-export-2026-09-23.zip");
    expect(result.current.canRedownload).toBe(true);
  });

  test("重新下载走同一份产物引用,并且不自己 revoke object URL", async () => {
    const summary = makeSummary();
    exportTestDoubles.runFrameExport.mockResolvedValue(summary);
    const files = enqueue(1);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());
    exportTestDoubles.downloadBlob.mockClear();

    await run(() => result.current.redownload());
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledTimes(1);
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledWith(summary.zip, summary.zipFileName);
  });

  test("越界:关掉结果弹框只清进度,用户挑好的图片与偏好都保留", async () => {
    exportTestDoubles.runFrameExport.mockResolvedValue(makeSummary());
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    await run(() => result.current.dismissModal());

    expect(storeState().status).toBe("idle");
    expect(storeState().done).toBe(0);
    expect(storeState().zipFileName).toBeNull();
    expect(storeFiles()).toHaveLength(2);
    expect(result.current.canRedownload).toBe(false);
    // 归零后再点导出,状态机重新从 idle 起步 —— 终态卡死是最难查的僵尸态。
    await run(() => result.current.startExport());
    expect(exportTestDoubles.runFrameExport).toHaveBeenCalledTimes(2);
    expect(storeState().status).toBe("done");
  });

  test("重置连产物引用一起放手(否则几百 MB 的 zip 会跟着组件常驻)", async () => {
    exportTestDoubles.runFrameExport.mockResolvedValue(makeSummary());
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());
    exportTestDoubles.downloadBlob.mockClear();

    await run(() => result.current.resetForm());

    expect(storeFiles()).toHaveLength(0);
    expect(storeState().status).toBe("idle");
    expect(result.current.canRedownload).toBe(false);
    await run(() => result.current.redownload());
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();
  });
});

describe("取消分支", () => {
  test("取消:令牌置位 → 流水线以 CancelledExportError 结束 → 回 idle 且不当失败处理", async () => {
    exportTestDoubles.runFrameExport.mockImplementation((_files, _settings, _h, token) => {
      return new Promise<FrameExportSummary>((_resolve, reject) => {
        token?.onChange(() => reject(new CancelledExportError()));
      });
    });
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await launch(result);

    await run(() => result.current.requestCancel());

    expect(pipelineCalls()[0].token?.cancelled).toBe(true);
    await waitFor(() => expect(storeState().status).toBe("idle"));
    // 再冲一次:拒绝是在 catch 里被消化掉的,不等它跑完就成了验「点下去的一瞬间」。
    await run(() => undefined);
    expect(storeState().error).toBeNull();
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();
    expect(result.current.modalVisible).toBe(false);
  });

  test("非法状态迁移:取消后迟到的 onJobDone 不再计数(进度条不许在关闭后复活)", async () => {
    let handlers: FrameProgressHandlers | undefined;
    let rejectPipeline!: (error: Error) => void;
    exportTestDoubles.runFrameExport.mockImplementation((_files, _settings, passedHandlers) => {
      handlers = passedHandlers;
      return new Promise<FrameExportSummary>((_resolve, reject) => {
        rejectPipeline = reject;
      });
    });
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await launch(result);

    await run(() => handlers?.onJobDone?.(makeTaskResult("job-1")));
    expect(storeState().done).toBe(1);

    await run(() => result.current.requestCancel());
    await run(() => rejectPipeline(new CancelledExportError()));
    await run(() => undefined);

    await run(() => handlers?.onJobDone?.(makeTaskResult("job-2")));
    expect(storeState().done).toBe(1);
    expect(storeState().status).toBe("idle");
    expect(storeState().failures).toEqual([]);
    expect(result.current.canRedownload).toBe(false);
  });

  test("越界:在途流水线只允许一条(连点两次导出只起一条链,不抢同一批 Worker)", async () => {
    exportTestDoubles.runFrameExport.mockImplementation(
      () => new Promise<FrameExportSummary>(() => undefined)
    );
    const files = enqueue(2);
    const { result } = renderFlow(files);

    await run(async () => {
      void result.current.startExport();
      void result.current.startExport();
    });
    await waitFor(() => expect(exportTestDoubles.runFrameExport).toHaveBeenCalledTimes(1));
    await run(() => undefined);
    expect(exportTestDoubles.runFrameExport).toHaveBeenCalledTimes(1);
    expect(storeState().total).toBe(2);
  });
});

describe("失败分支", () => {
  test("上游失败:异常消息直接进 error,不下载、不进 done", async () => {
    exportTestDoubles.runFrameExport.mockRejectedValue(
      new Error("画布创建失败：设备绘图上限不足，请改用更低档位")
    );
    const files = enqueue(2);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    expect(storeState().status).toBe("failed");
    expect(storeState().error).toBe("画布创建失败：设备绘图上限不足，请改用更低档位");
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();
    expect(result.current.modalVisible).toBe(true);
  });

  test("零值:抛的不是 Error(极端兜底)时给可操作的人话,而不是 undefined", async () => {
    exportTestDoubles.runFrameExport.mockImplementation(() => Promise.reject("boom"));
    const files = enqueue(1);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    expect(storeState().status).toBe("failed");
    expect(storeState().error).toMatch(/未知错误/u);
  });

  test("空消息的 Error 也走兜底文案(空白错误框比技术栈更没用)", async () => {
    exportTestDoubles.runFrameExport.mockRejectedValue(new Error("   "));
    const files = enqueue(1);
    const { result } = renderFlow(files);
    await run(() => result.current.startExport());

    expect(storeState().error).toMatch(/未知错误/u);
  });
});
