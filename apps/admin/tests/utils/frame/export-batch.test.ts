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

import { createCancelToken, CancelledExportError } from "../../../src/utils/frame/export-cancel";
import { prepareFrameJobs } from "../../../src/utils/frame/export-jobs";
import { renderFrameBatch, runFrameExport } from "../../../src/utils/frame/export-pipeline";
import type { FrameRenderRequest } from "../../../src/utils/frame/types";
import { JPEG_QUALITY } from "../../../src/utils/frame/types";

/**
 * 批次调度单测(被测模块 `src/utils/frame/export-batch.ts`)。
 *
 * 本层只管三件事:怎么拿到一张的产物(Worker 池 / 主线程串行两条通道)、单张失败怎么收敛
 * (决策 D7)、取消后怎么停止派发。断言的观测点因此全在「池被建了几次、并发多少、派发了哪些请求、
 * 失败文案是什么」上,而不是 zip 结构(那在 `zip-writer.test.ts`)与汇总形状(门面层)。
 *
 * 六类边界:空值(零任务不建池)、零值(0 字节文件)、越界(超上限由 `export-jobs` 管,本层不重复)、
 * 权限缺失(以「能力缺失」代替:`supportsWorkerRendering()` 为 false 必须走主线程串行)、
 * 网络失败(上游失败:渲染抛错、产物字节取不到)、非法状态迁移(在途取消、池销毁后仍渲染)。
 */

harness.installExportBoundaryHooks();

// ---------------------------------------------------------------- Worker 通道

