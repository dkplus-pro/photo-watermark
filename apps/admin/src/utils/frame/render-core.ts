import { buildExifApp1, spliceExifIntoJpeg } from "./exif";
import { loadFrameFonts } from "./fonts";
import { getFrameStyle } from "./style-registry";
import { LOGO_SIZE_MAX } from "./types";
import type {
  DecodeImageScaled,
  DrawFrameComposition,
  FrameRenderRequest,
  FrameWorkerResult,
  LogoRenderInput,
  OutputSize,
  RenderFrameCore,
  RenderSurface
} from "./types";

/**
 * 单张渲染内核(阶段 9),同时运行在 Worker 与主线程:不 fetch(字节由调用方经消息传入)、
 * 不假设 DOM 存在。
 *
 * Worker 路径与主线程降级路径共用这一份实现,两条路径的全部差异被压在 `RenderSurface`
 * 的两个注入点(画布工厂 + 字体作用域)上——「降级产物必须与 Worker 产物一致」因此由构造
 * 保证,而不是靠两处代码同步维护(D6)。
 */

/** JPEG 编码 MIME;质量档位恒定 0.92 由请求侧携带(D3),本层不做策略。 */
const JPEG_MIME_TYPE = "image/jpeg";

/** 渲染画布的双端形态:Worker 侧 OffscreenCanvas,主线程降级侧 HTMLCanvasElement。 */
type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

/** 2D 上下文联合类型直接从绘制契约派生,不在本文件重复声明。 */
type FrameContext = Parameters<DrawFrameComposition>[0];

/** 可被 `createImageBitmap` / `drawImage` 接受的源;Blob 只出现在最上游那次解码,不进缩放链路。 */
type BitmapSource = Blob | ImageBitmap | RenderCanvas;
type ScaleSource = ImageBitmap | RenderCanvas;

/** `createImageBitmap` 的使用面:只需要「整块源 + 可选解码期缩放参数」这一种调用形态。 */
type CreateImageBitmapLike = (
  source: BitmapSource,
  options?: { resizeWidth?: number; resizeHeight?: number; resizeQuality?: string }
) => Promise<ImageBitmap>;

