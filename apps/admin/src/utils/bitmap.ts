/**
 * 通用位图底座:解码(含解码期缩放)、画布创建/释放、画布编码成 Blob。
 *
 * 从 `utils/frame/render-core.ts` 抽出的与「相框绘制」无关的纯底层,供渲染引擎与
 * 压缩引擎(`utils/compress/`)共用——两条链路对解码与编码的要求完全一致(解码期缩放、
 * Blob 化编码、显式释放 backing store),不应各自维护一份。
 *
 * 依赖纪律:只依赖浏览器内置 API,不 import 任何业务模块,Worker 与 node 单测里都要能独立运行。
 */

/** 渲染画布的双端形态:Worker 侧 OffscreenCanvas,主线程侧 HTMLCanvasElement。 */
export type BitmapCanvas = OffscreenCanvas | HTMLCanvasElement;

/** 可被 `createImageBitmap` / `drawImage` 接受的源;Blob 只出现在最上游那次解码,不进缩放链路。 */
type BitmapSource = Blob | ImageBitmap | BitmapCanvas;
type ScaleSource = ImageBitmap | BitmapCanvas;

/** 解码期缩放的目标尺寸;null 表示按源图尺寸解码。 */
export interface BitmapTargetSize {
  readonly width: number;
  readonly height: number;
}

/** `createImageBitmap` 的使用面:只需要「整块源 + 可选解码期缩放参数」这一种调用形态。 */
type CreateImageBitmapLike = (
  source: BitmapSource,
  options?: { resizeWidth?: number; resizeHeight?: number; resizeQuality?: string }
) => Promise<ImageBitmap>;

/** 解码缩放参数(决策 D20 的唯一出口),集中一处便于单测断言实参形状。 */
const resizeOptions = (target: BitmapTargetSize) => ({
  resizeWidth: target.width,
  resizeHeight: target.height,
  resizeQuality: "high"
});

/** 取全局解码器;缺失即抛中文错误(上层收敛成单张失败,决策 D7)。 */
const bitmapDecoder = (): CreateImageBitmapLike => {
  const decoder = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  if (typeof decoder !== "function")
    throw new Error("当前环境没有 createImageBitmap, 无法解码图片。");
  return decoder as CreateImageBitmapLike;
};

/**
 * 解码失败的统一口径:HEIC/RAW 这类不支持的编码在此抛中文错误(原始原因一并拼进来),
 * 交给上层收敛成单张失败(决策 D7), 本层绝不吞——上层只贴文件名, 不改写文案。
 */
const decodeWhole = async (decode: CreateImageBitmapLike, source: BitmapSource) => {
  try {
    return await decode(source);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`无法解码该图片: 浏览器不支持此编码(HEIC/RAW)或文件已损坏 (${reason})`, {
      cause
    });
  }
};

/** 画布双分支的唯一判定点:只有 OffscreenCanvas 有 `convertToBlob`。 */
const isOffscreenCanvas = (canvas: BitmapCanvas): canvas is OffscreenCanvas =>
  "convertToBlob" in canvas;

