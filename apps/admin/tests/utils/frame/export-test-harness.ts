import { afterEach, beforeEach, expect, vi } from "vitest";

import { buildJpegHead } from "../../fixtures/build-image-containers";
import type {
  FrameRenderRequest,
  FrameRenderSettings,
  FrameWorkerResult
} from "../../../src/utils/frame/types";

/**
 * 导出流水线的测试脚手架(阶段 10 拆分自原 `export-pipeline.test.ts`)。
 *
 * 六个测试文件(`export-jobs` / `export-batch` / `export-cancel` / `export-pipeline` /
 * `zip-writer` / 门面用例)打的是**同一批模块边界替身**,观测点(`pools`、`mode`、`doubles`)
 * 必须跨文件共享同一份引用,否则「派发了几次」「在途多少产物」根本无从对账。
 *
 * 为什么 `vi.mock` 仍写在各个测试文件里:vitest 的提升语义要求 mock 注册发生在测试文件自身
 * 的导入阶段。本模块只提供替身与工厂,注册动作由各测试文件用
 * `vi.mock("../../../src/utils/frame/xxx", () => ({ ...exportTestDoubles }))` 完成 ——
 * 工厂体是惰性的,只要测试文件把本模块的 import 排在被测源码之前,替身就一定已初始化。
 *
 * mock 只打在这四个边界上(`worker-pool` jsdom 没有真 Worker、`render-core` 没有画布与解码器、
 * `fields` exifr、`capability` 设备能力);`resolveOutputSize`、`export-jobs`、`export-batch`、
 * `zip-writer`、`exif.readHeadBytes`、`file-name` 全部走真实实现——「尺寸先于派发」「流式 STORE 包
 * 能否被解压」「同名去重」正是被测行为,mock 掉就没有东西可测(AGENTS 第 8 节)。
 */

interface Slot {
  resolve(value: FrameWorkerResult): void;
  reject(reason: Error): void;
}

/**
 * Worker 池替身。两种模式:
 * - `exportMode.auto` 有值 → 派发后在微任务里自动回报(返回 Error 即该张失败);
 * - `exportMode.auto` 为 null → 在途任务留在 `pending` 里由用例手动放行,用于精确复现取消竞态。
 * `renders` / `maxInFlight` / `cancelCalls` / `terminateCalls` 是对「派发行为」的全部观测点。
 */
export class FakePool {
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
      const auto = exportMode.auto;
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

export const exportMode: {
  auto: ((request: FrameRenderRequest) => FrameWorkerResult | Error) | null;
} = { auto: null };

/** 每次 `createFrameWorkerPool` 造出的池,按创建顺序累积;每个用例开头清空。 */
export const exportPools: FakePool[] = [];

export const createFrameWorkerPool = vi.fn((concurrency: number) => {
  const pool = new FakePool(concurrency);
  exportPools.push(pool);
  return pool;
});

/** 四个模块边界上的替身函数;`exportBoundaryDoubles` 整体被测试文件的 mock 工厂引用。 */
export const exportBoundaryDoubles = {
  supportsWorkerRendering: vi.fn(),
  probeMaxCanvasArea: vi.fn(),
  memoryAwareConcurrency: vi.fn(),
  renderFrame: vi.fn(),
  mainThreadSurface: { createCanvas: vi.fn(), loadFonts: vi.fn() },
  decodeImageScaled: vi.fn(),
  extractPhotoExif: vi.fn(),
  frameFieldsFromExif: vi.fn()
};

/** `worker-pool` 的替身模块形状。 */
export const workerPoolMock = { createFrameWorkerPool };

/** `render-core` 的替身模块形状。 */
export const renderCoreMock = {
  renderFrame: exportBoundaryDoubles.renderFrame,
  mainThreadSurface: exportBoundaryDoubles.mainThreadSurface,
  decodeImageScaled: exportBoundaryDoubles.decodeImageScaled
};

/** `fields` 的替身模块形状。 */
export const fieldsMock = {
  extractPhotoExif: exportBoundaryDoubles.extractPhotoExif,
  frameFieldsFromExif: exportBoundaryDoubles.frameFieldsFromExif
};

/**
 * `capability` 的替身模块工厂:`resolveOutputSize` 留真。
 * 「档位 + 画布上限 → 目标尺寸」是流水线交给 Worker 的核心结论,必须真算,
 * 只有设备能力这三项(Worker 可用性 / canvas 面积上限 / 内存并发预算)被替身接管。
 */
export const capabilityMock = async (
  importOriginal: () => Promise<unknown>
): Promise<Record<string, unknown>> => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    supportsWorkerRendering: exportBoundaryDoubles.supportsWorkerRendering,
    probeMaxCanvasArea: exportBoundaryDoubles.probeMaxCanvasArea,
    memoryAwareConcurrency: exportBoundaryDoubles.memoryAwareConcurrency
  };
};