/** 解码缩放参数(决策 D20 的唯一出口),集中一处便于单测断言实参形状。 */
const resizeOptions = (target: OutputSize) => ({
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
const isOffscreenCanvas = (canvas: RenderCanvas): canvas is OffscreenCanvas =>
  "convertToBlob" in canvas;

/** 取 2d 上下文。分支后各自调用具体重载, 避免对联合类型直接调 `getContext` 的签名歧义。 */
export const contextOf = (canvas: RenderCanvas): FrameContext | null =>
  isOffscreenCanvas(canvas) ? canvas.getContext("2d") : canvas.getContext("2d");

/**
 * 缩放用的临时画布:优先 OffscreenCanvas(Worker 里只有它), 退回 DOM canvas。
 * `DecodeImageScaled` 的冻结签名不吃 `RenderSurface`, 回退路径只能自己按全局能力造画布
 * ——这是契约的既成代价, 两条渲染路径在此的行为因此天然一致。
 */
export const createBitmapCanvas = (width: number, height: number): RenderCanvas => {
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
export const releaseCanvas = (canvas: RenderCanvas): void => {
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
  owned: RenderCanvas[]
): RenderCanvas => {
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
  target: OutputSize
): Promise<ImageBitmap> => {
  const created: RenderCanvas[] = [];
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
export const decodeImageScaled: DecodeImageScaled = async (blob, target) => {
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
  canvas: RenderCanvas,
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

/** JPEG 编码是导出与预览的唯一产物形态,质量由请求侧携带;实现即 `encodeCanvasBlob` 的定参版。 */
const encodeJpeg = (canvas: RenderCanvas, quality: number): Promise<Blob> =>
  encodeCanvasBlob(canvas, JPEG_MIME_TYPE, quality);

/** logo 位图解码:失败不影响整张导出,退回文字块。 */
const decodeLogoBitmap = async (logoBlob: Blob | null): Promise<ImageBitmap | null> => {
  if (!logoBlob) return null;
  try {
    return await decodeWhole(bitmapDecoder(), logoBlob);
  } catch {
    // logo 只是装饰,用户选的照片才是主产物:不带 bitmap 的 LogoRenderInput 会让绘制端
    // 走 drawLogoMark 文字块分支(见 frame-drawing 的 logo?.bitmap 判定),导出继续完成。
    return null;
  }
};

/** logo 绘制输入:有位图用位图,否则只给 mark——绘制端据此走文字块分支;scale 由滑杆档位换算。 */
const logoInputOf = (
  mark: string,
  bitmap: ImageBitmap | null,
  logoSize: number
): LogoRenderInput => ({
  mark,
  bitmap: bitmap ?? undefined,
  scale: logoSize / LOGO_SIZE_MAX
});

/**
 * 零拷贝注入 EXIF 并组装结果(D8)。`exifInjected` 如实反映「是否真的注进去了」:head 为 null、
 * head 里没有可用 APP1、拼接降级(splice 原样返回入参 Blob)全部算 false——用户要能分辨
 * 产物到底有没有元数据。
 */
const buildResult = async (
  jpeg: Blob,
  request: FrameRenderRequest,
  width: number,
  height: number
): Promise<FrameWorkerResult> => {
  let output = jpeg;
  let exifInjected = false;
  try {
    const app1 = request.exifHead ? buildExifApp1(request.exifHead, width, height) : null;
    if (app1) {
      const spliced = await spliceExifIntoJpeg(jpeg, app1);
      exifInjected = spliced !== jpeg;
      output = spliced;
    }
  } catch {
    // EXIF 继承失败绝不能作废一张已经画好的图:退回未注入的原产物(即上面两个初值)。
  }
  return { blob: output, width, height, exifInjected };
};

/**
 * 渲染一张:字体 → 解码 → 画布 → 样式 → logo → 绘制 → 编码 → EXIF。全部临时位图与画布在
 * finally 里释放。这里刻意不把 `close()` 包进 try/catch:释放本身抛错说明该浏览器的画布
 * 实现已不可信,静默吞掉会交付一张可能空白的图,而流水线会把这张收敛成单条失败(D7)。
 */
export const renderFrame: RenderFrameCore = async (request, surface) => {
  // 字体缺失(loadFrameFonts 返回 false)只影响观感——它会退回字体栈里下一级系统字体,
  // 所以连返回值都不看:绘制链路绝不能因为字体拉挂而中断导出(D9)。
  await surface.loadFonts();
  const bitmap = await decodeImageScaled(request.blob, request.target);
  const { width, height } = bitmap;
  let logoBitmap: ImageBitmap | null = null;
  let canvas: RenderCanvas | null = null;
  try {
    canvas = surface.createCanvas(width, height);
    const context = contextOf(canvas);
    // 拿不到上下文 = 申请面积超出浏览器 canvas 上限的真实症状,错误文案直接指向档位。
    if (!context)
      throw new Error(
        `无法取得 ${width}×${height} 画布的 2d 上下文: 输出面积超出浏览器 canvas 上限, 请改用更小档位。`
      );
    // 未知样式不静默回落到第一种:错用样式会产出错误的成品,口径与 style-registry 一致。
    const style = getFrameStyle(request.styleId);
    if (!style) throw new Error(`相框样式「${request.styleId}」未在注册表登记, 请检查注册清单。`);
    logoBitmap = await decodeLogoBitmap(request.logoBlob);
    const logo = logoInputOf(request.logoMark, logoBitmap, request.logoSize);
    style.draw(context, width, height, bitmap, request.fields, logo);
    const jpeg = await encodeJpeg(canvas, request.jpegQuality);
    return await buildResult(jpeg, request, width, height);
  } finally {
    // 失败路径同样占着几十 MB:批量跑到第 20 张就把页面推爆的泄漏就发生在这一行组里。
    bitmap.close();
    logoBitmap?.close();
    if (canvas) releaseCanvas(canvas);
  }
};

/**
 * 主线程降级面:仅当 `supportsWorkerRendering()` 为 false 时由流水线使用(D6);
 * 与 Worker 侧的唯一实质差异就是画布类型,字体注册作用域换成 document。
 */
export const mainThreadSurface: RenderSurface = {
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  // 字体清单是模块级常量 FRAME_FONTS(见 fonts.ts),整套注册才有意义,所以这里不接受入参。
  loadFonts: () => loadFrameFonts(document)
};