/** 取 2d 上下文。分支后各自调用具体重载, 避免对联合类型直接调 `getContext` 的签名歧义。 */
export const contextOf = (
  canvas: BitmapCanvas
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null =>
  isOffscreenCanvas(canvas) ? canvas.getContext("2d") : canvas.getContext("2d");

/**
 * 缩放用的临时画布:优先 OffscreenCanvas(Worker 里只有它), 退回 DOM canvas。
 * 回退路径自己按全局能力造画布:本模块要在 Worker 与主线程两个全局里都能工作。
 */
export const createBitmapCanvas = (width: number, height: number): BitmapCanvas => {
  const candidate = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  if (typeof candidate === "function") {
    const Offscreen = candidate as new (width: number, height: number) => OffscreenCanvas;
    return new Offscreen(width, height);
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("当前环境既无 OffscreenCanvas 也无 DOM canvas, 无法缩放图片。");
};

/** 画布只有把宽高归零才会立刻丢弃 backing store, 坐等 GC 是未定义行为。 */
export const releaseCanvas = (canvas: BitmapCanvas): void => {
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // 释放失败不改变渲染结论
  }
};

/** 把源等比画到指定尺寸的画布上, 画布登记进 owned 由调用方统一释放。 */
const blitScaled = (
  source: ScaleSource,
  width: number,
  height: number,
  owned: BitmapCanvas[]
): BitmapCanvas => {
  const canvas = createBitmapCanvas(width, height);
  owned.push(canvas);
  const context = contextOf(canvas);
  if (!context) throw new Error(`无法取得 ${width}×${height} 缩放画布的 2d 上下文。`);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
};

/**
 * 逐级减半缩放(解码期缩放不可用时的回退路径)。每一档只缩到一半、最后一步微调到目标:
 * 一次从 6000px 缩到 1500px 会丢掉中间调细节, 减半链路的画质明显更好。代价是全尺寸位图
 * 确实进了内存(正是 D20 想避免的那份约 96MB),外加若干张中间画布——所以这条路径只在
 * 「浏览器不认 resize 选项」时才走。
 */
const halvingDownscale = async (
  decode: CreateImageBitmapLike,
  bitmap: ImageBitmap,
  target: BitmapTargetSize
): Promise<ImageBitmap> => {
  const created: BitmapCanvas[] = [];
  try {
    let source: ScaleSource = bitmap;
    let stepWidth = Math.floor(source.width / 2);
    let stepHeight = Math.floor(source.height / 2);
    while (stepWidth >= target.width && stepHeight >= target.height) {
      source = blitScaled(source, stepWidth, stepHeight, created);
      stepWidth = Math.floor(source.width / 2);
      stepHeight = Math.floor(source.height / 2);
    }
    if (source.width !== target.width || source.height !== target.height) {
      source = blitScaled(source, target.width, target.height, created);
    }
    return await decodeWhole(decode, source);
  } finally {
    for (const canvas of created) releaseCanvas(canvas);
  }
};

/**
 * 解码并按需缩放(决策 D20)。
 *
 * `target` 非空时**必须**走带 resize 选项的解码:先解全尺寸再缩放会在 24MP 源图上多分配
 * 一份约 96MB(6000×4000×4B)的 RGBA 位图,峰值内存翻几倍,移动端会被系统直接杀页——
 * 这条因果是本函数存在的唯一理由,改成「统一全尺寸解码」即为回归。
 */
export const decodeImageBitmapScaled = async (
  blob: Blob,
  target: BitmapTargetSize | null
): Promise<ImageBitmap> => {
  const decode = bitmapDecoder();
  if (!target) {
    // 预览与原图档:源图多大就解多大,不传任何 resize 选项。
    return decodeWhole(decode, blob);
  }
  try {
    const scaled = await decode(blob, resizeOptions(target));
    if (scaled.width === target.width && scaled.height === target.height) return scaled;
    // 尺寸不等于目标 = 该浏览器(部分 Safari)收下选项但静默忽略,手里这张其实是全尺寸位图;
    // 立刻释放再走回退路径,否则会一直占着内存直到本函数返回。
    scaled.close();
  } catch {
    // 带 resize 选项的调用抛错(旧 Safari 对未知选项的处理):与「尺寸不符」同因走回退。
    // 真正不支持的编码在下面这次全尺寸解码里同样会抛,那时才判为解码失败。
  }
  const fullSize = await decodeWhole(decode, blob);
  try {
    return await halvingDownscale(decode, fullSize, target);
  } finally {
    fullSize.close();
  }
};

/**
 * 取产物字节。主线程分支用 `toBlob` 包 Promise 而不是 `toDataURL`:dataURL 是 base64 文本,
 * 相对原字节放大约 1.33 倍,还要再解码一次才回到 Blob——一张 5MB 成品会同时在 JS 堆里躺着
 * 6.7MB 字符串和 5MB 数组,移动端的内存预算就是被这种中间串吃光的。
 */
export const encodeCanvasBlob = async (
  canvas: BitmapCanvas,
  mimeType: string,
  quality: number
): Promise<Blob> => {
  if (isOffscreenCanvas(canvas)) return canvas.convertToBlob({ type: mimeType, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (encoded) =>
        encoded
          ? resolve(encoded)
          : reject(new Error("浏览器未能把画布编码为 JPEG, 请重试或改用更小档位。")),
      mimeType,
      quality
    );
  });
};
