import {
  createBitmapCanvas,
  contextOf,
  decodeImageScaled,
  encodeCanvasBlob,
  releaseCanvas
} from "./render-core";
import { THUMBNAIL_LONG_EDGE } from "./types";
import type { MakePhotoThumbnail, OutputSize } from "./types";

/**
 * 已选照片的列表缩略图(导出页「照片」卡片的网格用)。
 *
 * 为什么不能让 `<img>` 直接吃原图的 object URL:object URL 指向的是**原始文件**,
 * 浏览器为了一格 ~100px 的缩略位要解码整幅位图并在解码缓存里持有它(24MP ≈ 96MB),
 * 一次多选几张,解码峰值与缓存压力就把主线程顶住——「上传后页面卡顿」的主因就是它。
 * 所以在准备阶段用**解码期缩放**(决策 D20 同一条路:先按目标尺寸解码,不落全尺寸位图)
 * 产一张独立小图,列表只解码这几百 KB 的缩略图。
 *
 * 与 `preview-render` 同一套纪律:纯比例算术单独导出给单测,jsdom 没有 canvas 也能钉住;
 * 依赖纪律与 utils/frame 其余模块一致,不 import react / hooks / store / arco。
 */

/** 缩略图 JPEG 质量:列表缩略位只有排版判断价值,0.8 下长边 320px 约 10-30KB。 */
export const THUMBNAIL_JPEG_QUALITY = 0.8;

/**
 * 缩略图目标尺寸:长边等比收到 `THUMBNAIL_LONG_EDGE`,**只缩不放**。
 * 源图长边不超限时返回 `null`(= 不产缩略图,原图直显就够小);
 * 入参为 `null`(头部读不出尺寸)同样返回 `null`:不知道宽高就算不出等比目标,
 * 而传方形目标会把非方形图压变形,宁可不产也不产错的。
 */
export const thumbnailTargetOf = (source: OutputSize | null): OutputSize | null => {
  if (!source) return null;
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= THUMBNAIL_LONG_EDGE) return null;
  const scale = THUMBNAIL_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale))
  };
};

/** PNG 源保留透明通道(PNG 重编码为 JPEG 会把透明吃成黑底);其余一律 JPEG。 */
const thumbnailMimeOf = (file: Blob): string =>
  file.type === "image/png" ? "image/png" : "image/jpeg";

/** 产一张缩略图;任何失败(解不了、画不出、编不出)都返回 null,由列表退回原图直显。 */
export const makePhotoThumbnail: MakePhotoThumbnail = async (file, sourceSize) => {
  const target = thumbnailTargetOf(sourceSize);
  if (!target || file.size === 0) return null;
  let bitmap: ImageBitmap | null = null;
  let canvas: ReturnType<typeof createBitmapCanvas> | null = null;
  try {
    bitmap = await decodeImageScaled(file, target);
    canvas = createBitmapCanvas(bitmap.width, bitmap.height);
    const context = contextOf(canvas);
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return await encodeCanvasBlob(canvas, thumbnailMimeOf(file), THUMBNAIL_JPEG_QUALITY);
  } catch {
    return null;
  } finally {
    bitmap?.close();
    if (canvas) releaseCanvas(canvas);
  }
};