describe("runFrameExport · Worker 通道的派发与失败收敛", () => {
  it("决策 D7:单张解码失败不中断批次,失败逐条回报且明细一致", async () => {
    const ledger = harness.createLedger();
    harness.exportMode.auto = (request) =>
      request.fileName === "b"
        ? new Error(harness.DECODE_ERROR_MESSAGE)
        : {
            blob: harness.createTrackedBlob(harness.textBytes(request.fileName), ledger),
            width: 400,
            height: 300,
            exifInjected: false
          };
    const failed = vi.fn();
    const summary = await runFrameExport(
      [
        harness.jpegFile("a.jpg"),
        harness.jpegFile("b.jpg", 400, 300, 2),
        harness.jpegFile("c.jpg", 400, 300, 3)
      ],
      harness.settings,
      { onJobFailed: failed }
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].message).toContain("无法解码");
    expect(summary.failures[0].fileName).toBe("b.jpg");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(summary.failures[0]);
    const entries = await harness.readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "c.jpg"]);
  });

  it("决策 D20:请求带 target、质量恒 0.92、字体表与 EXIF 头由主线程备齐", async () => {
    harness.autoSuccess(harness.createLedger());
    await runFrameExport([harness.jpegFile("a.jpg", 400, 300)], harness.settings);
    const [request] = harness.onlyPool().renders;
    expect(request.jpegQuality).toBe(JPEG_QUALITY);
    expect(request.styleId).toBe("plain-frame");
    expect(request.logoMark).toBe("PH");
    expect(request.logoBlob).toBeNull();
    expect(request.fields).toEqual({ brand: "FixtureCam" });
    expect(request.target).toEqual({ width: 400, height: 300 });
  });

  it("上游失败:产物字节取不到 → 收敛成单张失败,批次继续", async () => {
    const ledger = harness.createLedger();
    harness.exportMode.auto = (request) => ({
      blob:
        request.fileName === "b"
          ? ({
              async arrayBuffer(): Promise<ArrayBuffer> {
                throw new Error("Blob 已失效");
              }
            } as unknown as Blob)
          : harness.createTrackedBlob(harness.textBytes(request.fileName), ledger),
      width: 400,
      height: 300,
      exifInjected: false
    });
    const summary = await runFrameExport(
      [
        harness.jpegFile("a.jpg"),
        harness.jpegFile("b.jpg", 400, 300, 2),
        harness.jpegFile("c.jpg", 400, 300, 3)
      ],
      harness.settings
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].fileName).toBe("b.jpg");
    expect(summary.failures[0].message).toBe("导出失败: Blob 已失效");
  });

  it("零值与退化输入:0 字节文件不再读头,渲染失败后批次继续", async () => {
    const ledger = harness.createLedger();
    harness.exportMode.auto = (request) =>
      request.blob.size === 0
        ? new Error(harness.DECODE_ERROR_MESSAGE)
        : {
            blob: harness.createTrackedBlob(harness.textBytes(request.fileName), ledger),
            width: 400,
            height: 300,
            exifInjected: false
          };
    const summary = await runFrameExport(
      [new File([], "empty.jpg", { lastModified: 1 }), harness.jpegFile("ok.jpg", 400, 300, 2)],
      harness.settings
    );
    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failures[0].fileName).toBe("empty.jpg");
    const [empty, ok] = harness.onlyPool().renders;
    expect(empty.exifHead).toBeNull();
    expect(ok.exifHead).toBeInstanceOf(Uint8Array);
  });

  it("进度回报顺序 = 落包顺序:并发 1 时严格「渲染 → 落包 → 回报」交替", async () => {
    const ledger = harness.createLedger();
    harness.exportBoundaryDoubles.memoryAwareConcurrency.mockReturnValue(1);
    harness.autoSuccess(ledger);
    const events: string[] = [];
    const inner = harness.exportMode.auto;
    harness.exportMode.auto = (request) => {
      events.push(`produce:${request.fileName}`);
      return inner ? inner(request) : new Error(harness.DECODE_ERROR_MESSAGE);
    };
    const files = Array.from({ length: 4 }, (_unused, index) =>
      harness.jpegFile(`s${String(index)}.jpg`, 400, 300, index)
    );
    const summary = await runFrameExport(files, harness.settings, {
      onJobDone: (result) => events.push(`done:${result.fileName}|${String(ledger.handedOver)}`)
    });
    expect(summary.succeeded).toBe(4);
    // done 时的 handedOver 已经 +1 ⇒ 页面看到的「已完成 N 张」恒等于「已落包 N 张」,进度条不会假完成
    expect(events).toEqual([
      "produce:s0",
      "done:s0.jpg|1",
      "produce:s1",
      "done:s1.jpg|2",
      "produce:s2",
      "done:s2.jpg|3",
      "produce:s3",
      "done:s3.jpg|4"
    ]);
  });
});

// ---------------------------------------------------------------- 失败文案分类

