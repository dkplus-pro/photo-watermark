import { beforeEach, describe, expect, it, vi } from "vitest";

import * as harness from "./export-test-harness";

// mock 注册必须排在本文件对源码的 import 之前:vitest 只把 `vi.mock` 本身提升,
// 工厂引用的替身来自上面那个 harness import(它必须先于源码完成求值)。
vi.mock("../../../src/utils/frame/worker-pool", () => ({
  createFrameWorkerPool: harness.workerPoolMock.createFrameWorkerPool
}));
vi.mock("../../../src/utils/frame/render-core", () => harness.renderCoreMock);
vi.mock("../../../src/utils/frame/fields", () => harness.fieldsMock);
vi.mock("../../../src/utils/frame/capability", async (importOriginal) =>
  harness.capabilityMock(importOriginal)
);

import { prepareFrameJobs } from "../../../src/utils/frame/export-jobs";
import {
  NO_FILES_ERROR_MESSAGE,
  isCancelledExport,
  noSuccessMessage,
  renderFrameBatch,
  runFrameExport
} from "../../../src/utils/frame/export-pipeline";
import type {
  FrameJob,
  FrameRenderRequest,
  FrameWorkerResult
} from "../../../src/utils/frame/types";

/**
 * 门面层单测(被测模块 `src/utils/frame/export-pipeline.ts`)。
 *
 * 门面只做编排与产物去向,派发细节在 `export-batch.test.ts`、尺寸与并发预算在
 * `export-jobs.test.ts`、取消令牌在 `export-cancel.test.ts`、包结构在 `zip-writer.test.ts`,
 * 本文件只断言门面自己负责的那几件事:三种整批失败的口径、汇总对象的形状(绝不持有逐张产物)、
 * `renderFrameBatch` 这条 API「全失败也不抛错」的契约,以及两条渲染路径对外的形状一致(决策 D6)。
 *
 * 六类边界:空值(一张图都没选 → 连池都不建)、零值(产物数为 0 的账)、越界(整批全失败)、
 * 权限缺失(不适用:本 app 无鉴权)、网络失败(上游失败:每张都渲染失败)、
 * 非法状态迁移(取消判定与整批收口的分工,见 `export-cancel.test.ts`)。
 */

harness.installExportBoundaryHooks();

describe("runFrameExport · 整批失败口径与内存纪律", () => {
  it("全部失败 → 抛中文整批错误且不出空包(明细已逐条回报)", async () => {
    harness.autoFail(harness.DECODE_ERROR_MESSAGE);
    const done = vi.fn();
    const failed = vi.fn();
    await expect(
      runFrameExport(
        [harness.jpegFile("a.jpg"), harness.jpegFile("b.jpg", 400, 300, 2)],
        harness.settings,
        { onJobDone: done, onJobFailed: failed }
      )
    ).rejects.toThrow(noSuccessMessage(2));
    expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(isCancelledExport(new Error(noSuccessMessage(2)))).toBe(false);
    expect(harness.onlyPool().terminateCalls).toBe(1); // 全失败路径也必须关池
  });

  it("空值:一张图都没选 → 不建池、不渲染,直接中文错误", async () => {
    await expect(runFrameExport([], harness.settings)).rejects.toThrow(NO_FILES_ERROR_MESSAGE);
    expect(harness.createFrameWorkerPool).not.toHaveBeenCalled();
    expect(harness.exportPools).toHaveLength(0);
  });

  it("内存纪律:同时在途的产物数不超过并发数,汇总里不留逐张产物", async () => {
    const ledger = harness.createLedger();
    harness.autoSuccess(ledger);
    const files = Array.from({ length: 8 }, (_unused, index) =>
      harness.jpegFile(`p${String(index)}.jpg`, 400, 300, index)
    );
    const summary = await runFrameExport(files, harness.settings);
    expect(summary.succeeded).toBe(8);
    expect(ledger.peak).toBeLessThanOrEqual(2); // 并发数 = 2
    expect(harness.onlyPool().maxInFlight).toBeLessThanOrEqual(2);
    expect(ledger.handedOver).toBe(8);
    expect(ledger.live).toBe(0);
    // 汇总只有 zip,没有逐张产物集合:导出链路不持有那约 200MB 成品
    expect(Object.keys(summary).sort()).toEqual([
      "failures",
      "succeeded",
      "total",
      "zip",
      "zipFileName"
    ]);
  });
});

