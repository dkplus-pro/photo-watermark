import { displayNameOf, sanitizeBaseName } from "../file-name";
import { memoryAwareConcurrency } from "../frame/capability";
import { readProbeHeadBytes } from "../frame/image-size-probe";
import { compressImage } from "./compress-core";
import type { CompressRequest, CompressResult } from "./compress-core";
import { createCompressPool, supportsCompressWorker } from "./compress-pool";
import {
  detectAlphaFromHead,
  extensionOfMime,
  imageKindOf,
  needsAlphaFlatten,
  qualityOfPercent,
  resolveOutputMime
} from "./format";
import type { CompressOutputMode } from "./format";
import { supportsWebpEncoding } from "./webp-support";

/**
 * 压缩批处理(页面消费的唯一引擎入口,范式同 frame/export-batch)。
 *
 * 职责边界:每张的格式决策靠 format.ts 的纯函数,单张执行靠 compress-core,
 * 本层只负责「怎么派发、怎么收敛失败、怎么取消」。三条纪律与渲染批处理同源:
 * 1. **格式决策先于派发**:MIME 在主线程算好,Worker 只执行(Safari 编不出 WebP 这类
 *    环境差异不进 Worker 逻辑);
 * 2. **单张失败不中断批次**(D7):任何一张的异常都收敛成失败回报并继续派发;
 * 3. **池必在 finally 里 terminate**:漏一次就是每批泄漏一批 Worker。
 *
 * 并发数由 `memoryAwareConcurrency` 给出(纪律:禁止按 hardwareConcurrency 开并发);
 * 压缩不做解码期缩放,画布面积=源图像素,按整批已知最大源尺寸算预算,未知尺寸按
 * 1200 万像素的保守口径参与计算。
 */

/** 批处理里的一个任务:页面已入队的条目;width/height 是探测结果,0 表示未知。 */
export interface CompressBatchItem {
  readonly id: string;
  readonly file: File;
  readonly width: number;
  readonly height: number;
}

export interface CompressBatchSettings {
  readonly mode: CompressOutputMode;
  /** 质量百分比整数(50–95);转换与守卫见 format.qualityOfPercent */
  readonly qualityPercent: number;
}

export interface CompressItemResult {
  readonly id: string;
  readonly blob: Blob;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** 实际编码出的 MIME(可能与请求不同,扩展名跟它走) */
  readonly mime: string;
  /** 落盘文件名:消毒主名 + 实际 MIME 的扩展名 */
  readonly fileName: string;
}

export interface CompressItemFailure {
  readonly id: string;
  readonly message: string;
}

export interface CompressProgressHandlers {
  onItemStarted?(id: string): void;
  onItemDone?(result: CompressItemResult): void;
  onItemFailed?(failure: CompressItemFailure): void;
}

export interface CompressBatchTally {
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

/**
 * 取消令牌:派发循环在槽位间轮询它,轮到即停;在途任务等自然结束(≤并发数张),
 * 不做打断——压缩的单张耗时远短于渲染,轮询语义已经足够,页面取消后本来就会清空列表。
 */
export interface CompressCancelToken {
  readonly cancelled: boolean;
  cancel(): void;
}

export const createCompressCancelToken = (): CompressCancelToken => {
  let cancelled = false;
  return {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      cancelled = true;
    }
  };
};

// ---------------------------------------------------------------- 失败收敛

const DECODE_FAILURE_MESSAGE = "无法解码该图片: 浏览器可能不支持此编码(如 HEIC)或文件已损坏";
const CANVAS_FAILURE_MESSAGE = "画布创建失败: 设备绘图上限不足, 请改用更小的源图";
const WORKER_FAILURE_MESSAGE = "压缩 Worker 异常停止, 请重试";

/** 与渲染批处理同一条翻译纪律:分类给处置动作,不把技术栈原样端给用户。 */
const describeCompressFailure = (cause: unknown): string => {
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (/解码|不支持此编码|unsupported|corrupt|damaged/iu.test(reason)) return DECODE_FAILURE_MESSAGE;
  if (/上下文|canvas|画布|面积超出/iu.test(reason)) return CANVAS_FAILURE_MESSAGE;
  if (/worker/iu.test(reason)) return `${WORKER_FAILURE_MESSAGE} (${reason})`;
  return `压缩失败: ${reason}`;
};

// ---------------------------------------------------------------- 派发

/** 怎么拿到一张的产物:Worker 池或主线程串行(降级路径必须存在,两条路径共用 compressImage)。 */
interface CompressChannel {
  readonly produce: (request: CompressRequest) => Promise<CompressResult>;
  readonly concurrency: number;
  readonly dispose?: () => void;
}

