import {
  contextOf,
  createBitmapCanvas,
  decodeImageBitmapScaled,
  encodeCanvasBlob,
  releaseCanvas
} from "../bitmap";

/**
 * 单张压缩内核:解码 → (可选垫白底)→ 画布重编码 → 回报实际产物。
 *
 * 与渲染内核(renderFrame)同一条构造纪律:不 fetch、不碰 DOM(画布经 utils/bitmap 的
 * 双端工厂创建),Worker 与主线程降级路径调用**同一个函数**,产物构造上保证一致。
 *
 * 为什么压缩不做解码期缩放:压缩要「尺寸不变、体积变小」,缩放是另一个功能——
 * 这里恒按源图尺寸解码(`target = null`),画布面积因此等于源图像素,
 * 并发预算按源尺寸算(见 compress-batch)。
 */

/** 主线程 → Worker 的压缩请求;MIME 决策在主线程算好,Worker 只执行。 */
export interface CompressRequest {
  /** 仅用于失败排查日志可读性,不参与编码 */
  readonly fileName: string;
  readonly blob: Blob;
  /** 编码目标 MIME(主线程按模式与 WebP 支持度决定,见 format.resolveOutputMime) */
  readonly mime: string;
  /** 目标 MIME 编不出时的回退档(浏览器对不认识的 type 会静默回落成 PNG) */
  readonly fallbackMime: string;
  /** 编码质量 0..1,仅 JPEG/WebP 生效 */
  readonly quality: number;
  /** 输出 JPEG 且源图可能带透明时垫白底(否则透明会被合成到黑底上) */
  readonly flattenAlpha: boolean;
}

/** Worker → 主线程的压缩产物;`mime` 是**实际编码出的** MIME(可能与请求不同)。 */
export interface CompressResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
}

/**
 * 压缩一张。任何失败(解码/画布/编码)都抛中文错误,由批处理层收敛成单张失败;
 * 临时位图与画布在 finally 里释放(与 renderFrame 同一组泄漏教训)。
 *
 * 浏览器对不支持的编码 MIME 不报错而是静默回落(canvas 常回落 PNG):所以编码后按
 * `blob.type` 对账,不符就用回退档重编一次;回退档仍不符时如实回报实际类型,
 * 扩展名跟实际走,绝不产出「内容是 PNG、名字是 .webp」的错位文件。
 */
export const compressImage = async (request: CompressRequest): Promise<CompressResult> => {
  const bitmap = await decodeImageBitmapScaled(request.blob, null);
  const { width, height } = bitmap;
  let canvas: ReturnType<typeof createBitmapCanvas> | null = null;
  try {
    canvas = createBitmapCanvas(width, height);
    const context = contextOf(canvas);
    if (!context)
      throw new Error(
        `无法取得 ${width}×${height} 画布的 2d 上下文: 输出面积超出浏览器 canvas 上限。`
      );
    if (request.flattenAlpha) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    let blob = await encodeCanvasBlob(canvas, request.mime, request.quality);
    if (blob.type !== request.mime) {
      blob = await encodeCanvasBlob(canvas, request.fallbackMime, request.quality);
    }
    return { blob, width, height, mime: blob.type || request.fallbackMime };
  } finally {
    bitmap.close();
    if (canvas) releaseCanvas(canvas);
  }
};
