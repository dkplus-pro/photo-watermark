import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import {
  CANCELLED_ERROR_MESSAGE,
  NO_FILES_ERROR_MESSAGE,
  CancelledExportError,
  createCancelToken,
  isCancelledExport,
  noSuccessMessage,
  renderFrameBatch,
  runFrameExport
} from "../../../src/utils/frame/export-pipeline";
import { prepareFrameJobs } from "../../../src/utils/frame/export-jobs";
import { createZipWriter } from "../../../src/utils/frame/zip-writer";
import { FRAME_FONTS } from "../../../src/utils/frame/fonts";
import { JPEG_QUALITY } from "../../../src/utils/frame/types";
import type {
  FrameJob,
  FrameRenderRequest,
  FrameRenderSettings,
  FrameWorkerResult
} from "../../../src/utils/frame/types";
import { buildJpegHead } from "../../fixtures/build-image-containers";

/**
 * 导出流水线单测(阶段 10)。容器级尺寸用例在 `image-size-probe.test.ts`,本文件只管流水线。
 *
 * 流水线自己不做动作,它编排的是四个外部边界,mock 因此只打在这四个边界上:
 * `worker-pool`(jsdom 没有真 Worker)、`render-core`(没有画布也没有解码器)、`fields`(exifr)、
 * `capability`(设备能力;同时用它模拟「Worker 不可用」的降级环境)。
 * `resolveOutputSize`、`export-jobs`、`export-batch`、`zip-writer`、`exif.readHeadBytes`、`file-name`
 * 全部走真实实现——「尺寸先于派发」「流式 STORE 包能否被解压」「同名去重」正是本层的被测行为,
 * mock 掉就没有东西可测(AGENTS 第 8 节:禁止为通过测试而 mock 被测函数的内部实现)。
 *
 * 六类边界对照:
 * - 空值:空文件列表、空 jobs、尺寸探测失败、`exifHead` 为 null;
 * - 零值:0 字节文件;
 * - 越界:源图 48MP 超 canvas 面积上限、尺寸完全未知时的档位兜底;
 * - 权限缺失:本站无鉴权,以「能力缺失」代替——`supportsWorkerRendering()` 为 false 必须走主线程串行;
 * - 网络失败(上游失败):解码抛错、产物字节取不到、二次解码也失败;
 * - 非法状态迁移:取消后仍派发、池销毁后仍渲染、已放弃的包再写入、复用已取消的令牌。
 */

// ---------------------------------------------------------------- 边界替身

/**
 * 全部替身必须在 `vi.hoisted` 里造:`vi.mock` 工厂在**导入阶段**就会执行,
 * 那时测试文件顶层的 const 还没初始化(AGENTS 第 8 节的 mock 纪律不豁免这条技术约束)。
 */
