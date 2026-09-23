import { describe, expect, it, vi } from "vitest";

import * as harness from "./export-test-harness";

vi.mock("../../../src/utils/frame/worker-pool", () => ({
  createFrameWorkerPool: harness.workerPoolMock.createFrameWorkerPool
}));
vi.mock("../../../src/utils/frame/render-core", () => harness.renderCoreMock);
vi.mock("../../../src/utils/frame/fields", () => harness.fieldsMock);
vi.mock("../../../src/utils/frame/capability", async (importOriginal) =>
  harness.capabilityMock(importOriginal)
);

import {
  CANCELLED_ERROR_MESSAGE,
  CancelledExportError,
  createCancelToken,
  isCancelledExport
} from "../../../src/utils/frame/export-cancel";
import { prepareFrameJobs } from "../../../src/utils/frame/export-jobs";
import { renderFrameBatch, runFrameExport } from "../../../src/utils/frame/export-pipeline";

/**
 * 取消令牌单测(被测模块 `src/utils/frame/export-cancel.ts`)。
 *
 * 令牌本身是纯逻辑,但取消语义的**后果**只能在流水线里观测(停派发、不建池、不写包),
 * 因此本文件同时打满四个模块边界替身,与流水线其他文件共用同一份脚手架。
 *
 * 六类边界:空值/零值/越界/权限缺失(不适用,本 app 无鉴权)在本文件不适用;
 * 网络失败(上游失败)= 渲染端抛同名消息;非法状态迁移 = 复用已取消令牌、准备阶段中途取消。
 */

harness.installExportBoundaryHooks();

describe("createCancelToken · 令牌自身语义", () => {
  it("cancel 幂等且只通知一次;已取消后挂的监听立刻补通知", () => {
    const token = createCancelToken();
    const first = vi.fn();
    const second = vi.fn();
    token.onChange(first);
    token.cancel();
    token.cancel();
    token.onChange(second);
    expect(token.cancelled).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(isCancelledExport(new CancelledExportError())).toBe(true);
    expect(isCancelledExport(new Error(CANCELLED_ERROR_MESSAGE))).toBe(true); // 跨包副本兜底
    expect(isCancelledExport(new Error("boom"))).toBe(false);
  });
});

describe("取消语义 · 在流水线里的落点", () => {
  it("非法状态迁移:复用已取消的令牌再导出 → 立刻拒绝,一个 Worker 都不建", async () => {
    const token = createCancelToken();
    token.cancel();
    await expect(
      runFrameExport([harness.jpegFile("a.jpg")], harness.settings, undefined, token)
    ).rejects.toBeInstanceOf(CancelledExportError);
    expect(harness.createFrameWorkerPool).not.toHaveBeenCalled();
  });

  it("取消发生在准备阶段时不建池也不写包", async () => {
    const token = createCancelToken();
    const ledger = harness.createLedger();
    harness.autoSuccess(ledger);
    const files = Array.from({ length: 4 }, (_unused, index) =>
      harness.jpegFile(`r${String(index)}.jpg`, 400, 300, index)
    );
    const promise = runFrameExport(files, harness.settings, undefined, token);
    // 准备阶段(EXIF 读取)中途取消:派发一次都不该发生
    harness.exportBoundaryDoubles.extractPhotoExif.mockImplementation(async () => {
      token.cancel();
      return {};
    });
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(ledger.handedOver).toBe(0);
    expect(harness.exportPools).toHaveLength(0);
  });

  it("上游抛了同名消息不会被误判成取消(取消错误只在派发层抛)", async () => {
    const jobs = await prepareFrameJobs([harness.jpegFile("a.jpg")]);
    harness.autoFail(CANCELLED_ERROR_MESSAGE); // 渲染端抛了与取消同文本的错误
    const outcome = await renderFrameBatch(jobs, harness.settings);
    // 令牌没被取消 ⇒ 该张按失败记账,整批照常收口而非抛取消
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.results).toEqual([]);
  });
});