/** 产物 Blob 的在途账:证明「同时存活的产物数」压在并发数量级,而不是整批驻留。 */
export interface BlobLedger {
  live: number;
  peak: number;
  handedOver: number;
}

export const createLedger = (): BlobLedger => ({ live: 0, peak: 0, handedOver: 0 });

/**
 * 只实现 `arrayBuffer()` 的 Blob 替身:zip 写入只用到这一个成员,
 * 而「字节有没有真被交出去」只能靠自己计数(真 Blob 无从观察)。
 */
export const createTrackedBlob = (bytes: Uint8Array, ledger: BlobLedger): Blob => {
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

// 标注成裸 `Uint8Array` 会放宽成 `Uint8Array<ArrayBufferLike>`,TS 5.9 的 `BlobPart` 不认。
export const textBytes = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value);

export const jpegFile = (name: string, width = 400, height = 300, lastModified = 1000): File =>
  new File([buildJpegHead(width, height)], name, { type: "image/jpeg", lastModified });

export const unparsableFile = (name: string, lastModified = 1000): File =>
  new File([textBytes("unparsable container bytes")], name, { lastModified });

export const settings: FrameRenderSettings = {
  tier: "medium",
  styleId: "plain-frame",
  logoMark: "PH",
  logoBlob: null
};

export const DECODE_ERROR_MESSAGE = "无法解码该图片: 浏览器不支持此编码(HEIC/RAW)或文件已损坏";

/** 自动回报成功的渲染:产物字节就是任务主名,zip 里的名字则要加扩展名,便于逐条对账。 */
export const autoSuccess = (ledger: BlobLedger, width = 400, height = 300): void => {
  exportMode.auto = (request) => ({
    blob: createTrackedBlob(textBytes(request.fileName), ledger),
    width,
    height,
    exifInjected: true
  });
};

export const autoFail = (message: string): void => {
  exportMode.auto = () => new Error(message);
};

export interface ZipEntryInfo {
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
export const readCentralDirectory = (bytes: Uint8Array): ZipEntryInfo[] => {
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

export const readZip = async (blob: Blob): Promise<ZipEntryInfo[]> =>
  readCentralDirectory(new Uint8Array(await blob.arrayBuffer()));

/** 取本用例唯一那个池:多数用例只会建一个池,建了多个说明派发路径出了偏差。 */
export const onlyPool = (): FakePool => {
  expect(exportPools).toHaveLength(1);
  return exportPools[0];
};

/**
 * 挂上边界替身的复位钩子。默认设备能力是「Worker 可用 + canvas 上限 24MP + 并发预算 2」,
 * 需要降级环境(主线程串行)的测试文件在自己的 `beforeEach` 里覆写 `supportsWorkerRendering`。
 */
export const installExportBoundaryHooks = (): void => {
  beforeEach(() => {
    exportMode.auto = null;
    exportPools.length = 0;
    exportBoundaryDoubles.renderFrame.mockReset();
    exportBoundaryDoubles.decodeImageScaled.mockReset();
    exportBoundaryDoubles.supportsWorkerRendering.mockReturnValue(true);
    exportBoundaryDoubles.probeMaxCanvasArea.mockResolvedValue(25_165_824);
    exportBoundaryDoubles.memoryAwareConcurrency.mockReturnValue(2);
    exportBoundaryDoubles.extractPhotoExif.mockResolvedValue({ cameraMake: "FixtureCam" });
    exportBoundaryDoubles.frameFieldsFromExif.mockReturnValue({ brand: "FixtureCam" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
};