const { FakePool, mode, pools, createFrameWorkerPool, doubles } = vi.hoisted(() => {
  interface Slot {
    resolve(value: FrameWorkerResult): void;
    reject(reason: Error): void;
  }

  /**
   * Worker 池替身。两种模式:
   * - `mode.auto` 有值 → 派发后在微任务里自动回报(返回 Error 即该张失败);
   * - `mode.auto` 为 null → 在途任务留在 `pending` 里由用例手动放行,用于精确复现取消竞态。
   * `renders` / `maxInFlight` / `cancelCalls` / `terminateCalls` 是本文件对「派发行为」的全部观测点。
   */
  class FakePool {
    readonly renders: FrameRenderRequest[] = [];
    readonly pending: Slot[] = [];
    inFlight = 0;
    maxInFlight = 0;
    cancelCalls = 0;
    terminateCalls = 0;

    constructor(readonly concurrency: number) {}

    render(request: FrameRenderRequest): Promise<FrameWorkerResult> {
      this.renders.push(request);
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      const release = (): void => {
        this.inFlight -= 1;
      };
      return new Promise<FrameWorkerResult>((resolve, reject) => {
        if (this.terminateCalls > 0) {
          release();
          reject(new Error("Worker 池已销毁, 无法继续渲染。"));
          return;
        }
        const auto = mode.auto;
        if (auto) {
          queueMicrotask(() => {
            release();
            const outcome = auto(request);
            if (outcome instanceof Error) reject(outcome);
            else resolve(outcome);
          });
          return;
        }
        this.pending.push({
          resolve: (value) => {
            release();
            resolve(value);
          },
          reject: (reason) => {
            release();
            reject(reason);
          }
        });
      });
    }

    cancel(): void {
      this.cancelCalls += 1;
      for (const slot of this.pending.splice(0)) slot.reject(new Error("已取消"));
    }

    terminate(): void {
      this.terminateCalls += 1;
    }

    /** 手动放行最早的一个在途任务(取消竞态用例用)。 */
    settle(outcome: FrameWorkerResult | Error): void {
      const slot = this.pending.shift();
      if (!slot) throw new Error("没有在途任务可放行");
      if (outcome instanceof Error) slot.reject(outcome);
      else slot.resolve(outcome);
    }
  }

  const mode: { auto: ((request: FrameRenderRequest) => FrameWorkerResult | Error) | null } = {
    auto: null
  };
  const pools: FakePool[] = [];
  const createFrameWorkerPool = vi.fn((concurrency: number) => {
    const pool = new FakePool(concurrency);
    pools.push(pool);
    return pool;
  });
  const doubles = {
    supportsWorkerRendering: vi.fn(),
    probeMaxCanvasArea: vi.fn(),
    memoryAwareConcurrency: vi.fn(),
    renderFrame: vi.fn(),
    mainThreadSurface: { createCanvas: vi.fn(), loadFonts: vi.fn() },
    decodeImageScaled: vi.fn(),
    extractPhotoExif: vi.fn(),
    frameFieldsFromExif: vi.fn()
  };
  return { FakePool, mode, pools, createFrameWorkerPool, doubles };
});

vi.mock("../../../src/utils/frame/worker-pool", () => ({ createFrameWorkerPool }));

vi.mock("../../../src/utils/frame/render-core", () => ({
  renderFrame: doubles.renderFrame,
  mainThreadSurface: doubles.mainThreadSurface,
  decodeImageScaled: doubles.decodeImageScaled
}));

vi.mock("../../../src/utils/frame/fields", () => ({
  extractPhotoExif: doubles.extractPhotoExif,
  frameFieldsFromExif: doubles.frameFieldsFromExif
}));

// resolveOutputSize 留真:「档位 + 画布上限 → 目标尺寸」是流水线交给 Worker 的核心结论,必须真算。
vi.mock("../../../src/utils/frame/capability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/utils/frame/capability")>();
  return {
    ...actual,
    supportsWorkerRendering: doubles.supportsWorkerRendering,
    probeMaxCanvasArea: doubles.probeMaxCanvasArea,
    memoryAwareConcurrency: doubles.memoryAwareConcurrency
  };
});

// ---------------------------------------------------------------- 观测替身与夹具

/** 产物 Blob 的在途账:证明「同时存活的产物数」压在并发数量级,而不是整批驻留。 */
interface BlobLedger {
  live: number;
  peak: number;
  handedOver: number;
}

const createLedger = (): BlobLedger => ({ live: 0, peak: 0, handedOver: 0 });

/**
 * 只实现 `arrayBuffer()` 的 Blob 替身:zip 写入只用到这一个成员,
 * 而「字节有没有真被交出去」只能靠自己计数(真 Blob 无从观察)。
 */
