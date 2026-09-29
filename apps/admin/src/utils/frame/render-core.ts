import {
  contextOf,
  createBitmapCanvas,
  decodeImageBitmapScaled,
  encodeCanvasBlob as encodeCanvasToBlob,
  releaseCanvas
} from "../bitmap";
import { buildExifApp1, spliceExifIntoJpeg } from "./exif";
import { loadFrameFonts } from "./fonts";
import { getFrameStyle } from "./style-registry";
import { LOGO_SIZE_MAX } from "./types";
import type {
  DecodeImageScaled,
  FrameRenderRequest,
  FrameWorkerResult,
  LogoRenderInput,
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
 *
 * 位图底座(解码/缩放/画布/编码)在 `utils/bitmap.ts`,与压缩引擎共用同一份实现;
 * 本文件只保留相框渲染的语义部分(字体、样式、logo、EXIF)。
 */

// 通用位图底座按原名字复导出:既有消费方(thumbnail / preview-render / image-size-probe /
// 渲染内核用例)继续从本模块取,不感知抽层。
export { contextOf, createBitmapCanvas, releaseCanvas };
export const encodeCanvasBlob = encodeCanvasToBlob;
export const decodeImageScaled: DecodeImageScaled = decodeImageBitmapScaled;

/** JPEG 编码 MIME;质量档位恒定 0.92 由请求侧携带(D3),本层不做策略。 */
const JPEG_MIME_TYPE = "image/jpeg";

/** 渲染画布的双端形态:Worker 侧 OffscreenCanvas,主线程降级侧 HTMLCanvasElement。 */
type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

/** JPEG 编码是导出与预览的唯一产物形态,质量由请求侧携带;实现即 `encodeCanvasBlob` 的定参版。 */
const encodeJpeg = (canvas: RenderCanvas, quality: number): Promise<Blob> =>
  encodeCanvasToBlob(canvas, JPEG_MIME_TYPE, quality);

/** logo 位图解码:失败不影响整张导出,退回文字块。 */
const decodeLogoBitmap = async (logoBlob: Blob | null): Promise<ImageBitmap | null> => {
  if (!logoBlob) return null;
  try {
    return await decodeImageBitmapScaled(logoBlob, null);
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
  const bitmap = await decodeImageBitmapScaled(request.blob, request.target);
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
