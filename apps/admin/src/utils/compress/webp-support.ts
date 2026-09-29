import { contextOf, createBitmapCanvas, encodeCanvasBlob, releaseCanvas } from "../bitmap";

/**
 * 当前浏览器画布能否编码 WebP(Safari 长期「只解不编」)。
 *
 * 为什么独立成模块:这是压缩链路里唯一需要真跑一次 canvas 的探测,批处理与格式决策
 * (format.ts,纯函数)都只消费它的布尔结论——单独成文件让单测可以在模块边界上替身,
 * 不必在 jsdom 里伪造 canvas。
 *
 * 1×1 画布试编一次看 blob.type;探测全局 memoize,失败一律按「不支持」处理——
 * 那样格式决策退回 PNG/JPEG,比产出错位文件安全。
 */

let webpSupportPromise: Promise<boolean> | null = null;

/** 清除探测缓存,仅供单测使用。 */
export const resetWebpSupportCache = (): void => {
  webpSupportPromise = null;
};

export const supportsWebpEncoding = (): Promise<boolean> => {
  if (!webpSupportPromise) {
    webpSupportPromise = (async () => {
      let canvas: ReturnType<typeof createBitmapCanvas> | null = null;
      try {
        canvas = createBitmapCanvas(1, 1);
        const context = contextOf(canvas);
        if (!context) return false;
        context.fillRect(0, 0, 1, 1);
        const blob = await encodeCanvasBlob(canvas, "image/webp", 0.8);
        return blob.type === "image/webp";
      } catch {
        return false;
      } finally {
        if (canvas) releaseCanvas(canvas);
      }
    })();
  }
  return webpSupportPromise;
};