describe("失败文案分类(决策 D7 的可执行性)", () => {
  const cases: Array<[string, string]> = [
    [harness.DECODE_ERROR_MESSAGE, "无法解码该图片"],
    ["当前环境既无 OffscreenCanvas 也无 DOM canvas, 无法缩放图片。", "画布创建失败"],
    ["渲染 Worker 意外停止。", "渲染 Worker 异常停止"],
    ["unexpected state", "导出失败: unexpected state"]
  ];

  for (const [cause, expected] of cases) {
    it(`「${cause.slice(0, 24)}…」→ 归类为「${expected}」,且批次不中止`, async () => {
      const jobs = await prepareFrameJobs([
        harness.jpegFile("a.jpg"),
        harness.jpegFile("b.jpg", 400, 300, 2)
      ]);
      harness.autoFail(cause);
      const outcome = await renderFrameBatch(jobs, harness.settings);
      expect(outcome.failures).toHaveLength(2);
      expect(outcome.failures.every((failure) => failure.message.includes(expected))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- 主线程降级通道(D6)

describe("runFrameExport · 主线程降级通道(能力缺失)", () => {
  beforeEach(() => {
    harness.exportBoundaryDoubles.supportsWorkerRendering.mockReturnValue(false);
  });

  it("不建池、串行、usedWorker=false,zip 照样是 STORE 包", async () => {
    const ledger = harness.createLedger();
    harness.exportBoundaryDoubles.renderFrame.mockImplementation(
      async (request: FrameRenderRequest) => ({
        blob: harness.createTrackedBlob(harness.textBytes(request.fileName), ledger),
        width: 400,
        height: 300,
        exifInjected: true
      })
    );
    const summary = await runFrameExport(
      [harness.jpegFile("a.jpg"), harness.jpegFile("b.jpg", 400, 300, 2)],
      harness.settings
    );
    expect(harness.createFrameWorkerPool).not.toHaveBeenCalled(); // 降级路径绝不拉起 Worker 池
    expect(ledger.peak).toBe(1); // 并发写死 1:主线程同时画两张会直接卡死交互
    const entries = await harness.readZip(summary.zip);
    expect(entries.every((entry) => entry.compression === 0)).toBe(true);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(harness.exportBoundaryDoubles.renderFrame).toHaveBeenCalledTimes(2);
  });

  it("降级通道的解码失败同样收敛成单张失败", async () => {
    harness.exportBoundaryDoubles.renderFrame.mockRejectedValue(
      new Error(harness.DECODE_ERROR_MESSAGE)
    );
    const jobs = await prepareFrameJobs([
      harness.jpegFile("a.jpg"),
      harness.jpegFile("b.jpg", 400, 300, 2)
    ]);
    const outcome = await renderFrameBatch(jobs, harness.settings);
    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0].message).toContain("无法解码");
    expect(outcome.failures[0].fileName).toBe("a.jpg");
  });

  it("取消后已产出的字节不落包:该张既不成功也不失败,整包作废", async () => {
    const ledger = harness.createLedger();
    const token = createCancelToken();
    harness.exportBoundaryDoubles.renderFrame.mockImplementation(
      async (request: FrameRenderRequest) => {
        token.cancel(); // 模拟「画完的同一刻用户点了取消」
        return {
          blob: harness.createTrackedBlob(harness.textBytes(request.fileName), ledger),
          width: 400,
          height: 300,
          exifInjected: false
        };
      }
    );
    const promise = runFrameExport(
      [harness.jpegFile("a.jpg"), harness.jpegFile("b.jpg", 400, 300, 2)],
      harness.settings,
      undefined,
      token
    );
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(harness.exportBoundaryDoubles.renderFrame).toHaveBeenCalledTimes(1); // 剩下的不再派发
    expect(ledger.handedOver).toBe(0); // 一份字节都没交给 zip
  });
});

// ---------------------------------------------------------------- 派发守卫与取消

describe("runRenderBatch · 派发守卫与取消", () => {
  it("空值:零任务不建池、不渲染,返回空账", async () => {
    const outcome = await renderFrameBatch([], harness.settings);
    expect(outcome).toEqual({ results: [], failures: [] });
    expect(harness.createFrameWorkerPool).not.toHaveBeenCalled();
  });

  it("在途取消:停止派发新任务、reject 在途、关池、不产出 zip", async () => {
    const token = createCancelToken();
    const done = vi.fn();
    const files = Array.from({ length: 5 }, (_unused, index) =>
      harness.jpegFile(`q${String(index)}.jpg`, 400, 300, index)
    );
    const promise = runFrameExport(files, harness.settings, { onJobDone: done }, token);
    await vi.waitFor(() => expect(harness.onlyPool().renders).toHaveLength(2));
    const pool = harness.onlyPool();
    token.cancel();
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(pool.cancelCalls).toBe(1);
    expect(pool.terminateCalls).toBe(1); // 取消路径同样要关池
    expect(pool.renders).toHaveLength(2); // 剩下的 3 张没进渲染队列
    expect(pool.pending).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });

  it("非法状态迁移:池销毁后不再接受渲染", async () => {
    const pool = new harness.FakePool(1);
    pool.terminate();
    await expect(pool.render({ fileName: "x" } as FrameRenderRequest)).rejects.toThrow(
      "Worker 池已销毁"
    );
  });
});