const createTrackedBlob = (bytes: Uint8Array, ledger: BlobLedger): Blob => {
  ledger.live += 1;
  ledger.peak = Math.max(ledger.peak, ledger.live);
  let consumed = false;
  return {
    size: bytes.length,
    type: "image/jpeg",
    async arrayBuffer(): Promise<ArrayBuffer> {
      if (!consumed) {
        consumed = true;
        ledger.live -= 1;
        ledger.handedOver += 1;
      }
      return bytes.slice().buffer;
    }
  } as unknown as Blob;
};

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const jpegFile = (name: string, width = 400, height = 300, lastModified = 1000): File =>
  new File([buildJpegHead(width, height)], name, { type: "image/jpeg", lastModified });

const unparsableFile = (name: string, lastModified = 1000): File =>
  new File([textBytes("unparsable container bytes")], name, { lastModified });

const settings: FrameRenderSettings = {
  tier: "medium",
  styleId: "plain-frame",
  logoMark: "PH",
  logoBlob: null
};

const DECODE_ERROR_MESSAGE = "无法解码该图片: 浏览器不支持此编码(HEIC/RAW)或文件已损坏";

/** 自动回报成功的渲染:产物字节就是任务主名,zip 里的名字则要加扩展名,便于逐条对账。 */
const autoSuccess = (ledger: BlobLedger, width = 400, height = 300): void => {
  mode.auto = (request) => ({
    blob: createTrackedBlob(textBytes(request.fileName), ledger),
    width,
    height,
    exifInjected: true
  });
};

const autoFail = (message: string): void => {
  mode.auto = () => new Error(message);
};

interface ZipEntryInfo {
  name: string;
  compression: number;
  size: number;
  compressedSize: number;
}

/**
 * 解析 zip 的**中央目录**(而不是扫本地文件头):`ZipPassThrough` 写入时总长未知,
 * fflate 会在数据后补一个 data descriptor,本地头里的尺寸字段恒为 0,靠它跳条目必然错位。
 * 中央目录能同时给出名字、压缩方法与尺寸,读通它本身就是在验证包结构合法。
 */
const readCentralDirectory = (bytes: Uint8Array): ZipEntryInfo[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是合法 zip:找不到中央目录结束记录");
  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count); // 总条目数与两处的条目数一致
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntryInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("中央目录条目错位");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: String.fromCharCode(...bytes.slice(offset + 46, offset + 46 + nameLength)),
      compression: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const readZip = async (blob: Blob): Promise<ZipEntryInfo[]> =>
  readCentralDirectory(new Uint8Array(await blob.arrayBuffer()));

const onlyPool = (): FakePool => {
  expect(pools).toHaveLength(1);
  return pools[0];
};

