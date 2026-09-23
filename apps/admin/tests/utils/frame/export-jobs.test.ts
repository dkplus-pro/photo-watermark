import { describe, expect, it, vi } from "vitest";

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

import { CancelledExportError, createCancelToken } from "../../../src/utils/frame/export-cancel";
import { prepareFrameJobs } from "../../../src/utils/frame/export-jobs";
import { runFrameExport } from "../../../src/utils/frame/export-pipeline";

/**
 * 派发前准备单测(被测模块 `src/utils/frame/export-jobs.ts`)。
 *
 * 覆盖 `prepareFrameJobs` 的任务整形,以及「尺寸先于派发」(决策 D20)的三档兜底:
 * 头部解析 → 二次解码 → 彻底未知时按档位上限估。尺寸与并发数都只在流水线里才可见,
 * 因此这半边用例经 `runFrameExport` 驱动,断言的是**交给池的那张请求**与**并发预算入参**。
 *
 * 六类边界:空值(EXIF 读不到 → `exifHead` 为 null)、零值(尺寸未知时的档位兜底)、
 * 越界(源图超 canvas 面积上限)、权限缺失(不适用:本 app 无鉴权)、
 * 网络失败(上游失败:EXIF 解析失败、探测与二次解码都失败)、非法状态迁移(令牌已取消时不读文件)。
 */

harness.installExportBoundaryHooks();

describe("prepareFrameJobs · 派发前的主线程准备", () => {
  it("id 可预测、fileName 只留消毒后的主名、exifHead 是源图头字节", async () => {
    const files = [
      harness.jpegFile("a.jpg", 400, 300, 111),
      harness.jpegFile("photo.2026.01.jpg", 400, 300, 222)
    ];
    const jobs = await prepareFrameJobs(files);
    expect(jobs.map((job) => job.id)).toEqual([
      `frame-job-0-${String(files[0].size)}-111`,
      `frame-job-1-${String(files[1].size)}-222`
    ]);
    // 日期点属于主名:只在最后一个点处切,不能切成 photo
    expect(jobs.map((job) => job.fileName)).toEqual(["a", "photo.2026.01"]);
    expect(jobs[0].fields).toEqual({ brand: "FixtureCam" });
    expect(Array.from(jobs[0].exifHead?.slice(0, 2) ?? [])).toEqual([0xff, 0xd8]);
  });

  it("越界文件名被消毒(路径穿越与控制字符不留存)", async () => {
    const jobs = await prepareFrameJobs([harness.jpegFile("../../etc:passwd\u0001.jpg")]);
    expect(jobs[0].fileName).toBe(".._.._etc_passwd_");
  });

  it("上游失败:EXIF 读不到时 exifHead 为 null,任务照建(元数据缺失不是导出失败)", async () => {
    const jobs = await prepareFrameJobs([harness.unparsableFile("a.heic")]);
    expect(jobs[0].exifHead).toBeNull();
    expect(jobs[0].fileName).toBe("a");
  });

  it("非法状态迁移:令牌已取消时立刻抛取消错误,且不读文件", async () => {
    const token = createCancelToken();
    token.cancel();
    await expect(prepareFrameJobs([harness.jpegFile("a.jpg")], token)).rejects.toBeInstanceOf(
      CancelledExportError
    );
    expect(harness.exportBoundaryDoubles.extractPhotoExif).not.toHaveBeenCalled();
  });
});

describe("buildRenderUnits · 尺寸先于派发(决策 D20)", () => {
  it("并发数取「最大输出面积」而不是「第一张」,池按它创建", async () => {
    harness.autoSuccess(harness.createLedger());
    await runFrameExport(
      [harness.jpegFile("small.jpg", 200, 100), harness.jpegFile("big.jpg", 8000, 6000, 2)],
      harness.settings
    );
    // medium 档 12MP:8000×6000 → 4000×3000;200×100 原样 → 预算按大的那张
    expect(harness.exportBoundaryDoubles.memoryAwareConcurrency).toHaveBeenCalledWith(
      4000,
      3000,
      2
    );
    expect(harness.createFrameWorkerPool).toHaveBeenCalledTimes(1);
    expect(harness.onlyPool().concurrency).toBe(2);
  });

  it("越界:源图超 canvas 上限时按探测面积夹,夹完的尺寸才进请求与预算", async () => {
    harness.autoSuccess(harness.createLedger());
    harness.exportBoundaryDoubles.probeMaxCanvasArea.mockResolvedValue(2_000_000);
    await runFrameExport([harness.jpegFile("big.jpg", 8000, 6000)], harness.settings);
    expect(harness.onlyPool().renders[0].target).toEqual({ width: 1632, height: 1224 });
    expect(harness.exportBoundaryDoubles.memoryAwareConcurrency).toHaveBeenCalledWith(
      1632,
      1224,
      1
    );
  });

  it("探测失败的那张:整批只多解这一次(拿尺寸一次 + 出片一次)", async () => {
    harness.autoSuccess(harness.createLedger());
    const close = vi.fn();
    harness.exportBoundaryDoubles.decodeImageScaled.mockResolvedValue({
      width: 640,
      height: 480,
      close
    });
    await runFrameExport([harness.unparsableFile("x.heic")], harness.settings);
    expect(harness.exportBoundaryDoubles.decodeImageScaled).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.onlyPool().renders).toHaveLength(1); // 出片那一次在池里(mock 的 Worker 渲染)
    expect(harness.onlyPool().renders[0].target).toEqual({ width: 640, height: 480 });
    expect(harness.exportBoundaryDoubles.memoryAwareConcurrency).toHaveBeenCalledWith(640, 480, 1);
  });

  it("上游失败兜到底:两次探测都失败 → target=null 按源图输出,并发按档位上限估", async () => {
    harness.autoSuccess(harness.createLedger());
    harness.exportBoundaryDoubles.decodeImageScaled.mockRejectedValue(
      new Error(harness.DECODE_ERROR_MESSAGE)
    );
    // 头部不是任何已知容器 + 二次解码也失败 ⇒ 尺寸彻底未知
    await runFrameExport([harness.unparsableFile("a.heic")], {
      ...harness.settings,
      tier: "original"
    });
    expect(harness.onlyPool().renders[0].target).toBeNull();
    expect(harness.exportBoundaryDoubles.memoryAwareConcurrency).toHaveBeenCalledWith(
      4899,
      4899,
      1
    ); // √24MP
  });
});