describe("两条渲染路径同源(决策 D6)", () => {
  it("同一批文件在两条路径下的汇总形状、计数与失败文案完全一致", async () => {
    const files = [harness.jpegFile("a.jpg"), harness.jpegFile("b.jpg", 400, 300, 2)];
    const jobs = await prepareFrameJobs(files);
    const oneFailure = (request: FrameRenderRequest): FrameWorkerResult | Error =>
      request.fileName === "b"
        ? new Error(harness.DECODE_ERROR_MESSAGE)
        : {
            blob: new Blob([request.fileName]),
            width: 400,
            height: 300,
            exifInjected: false
          };

    harness.exportBoundaryDoubles.supportsWorkerRendering.mockReturnValue(true);
    harness.exportMode.auto = oneFailure;
    const worker = await runFrameExport(files, harness.settings);
    const workerOutcome = await renderFrameBatch(jobs, harness.settings);

    harness.exportBoundaryDoubles.supportsWorkerRendering.mockReturnValue(false);
    harness.exportMode.auto = null;
    harness.exportBoundaryDoubles.renderFrame.mockImplementation(
      async (request: FrameRenderRequest) => {
        const outcome = oneFailure(request);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    );
    const main = await runFrameExport(files, harness.settings);
    const mainOutcome = await renderFrameBatch(jobs, harness.settings);

    expect(Object.keys(worker).sort()).toEqual(Object.keys(main).sort());
    expect(worker.succeeded).toBe(main.succeeded);
    expect(worker.total).toBe(main.total);
    expect(worker.failures).toEqual(main.failures);
    expect(worker.zipFileName).toBe(main.zipFileName);
    expect(worker.zip.type).toBe(main.zip.type);
    expect(Object.keys(workerOutcome.results[0]).sort()).toEqual(
      Object.keys(mainOutcome.results[0]).sort()
    );
    expect(workerOutcome.results[0].usedWorker).toBe(true);
    expect(mainOutcome.results[0].usedWorker).toBe(false);
    expect(
      workerOutcome.results.map((result) => [result.jobId, result.fileName, result.width])
    ).toEqual(mainOutcome.results.map((result) => [result.jobId, result.fileName, result.width]));
  });
});

describe("renderFrameBatch · 逐张产物", () => {
  let jobs: FrameJob[] = [];

  beforeEach(async () => {
    jobs = await prepareFrameJobs([
      harness.jpegFile("a.jpg"),
      harness.jpegFile("b.jpg", 400, 300, 2)
    ]);
  });

  it("结果如实带 usedWorker / exifInjected / 输出尺寸,并保留全部产物", async () => {
    harness.autoSuccess(harness.createLedger());
    const done = vi.fn();
    const outcome = await renderFrameBatch(jobs, harness.settings, { onJobDone: done });
    expect(outcome.failures).toEqual([]);
    expect(outcome.results.map((result) => result.fileName)).toEqual(["a.jpg", "b.jpg"]);
    expect(outcome.results[0]).toMatchObject({
      jobId: jobs[0].id,
      width: 400,
      height: 300,
      usedWorker: true,
      exifInjected: true
    });
    expect(done).toHaveBeenCalledTimes(2);
    expect(harness.onlyPool().terminateCalls).toBe(1);
  });

  it("target 为 null 时按渲染端回报的尺寸记账(流水线不替 Worker 猜尺寸)", async () => {
    harness.exportBoundaryDoubles.decodeImageScaled.mockRejectedValue(
      new Error(harness.DECODE_ERROR_MESSAGE)
    );
    harness.exportMode.auto = (request) => ({
      blob: new Blob([request.fileName]),
      width: request.target ? request.target.width : 999,
      height: request.target ? request.target.height : 666,
      exifInjected: false
    });
    const outcome = await renderFrameBatch(
      await prepareFrameJobs([harness.unparsableFile("x.heic")]),
      harness.settings
    );
    expect(outcome.results[0]).toMatchObject({ width: 999, height: 666 });
  });

  it("这条 API 全失败也不抛错:产物与失败都如实交回调用方判断", async () => {
    harness.autoFail(harness.DECODE_ERROR_MESSAGE);
    const outcome = await renderFrameBatch(jobs, harness.settings);
    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toHaveLength(2);
  });
});