beforeEach(() => {
  mode.auto = null;
  pools.length = 0;
  doubles.renderFrame.mockReset();
  doubles.decodeImageScaled.mockReset();
  doubles.supportsWorkerRendering.mockReturnValue(true);
  doubles.probeMaxCanvasArea.mockResolvedValue(25_165_824);
  doubles.memoryAwareConcurrency.mockReturnValue(2);
  doubles.extractPhotoExif.mockResolvedValue({ cameraMake: "FixtureCam" });
  doubles.frameFieldsFromExif.mockReturnValue({ brand: "FixtureCam" });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------- 派发前的准备

describe("prepareFrameJobs · 派发前的主线程准备", () => {
  it("id 可预测、fileName 只留消毒后的主名、exifHead 是源图头字节", async () => {
    const files = [jpegFile("a.jpg", 400, 300, 111), jpegFile("photo.2026.01.jpg", 400, 300, 222)];
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
    const jobs = await prepareFrameJobs([jpegFile("../../etc:passwd\u0001.jpg")]);
    expect(jobs[0].fileName).toBe(".._.._etc_passwd_");
  });

  it("上游失败:EXIF 读不到时 exifHead 为 null,任务照建(元数据缺失不是导出失败)", async () => {
    const jobs = await prepareFrameJobs([unparsableFile("a.heic")]);
    expect(jobs[0].exifHead).toBeNull();
    expect(jobs[0].fileName).toBe("a");
  });

  it("非法状态迁移:令牌已取消时立刻抛取消错误,且不读文件", async () => {
    const token = createCancelToken();
    token.cancel();
    await expect(prepareFrameJobs([jpegFile("a.jpg")], token)).rejects.toBeInstanceOf(
      CancelledExportError
    );
    expect(doubles.extractPhotoExif).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- Worker 路径

describe("runFrameExport · Worker 路径", () => {
  it("正常出包:一个 STORE zip,条目名字与字节逐条对得上,汇总字段完整", async () => {
    const ledger = createLedger();
    autoSuccess(ledger);
    const summary = await runFrameExport(
      [jpegFile("a.jpg"), jpegFile("b.jpg", 800, 600, 1001)],
      settings
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.total).toBe(2);
    expect(summary.failures).toEqual([]);
    expect(summary.zipFileName).toMatch(/^frame-export-\d{4}-\d{2}-\d{2}\.zip$/u);
    expect(summary.zip.type).toBe("application/zip");

    const entries = await readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);
    // level 0:JPEG 已是熵编码,再套 deflate 只烧 CPU(方案里「Zip({ level: 0 })」的实际形态)
    expect(entries.every((entry) => entry.compression === 0)).toBe(true);
    expect(entries.every((entry) => entry.compressedSize === entry.size)).toBe(true);
    expect(entries.map((entry) => entry.compressedSize)).toEqual([1, 1]); // 产物字节就是任务主名(见下)
    // 独立实现复核:fflate 自己也解得开,内容逐条对得上,说明包结构合法而不只是头部看着像
    const unzipped = unzipSync(new Uint8Array(await summary.zip.arrayBuffer()));
    expect(Object.keys(unzipped)).toEqual(["a.jpg", "b.jpg"]);
    expect(new TextDecoder().decode(unzipped["a.jpg"])).toBe("a");
    expect(new TextDecoder().decode(unzipped["b.jpg"])).toBe("b");
    expect(onlyPool().terminateCalls).toBe(1); // 正常路径也要关池
  });

  it("zip 内同名去重:第二张落 -2 而不是被覆盖", async () => {
    autoSuccess(createLedger());
    const summary = await runFrameExport(
      [jpegFile("IMG_1.jpg", 400, 300, 1), jpegFile("IMG_1.jpg", 400, 300, 2)],
      settings
    );
    const entries = await readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["IMG_1.jpg", "IMG_1-2.jpg"]);
    expect(summary.succeeded).toBe(2);
  });

  it("决策 D7:单张解码失败不中断批次,失败逐条回报且明细一致", async () => {
    const ledger = createLedger();
    mode.auto = (request) =>
      request.fileName === "b"
        ? new Error(DECODE_ERROR_MESSAGE)
        : {
            blob: createTrackedBlob(textBytes(request.fileName), ledger),
            width: 400,
            height: 300,
            exifInjected: false
          };
    const failed = vi.fn();
    const summary = await runFrameExport(
      [jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2), jpegFile("c.jpg", 400, 300, 3)],
      settings,
      { onJobFailed: failed }
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].message).toContain("无法解码");
    expect(summary.failures[0].fileName).toBe("b.jpg");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(summary.failures[0]);
    const entries = await readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "c.jpg"]);
  });

  it("全部失败 → 抛中文整批错误且不出空包(明细已逐条回报)", async () => {
    autoFail(DECODE_ERROR_MESSAGE);
    const done = vi.fn();
    const failed = vi.fn();
    await expect(
      runFrameExport([jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)], settings, {
        onJobDone: done,
        onJobFailed: failed
      })
    ).rejects.toThrow(noSuccessMessage(2));
    expect(done).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(isCancelledExport(new Error(noSuccessMessage(2)))).toBe(false);
    expect(onlyPool().terminateCalls).toBe(1); // 全失败路径也必须关池
  });

  it("空值:一张图都没选 → 不建池、不渲染,直接中文错误", async () => {
    await expect(runFrameExport([], settings)).rejects.toThrow(NO_FILES_ERROR_MESSAGE);
    expect(createFrameWorkerPool).not.toHaveBeenCalled();
    expect(pools).toHaveLength(0);
  });

  it("并发数取「最大输出面积」而不是「第一张」,池按它创建", async () => {
    autoSuccess(createLedger());
    await runFrameExport(
      [jpegFile("small.jpg", 200, 100), jpegFile("big.jpg", 8000, 6000, 2)],
      settings
    );
    // medium 档 12MP:8000×6000 → 4000×3000;200×100 原样 → 预算按大的那张
    expect(doubles.memoryAwareConcurrency).toHaveBeenCalledWith(4000, 3000, 2);
    expect(createFrameWorkerPool).toHaveBeenCalledTimes(1);
    expect(onlyPool().concurrency).toBe(2);
  });

  it("越界:源图超 canvas 上限时按探测面积夹,夹完的尺寸才进请求与预算", async () => {
    autoSuccess(createLedger());
    doubles.probeMaxCanvasArea.mockResolvedValue(2_000_000);
    await runFrameExport([jpegFile("big.jpg", 8000, 6000)], settings);
    expect(onlyPool().renders[0].target).toEqual({ width: 1632, height: 1224 });
    expect(doubles.memoryAwareConcurrency).toHaveBeenCalledWith(1632, 1224, 1);
  });

  it("决策 D20:请求带 target、质量恒 0.92、字体表与 EXIF 头由主线程备齐", async () => {
    autoSuccess(createLedger());
    await runFrameExport([jpegFile("a.jpg", 400, 300)], settings);
    const [request] = onlyPool().renders;
    expect(request.jpegQuality).toBe(JPEG_QUALITY);
    expect(request.styleId).toBe("plain-frame");
    expect(request.logoMark).toBe("PH");
    expect(request.logoBlob).toBeNull();
    expect(request.fonts).toBe(FRAME_FONTS);
    expect(request.fields).toEqual({ brand: "FixtureCam" });
    expect(request.target).toEqual({ width: 400, height: 300 });
  });

  it("探测失败的那张:整批只多解这一次(拿尺寸一次 + 出片一次)", async () => {
    autoSuccess(createLedger());
    const close = vi.fn();
    doubles.decodeImageScaled.mockResolvedValue({ width: 640, height: 480, close });
    await runFrameExport([unparsableFile("x.heic")], settings);
    expect(doubles.decodeImageScaled).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(onlyPool().renders).toHaveLength(1); // 出片那一次在池里(mock 的 Worker 渲染)
    expect(onlyPool().renders[0].target).toEqual({ width: 640, height: 480 });
    expect(doubles.memoryAwareConcurrency).toHaveBeenCalledWith(640, 480, 1);
  });

  it("上游失败兜到底:两次探测都失败 → target=null 按源图输出,并发按档位上限估", async () => {
    autoSuccess(createLedger());
    doubles.decodeImageScaled.mockRejectedValue(new Error(DECODE_ERROR_MESSAGE));
    // 头部不是任何已知容器 + 二次解码也失败 ⇒ 尺寸彻底未知
    await runFrameExport([unparsableFile("a.heic")], { ...settings, tier: "original" });
    expect(onlyPool().renders[0].target).toBeNull();
    expect(doubles.memoryAwareConcurrency).toHaveBeenCalledWith(4899, 4899, 1); // √24MP
  });

  it("内存纪律:同时在途的产物数不超过并发数,汇总里不留逐张产物", async () => {
    const ledger = createLedger();
    autoSuccess(ledger);
    const files = Array.from({ length: 8 }, (_unused, index) =>
      jpegFile(`p${String(index)}.jpg`, 400, 300, index)
    );
    const summary = await runFrameExport(files, settings);
    expect(summary.succeeded).toBe(8);
    expect(ledger.peak).toBeLessThanOrEqual(2); // 并发数 = 2
    expect(onlyPool().maxInFlight).toBeLessThanOrEqual(2);
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

  it("上游失败:产物字节取不到 → 收敛成单张失败,批次继续", async () => {
    const ledger = createLedger();
    mode.auto = (request) => ({
      blob:
        request.fileName === "b"
          ? ({
              async arrayBuffer(): Promise<ArrayBuffer> {
                throw new Error("Blob 已失效");
              }
            } as unknown as Blob)
          : createTrackedBlob(textBytes(request.fileName), ledger),
      width: 400,
      height: 300,
      exifInjected: false
    });
    const summary = await runFrameExport(
      [jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2), jpegFile("c.jpg", 400, 300, 3)],
      settings
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].fileName).toBe("b.jpg");
    expect(summary.failures[0].message).toBe("导出失败: Blob 已失效");
  });

  it("零值与退化输入:0 字节文件不再读头,渲染失败后批次继续", async () => {
    const ledger = createLedger();
    mode.auto = (request) =>
      request.blob.size === 0
        ? new Error(DECODE_ERROR_MESSAGE)
        : {
            blob: createTrackedBlob(textBytes(request.fileName), ledger),
            width: 400,
            height: 300,
            exifInjected: false
          };
    const summary = await runFrameExport(
      [new File([], "empty.jpg", { lastModified: 1 }), jpegFile("ok.jpg", 400, 300, 2)],
      settings
    );
    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failures[0].fileName).toBe("empty.jpg");
    const [empty, ok] = onlyPool().renders;
    expect(empty.exifHead).toBeNull();
    expect(ok.exifHead).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------- 失败文案分类

describe("失败文案分类(决策 D7 的可执行性)", () => {
  const cases: Array<[string, string]> = [
    [DECODE_ERROR_MESSAGE, "无法解码该图片"],
    ["当前环境既无 OffscreenCanvas 也无 DOM canvas, 无法缩放图片。", "画布创建失败"],
    ["渲染 Worker 意外停止。", "渲染 Worker 异常停止"],
    ["unexpected state", "导出失败: unexpected state"]
  ];

  for (const [cause, expected] of cases) {
    it(`「${cause.slice(0, 24)}…」→ 归类为「${expected}」,且批次不中止`, async () => {
      const jobs = await prepareFrameJobs([jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)]);
      autoFail(cause);
      const outcome = await renderFrameBatch(jobs, settings);
      expect(outcome.failures).toHaveLength(2);
      expect(outcome.failures.every((failure) => failure.message.includes(expected))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- 主线程降级路径(D6)

describe("runFrameExport · 主线程降级路径(能力缺失)", () => {
  beforeEach(() => {
    doubles.supportsWorkerRendering.mockReturnValue(false);
  });

  it("不建池、串行、usedWorker=false,zip 照样是 STORE 包", async () => {
    const ledger = createLedger();
    doubles.renderFrame.mockImplementation(async (request: FrameRenderRequest) => ({
      blob: createTrackedBlob(textBytes(request.fileName), ledger),
      width: 400,
      height: 300,
      exifInjected: true
    }));
    const summary = await runFrameExport(
      [jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)],
      settings
    );
    expect(createFrameWorkerPool).not.toHaveBeenCalled(); // 降级路径绝不拉起 Worker 池
    expect(ledger.peak).toBe(1); // 并发写死 1:主线程同时画两张会直接卡死交互
    const entries = await readZip(summary.zip);
    expect(entries.every((entry) => entry.compression === 0)).toBe(true);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(doubles.renderFrame).toHaveBeenCalledTimes(2);
  });

  it("降级路径的解码失败同样收敛成单张失败", async () => {
    doubles.renderFrame.mockRejectedValue(new Error(DECODE_ERROR_MESSAGE));
    const jobs = await prepareFrameJobs([jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)]);
    const outcome = await renderFrameBatch(jobs, settings);
    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0].message).toContain("无法解码");
    expect(outcome.failures[0].fileName).toBe("a.jpg");
  });

  it("取消后已产出的字节不落包:该张既不成功也不失败,整包作废", async () => {
    const ledger = createLedger();
    const token = createCancelToken();
    doubles.renderFrame.mockImplementation(async (request: FrameRenderRequest) => {
      token.cancel(); // 模拟「画完的同一刻用户点了取消」
      return {
        blob: createTrackedBlob(textBytes(request.fileName), ledger),
        width: 400,
        height: 300,
        exifInjected: false
      };
    });
    const promise = runFrameExport(
      [jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)],
      settings,
      undefined,
      token
    );
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(doubles.renderFrame).toHaveBeenCalledTimes(1); // 剩下的不再派发
    expect(ledger.handedOver).toBe(0); // 一份字节都没交给 zip
  });
});

describe("两条渲染路径同源(决策 D6)", () => {
  it("同一批文件在两条路径下的汇总形状、计数与失败文案完全一致", async () => {
    const files = [jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)];
    const jobs = await prepareFrameJobs(files);
    const oneFailure = (request: FrameRenderRequest): FrameWorkerResult | Error =>
      request.fileName === "b"
        ? new Error(DECODE_ERROR_MESSAGE)
        : {
            blob: new Blob([request.fileName]),
            width: 400,
            height: 300,
            exifInjected: false
          };

    doubles.supportsWorkerRendering.mockReturnValue(true);
    mode.auto = oneFailure;
    const worker = await runFrameExport(files, settings);
    const workerOutcome = await renderFrameBatch(jobs, settings);

    doubles.supportsWorkerRendering.mockReturnValue(false);
    mode.auto = null;
    doubles.renderFrame.mockImplementation(async (request: FrameRenderRequest) => {
      const outcome = oneFailure(request);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    const main = await runFrameExport(files, settings);
    const mainOutcome = await renderFrameBatch(jobs, settings);

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

// ---------------------------------------------------------------- 逐张产物 API

describe("renderFrameBatch · 逐张产物", () => {
  let jobs: FrameJob[] = [];

  beforeEach(async () => {
    jobs = await prepareFrameJobs([jpegFile("a.jpg"), jpegFile("b.jpg", 400, 300, 2)]);
  });

  it("空值:零任务不建池、不渲染,返回空账", async () => {
    const outcome = await renderFrameBatch([], settings);
    expect(outcome).toEqual({ results: [], failures: [] });
    expect(createFrameWorkerPool).not.toHaveBeenCalled();
  });

  it("结果如实带 usedWorker / exifInjected / 输出尺寸,并保留全部产物", async () => {
    autoSuccess(createLedger());
    const done = vi.fn();
    const outcome = await renderFrameBatch(jobs, settings, { onJobDone: done });
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
    expect(onlyPool().terminateCalls).toBe(1);
  });

  it("target 为 null 时按渲染端回报的尺寸记账(流水线不替 Worker 猜尺寸)", async () => {
    doubles.decodeImageScaled.mockRejectedValue(new Error(DECODE_ERROR_MESSAGE));
    mode.auto = (request) => ({
      blob: new Blob([request.fileName]),
      width: request.target ? request.target.width : 999,
      height: request.target ? request.target.height : 666,
      exifInjected: false
    });
    const outcome = await renderFrameBatch(
      await prepareFrameJobs([unparsableFile("x.heic")]),
      settings
    );
    expect(outcome.results[0]).toMatchObject({ width: 999, height: 666 });
  });

  it("这条 API 全失败也不抛错:产物与失败都如实交回调用方判断", async () => {
    autoFail(DECODE_ERROR_MESSAGE);
    const outcome = await renderFrameBatch(jobs, settings);
    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toHaveLength(2);
  });

  it("进度回报顺序 = 落包顺序:并发 1 时严格「渲染 → 落包 → 回报」交替", async () => {
    const ledger = createLedger();
    doubles.memoryAwareConcurrency.mockReturnValue(1);
    autoSuccess(ledger);
    const events: string[] = [];
    const inner = mode.auto;
    mode.auto = (request) => {
      events.push(`produce:${request.fileName}`);
      return inner ? inner(request) : new Error(DECODE_ERROR_MESSAGE);
    };
    const files = Array.from({ length: 4 }, (_unused, index) =>
      jpegFile(`s${String(index)}.jpg`, 400, 300, index)
    );
    const summary = await runFrameExport(files, settings, {
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

// ---------------------------------------------------------------- 取消

describe("取消语义", () => {
  it("createCancelToken:cancel 幂等且只通知一次;已取消后挂的监听立刻补通知", () => {
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

  it("在途取消:停止派发新任务、reject 在途、关池、不产出 zip", async () => {
    const token = createCancelToken();
    const done = vi.fn();
    const files = Array.from({ length: 5 }, (_unused, index) =>
      jpegFile(`q${String(index)}.jpg`, 400, 300, index)
    );
    const promise = runFrameExport(files, settings, { onJobDone: done }, token);
    await vi.waitFor(() => expect(onlyPool().renders).toHaveLength(2));
    const pool = onlyPool();
    token.cancel();
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(pool.cancelCalls).toBe(1);
    expect(pool.terminateCalls).toBe(1); // 取消路径同样要关池
    expect(pool.renders).toHaveLength(2); // 剩下的 3 张没进渲染队列
    expect(pool.pending).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });

  it("非法状态迁移:复用已取消的令牌再导出 → 立刻拒绝,一个 Worker 都不建", async () => {
    const token = createCancelToken();
    token.cancel();
    await expect(
      runFrameExport([jpegFile("a.jpg")], settings, undefined, token)
    ).rejects.toBeInstanceOf(CancelledExportError);
    expect(createFrameWorkerPool).not.toHaveBeenCalled();
  });

  it("非法状态迁移:池销毁后不再接受渲染", async () => {
    const pool = new FakePool(1);
    pool.terminate();
    await expect(pool.render({ fileName: "x" } as FrameRenderRequest)).rejects.toThrow(
      "Worker 池已销毁"
    );
  });

  it("非法状态迁移:已放弃的包再写入一律报「压缩包写入失败」前缀", async () => {
    const writer = createZipWriter();
    writer.discard();
    await expect(writer.add("a.jpg", new Blob(["x"]))).rejects.toThrow("压缩包写入失败");
    // finish 的前置校验是同步抛错(它没有 await),包成函数再断言
    expect(() => {
      void writer.finish();
    }).toThrow("压缩包写入失败");
  });

  it("取消发生在准备阶段时不建池也不写包", async () => {
    const token = createCancelToken();
    const ledger = createLedger();
    autoSuccess(ledger);
    const files = Array.from({ length: 4 }, (_unused, index) =>
      jpegFile(`r${String(index)}.jpg`, 400, 300, index)
    );
    const promise = runFrameExport(files, settings, undefined, token);
    // 准备阶段(EXIF 读取)中途取消:派发一次都不该发生
    doubles.extractPhotoExif.mockImplementation(async () => {
      token.cancel();
      return {};
    });
    await expect(promise).rejects.toBeInstanceOf(CancelledExportError);
    expect(ledger.handedOver).toBe(0);
    expect(pools).toHaveLength(0);
  });

  it("上游抛了同名消息不会被误判成取消(取消错误只在派发层抛)", async () => {
    const jobs = await prepareFrameJobs([jpegFile("a.jpg")]);
    autoFail(CANCELLED_ERROR_MESSAGE); // 渲染端抛了与取消同文本的错误
    const outcome = await renderFrameBatch(jobs, settings);
    // 令牌没被取消 ⇒ 该张按失败记账,整批照常收口而非抛取消
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.results).toEqual([]);
  });
});