const openChannel = (concurrency: number): CompressChannel => {
  if (!supportsCompressWorker()) {
    // 主线程只有一个,串行并发 1:并发压缩会把交互直接卡死(与渲染降级同一口径)。
    return { produce: (request) => compressImage(request), concurrency: 1 };
  }
  const pool = createCompressPool(concurrency);
  return { produce: (request) => pool.run(request), concurrency, dispose: () => pool.terminate() };
};

/** 未知源尺寸参与内存预算的保守口径(约 1200 万像素,移动端中档照片的常见量级)。 */
const UNKNOWN_SIZE = { width: 4096, height: 3072 };

const batchConcurrencyOf = (items: readonly CompressBatchItem[]): number => {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const item of items) {
    if (item.width > maxWidth) maxWidth = item.width;
    if (item.height > maxHeight) maxHeight = item.height;
  }
  // memoryAwareConcurrency 要求输出尺寸;压缩没有缩放,源尺寸即输出尺寸。
  return memoryAwareConcurrency(
    maxWidth > 0 ? maxWidth : UNKNOWN_SIZE.width,
    maxHeight > 0 ? maxHeight : UNKNOWN_SIZE.height,
    items.length
  );
};

/** 一张图的完整请求:头部透明探测 → 格式决策 → 质量换算,全部在派发前做完。 */
const buildRequest = async (
  item: CompressBatchItem,
  settings: CompressBatchSettings,
  webpSupported: boolean
): Promise<CompressRequest> => {
  const kind = imageKindOf(item.file.type, item.file.name);
  const head = await readProbeHeadBytes(item.file);
  const hasAlpha = detectAlphaFromHead(head, kind);
  const mime = resolveOutputMime({ kind, mode: settings.mode, hasAlpha, webpSupported });
  return {
    fileName: item.file.name,
    blob: item.file,
    mime,
    fallbackMime: hasAlpha ? "image/png" : "image/jpeg",
    quality: qualityOfPercent(settings.qualityPercent),
    flattenAlpha: needsAlphaFlatten(mime, hasAlpha)
  };
};

/**
 * 跑完一批压缩:逐张派发、逐张回报。空批次不建任何资源,直接返回零账。
 */
export const runCompressBatch = async (
  items: readonly CompressBatchItem[],
  settings: CompressBatchSettings,
  handlers?: CompressProgressHandlers,
  cancel?: CompressCancelToken
): Promise<CompressBatchTally> => {
  const tally = { succeeded: 0, failed: 0 };
  if (items.length === 0) return { ...tally, cancelled: false };
  const cancelled = (): boolean => Boolean(cancel?.cancelled);
  const webpSupported = await supportsWebpEncoding();
  if (cancelled()) return { succeeded: 0, failed: 0, cancelled: true };

  const channel = openChannel(batchConcurrencyOf(items));
  let cursor = 0;
  let stopped = false;

  const settleItem = async (item: CompressBatchItem): Promise<void> => {
    let request: CompressRequest;
    try {
      request = await buildRequest(item, settings, webpSupported);
    } catch (cause) {
      // 头部读取等预决策失败也按单张失败收敛,不让一张坏文件停住整批(D7)。
      if (!cancelled()) tally.failed += 1;
      handlers?.onItemFailed?.({ id: item.id, message: describeCompressFailure(cause) });
      return;
    }
    if (cancelled()) {
      stopped = true;
      return;
    }
    handlers?.onItemStarted?.(item.id);
    let result: CompressResult;
    try {
      result = await channel.produce(request);
    } catch (cause) {
      if (cancelled()) {
        stopped = true;
        return;
      }
      tally.failed += 1;
      handlers?.onItemFailed?.({ id: item.id, message: describeCompressFailure(cause) });
      return;
    }
    if (cancelled()) {
      // 取消后的产物不回报:页面马上要清空列表,迟到的完成只会把状态写脏。
      stopped = true;
      return;
    }
    tally.succeeded += 1;
    handlers?.onItemDone?.({
      id: item.id,
      blob: result.blob,
      size: result.blob.size,
      width: result.width,
      height: result.height,
      mime: result.mime,
      fileName: `${sanitizeBaseName(displayNameOf(item.file))}${extensionOfMime(result.mime)}`
    });
  };

  /**
   * 槽位各自从共享游标取任务(与渲染批处理同构):`items.map(run)` 会把 N 个 Promise 同时
   * 挂出去,「停止派发」就没有落点。取消判定只以令牌为准。
   */
  const slot = async (): Promise<void> => {
    while (!cancelled() && !stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await settleItem(items[index]);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, channel.concurrency) }, () => slot()));
  } finally {
    channel.dispose?.();
  }
  return { ...tally, cancelled: cancelled() || stopped };
};
