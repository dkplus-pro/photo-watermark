import { probeSizeFromHead, readProbeHeadBytes } from "./image-size-probe";
import { mainThreadSurface, renderFrame } from "./render-core";
import { getFrameStyle } from "./style-registry";
import { PREVIEW_LONG_EDGE } from "./types";
import type { FrameFields, FrameRenderRequest, OutputSize } from "./types";

/**
 * 实时预览的渲染入口(阶段 11)。
 *
 * 为什么要有这个文件而不是让组件直接调 `renderFrame`:预览与导出跑的是**同一份绘制内核**
 * (决策 D6 的既成好处),但两者的**参数策略**完全不同——档位换成「恒按长边 1200px」(D18)、
 * JPEG 质量另设一档、EXIF 不继承、且必须走主线程画布而不是 Worker 池。
 * 这四处差异若散进组件,页面与组件就开始持有渲染策略;收在这一个文件里,组件只管
 * 「什么时候画」和「画完的 Blob 怎么显示」。
 *
 * 依赖纪律与 utils/frame 其余模块一致:不 import react / hooks / store / arco,
 * 这样它在 node 与 Worker 语境下都能被单独测。
 */

export interface PreviewRequest {
  /** 用户选中的那一张原图(留在本机,不发请求) */
  source: File | Blob;
  styleId: string;
  /** logo 的文字兜底;位图解码失败时绘制端会退回这个文字块 */
  logoMark: string;
  logoBlob: Blob | null;
  /** logo大小滑杆档位(与导出同源,预览所见即导出所得) */
  logoSize: number;
  fields: FrameFields;
}

/**
 * 预览 JPEG 质量。
 *
 * 刻意不复用导出的 `JPEG_QUALITY`(0.92):预览是排版判断不是成品(D18),0.85 下长边 1200px
 * 的产物约 100-200KB,重绘一次的实际成本更低;质量再高只会让用户误以为看到的就是成品。
 */
export const PREVIEW_JPEG_QUALITY = 0.85;

/**
 * `FrameRenderRequest.fileName` 是契约必填项(导出侧它是 zip 内主名)。
 * 预览不落盘、不进 zip,这个值不会出现在任何用户可见处,只为满足请求形状。
 */
const PREVIEW_OUTPUT_NAME = "preview";

/**
 * 预览目标尺寸:**恒按长边 `PREVIEW_LONG_EDGE` 等比,且只缩不放**。
 *
 * 源图长边本就不超过 1200 时返回 `null`(= 按源图尺寸输出):插值放大是纯失真,
 * 而且返回 null 让 `decodeImageScaled` 干脆不走 resize 分支,省一次重采样。
 * 用 `floor` 而非 `round`:四舍五入可能把长边算成 1201,反而越过 D18 的预算上限。
 * `Math.max(1, …)` 保的是 1×N 极端长条(短边缩放后不足 1px)不出现 0 尺寸画布。
 *
 * 入参为 `null`(头部读不出尺寸)同样返回 `null`:与 `export-jobs` 的收敛一致——
 * 尺寸未知时「别缩放」比「猜一个缩放」安全。
 *
 * 具名导出给单测:D18 的全部预算就压在这几行算术上,它必须能被**不启动渲染**的情况下直接钉住
 * (jsdom 没有 canvas,任何经由 `renderPreview` 的断言都只能在 mock 里打转)。
 */
export const previewTargetOf = (source: OutputSize | null): OutputSize | null => {
  if (!source) return null;
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= PREVIEW_LONG_EDGE) return null;
  const scale = PREVIEW_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale))
  };
};

/**
 * 渲染一张预览 → JPEG Blob。
 *
 * 尺寸探测走「读头部字节」这条不解码的路(`probeSizeFromHead`),与导出侧同一口径:
 * 先全尺寸解码再缩放会白分配约 96MB 位图(D20),而预览恰恰是最容易被反复触发的动作。
 *
 * 抛错口径(中文,页面直接展示):样式未注册、图片内容为空、浏览器解不了这张图。
 * 预览失败不静默成空白图:用户要知道的是「这张图看不了」,不是「工具坏了」。
 */
export const renderPreview = async (request: PreviewRequest): Promise<Blob> => {
  const { source, styleId, logoMark, logoBlob, logoSize, fields } = request;
  // 先查样式再读字节:清单里有、注册表没有的样式,不该为它付一次解码的内存与耗时。
  if (!getFrameStyle(styleId)) {
    throw new Error(`相框样式「${styleId}」未在注册表登记, 无法预览。`);
  }
  if (!source || source.size === 0) {
    throw new Error("这张图片内容为空, 无法预览。");
  }
  const target = previewTargetOf(probeSizeFromHead(await readProbeHeadBytes(source)));
  const result = await renderFrame(
    {
      blob: source,
      target,
      jpegQuality: PREVIEW_JPEG_QUALITY,
      styleId,
      fields,
      // 预览不继承元数据(D18):产物只是排版判断,EXIF 拼接是导出侧的事。
      exifHead: null,
      logoMark,
      logoBlob,
      logoSize,
      fileName: PREVIEW_OUTPUT_NAME
    } satisfies FrameRenderRequest,
    mainThreadSurface
  );
  return result.blob;
};
