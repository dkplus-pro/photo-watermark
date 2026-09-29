// utils/compress/format.ts 纯函数用例(纯逻辑,node 环境)。
// 边界覆盖:空值(mime/扩展名全空)、零值(0 字节原图)、越界(质量滑杆越界、畸形持久化值)、
// 网络失败/权限缺失不适用(本模块不触网不鉴权);非法状态迁移由 store 用例覆盖。
// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  detectAlphaFromHead,
  extensionOfMime,
  imageKindOf,
  isCompressMode,
  isQualityPercent,
  needsAlphaFlatten,
  qualityOfPercent,
  resolveOutputMime,
  savingsLabelOf,
  savingsPercentOf
} from "../../../src/utils/compress/format";

// ---------------------------------------------------------------- 头部构造器

/** PNG 头:签名(8)+ IHDR 段,color type 可指定(4=灰度+alpha,6=RGBA,2=RGB)。 */
const buildPngHead = (colorType: number, length = 32): Uint8Array => {
  const head = new Uint8Array(length);
  head[0] = 0x89;
  head.set([0x50, 0x4e, 0x47], 1); // "PNG"
  head.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  head[25] = colorType;
  return head;
};

/** WebP 头:RIFF/WEBP + 第一个 chunk(四种形态)。 */
const buildWebpHead = (chunk: "VP8X" | "VP8 " | "VP8L" | "XXXX", flags = 0): Uint8Array => {
  const head = new Uint8Array(32);
  head.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  head.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  head.set([0x56, 0x50, 0x38, chunk === "VP8 " ? 0x20 : chunk.charCodeAt(3)], 12);
  head[20] = chunk === "VP8L" ? 0x2f : flags;
  return head;
};

describe("imageKindOf", () => {
  test("mime 优先,四种已知 mime 各归其类", () => {
    expect(imageKindOf("image/jpeg", "a.bin")).toBe("jpeg");
    expect(imageKindOf("image/png", "a.bin")).toBe("png");
    expect(imageKindOf("image/webp", "a.bin")).toBe("webp");
    expect(imageKindOf("image/gif", "a.bin")).toBe("gif");
  });

  test("mime 为空串(拖拽场景)按扩展名兜底,大小写不敏感", () => {
    expect(imageKindOf("", "photo.JPG")).toBe("jpeg");
    expect(imageKindOf("", "a.PNG")).toBe("png");
    expect(imageKindOf("", "b.webp")).toBe("webp");
    expect(imageKindOf("", "c.gif")).toBe("gif");
  });

  test("空值边界:mime 与扩展名都认不出 → other", () => {
    expect(imageKindOf("", "noext")).toBe("other");
    expect(imageKindOf("", "")).toBe("other");
    expect(imageKindOf("image/avif", "a")).toBe("other");
  });

  test("点在首位(如 .jpg)按无主名处理,扩展名仍能认出", () => {
    expect(imageKindOf("", ".jpg")).toBe("jpeg");
  });
});

describe("detectAlphaFromHead", () => {
  test("JPEG 恒为 false(不需要读头部)", () => {
    expect(detectAlphaFromHead(null, "jpeg")).toBe(false);
  });

  test("PNG:color type 4/6 有 alpha,2 没有;头部不完整一律 true(保守)", () => {
    expect(detectAlphaFromHead(buildPngHead(6), "png")).toBe(true);
    expect(detectAlphaFromHead(buildPngHead(4), "png")).toBe(true);
    expect(detectAlphaFromHead(buildPngHead(2), "png")).toBe(false);
    expect(detectAlphaFromHead(buildPngHead(6, 20), "png")).toBe(true);
    expect(detectAlphaFromHead(null, "png")).toBe(true);
  });

  test("WebP:VP8X 按 alpha 标志位,VP8 有损恒无,VP8L 按 alpha_is_used", () => {
    expect(detectAlphaFromHead(buildWebpHead("VP8X", 0x10), "webp")).toBe(true);
    expect(detectAlphaFromHead(buildWebpHead("VP8X", 0x00), "webp")).toBe(false);
    expect(detectAlphaFromHead(buildWebpHead("VP8 "), "webp")).toBe(false);
    // VP8L:位流第 29 位(alpha_is_used)在 32 位小端字的第 28 位,即第 4 字节的 0x10
    const lossless = buildWebpHead("VP8L");
    lossless[24] = 0x10;
    expect(detectAlphaFromHead(lossless, "webp")).toBe(true);
    lossless[24] = 0x00;
    expect(detectAlphaFromHead(lossless, "webp")).toBe(false);
    expect(detectAlphaFromHead(new Uint8Array(8), "webp")).toBe(true);
  });

  test("gif/other 判不出帧级透明,一律 true(宁可多保透明也不压成黑底)", () => {
    expect(detectAlphaFromHead(null, "gif")).toBe(true);
    expect(detectAlphaFromHead(null, "other")).toBe(true);
  });
});

describe("resolveOutputMime", () => {
  const decision = (over: Partial<Parameters<typeof resolveOutputMime>[0]>) => ({
    kind: "jpeg" as const,
    mode: "smart" as const,
    hasAlpha: false,
    webpSupported: true,
    ...over
  });

  test("smart:JPEG 保持 JPEG,其余转 WebP", () => {
    expect(resolveOutputMime(decision({ kind: "jpeg" }))).toBe("image/jpeg");
    expect(resolveOutputMime(decision({ kind: "png", hasAlpha: true }))).toBe("image/webp");
    expect(resolveOutputMime(decision({ kind: "gif" }))).toBe("image/webp");
    expect(resolveOutputMime(decision({ kind: "other" }))).toBe("image/webp");
  });

  test("smart 且 WebP 编不出:按透明退 PNG / JPEG", () => {
    const noWebp = { webpSupported: false };
    expect(resolveOutputMime(decision({ kind: "png", hasAlpha: true, ...noWebp }))).toBe(
      "image/png"
    );
    expect(resolveOutputMime(decision({ kind: "png", hasAlpha: false, ...noWebp }))).toBe(
      "image/jpeg"
    );
    expect(resolveOutputMime(decision({ kind: "jpeg", ...noWebp }))).toBe("image/jpeg");
  });

  test("original:jpeg/png/webp 保持,gif/other 走 smart 口径", () => {
    expect(resolveOutputMime(decision({ kind: "jpeg", mode: "original" }))).toBe("image/jpeg");
    expect(resolveOutputMime(decision({ kind: "png", mode: "original" }))).toBe("image/png");
    expect(resolveOutputMime(decision({ kind: "webp", mode: "original" }))).toBe("image/webp");
    expect(resolveOutputMime(decision({ kind: "gif", mode: "original" }))).toBe("image/webp");
    // WebP 保持以「编得出」为前提
    expect(
      resolveOutputMime(
        decision({ kind: "webp", mode: "original", webpSupported: false, hasAlpha: true })
      )
    ).toBe("image/png");
  });

  test("显式 webp/jpeg:webp 编不出时按透明退档,jpeg 恒定", () => {
    expect(resolveOutputMime(decision({ mode: "webp" }))).toBe("image/webp");
    expect(
      resolveOutputMime(decision({ mode: "webp", webpSupported: false, hasAlpha: true }))
    ).toBe("image/png");
    expect(resolveOutputMime(decision({ mode: "jpeg", kind: "png", hasAlpha: true }))).toBe(
      "image/jpeg"
    );
  });
});

describe("extensionOfMime 与 needsAlphaFlatten", () => {
  test("扩展名映射,未知 mime 一律 .jpg 兜底", () => {
    expect(extensionOfMime("image/jpeg")).toBe(".jpg");
    expect(extensionOfMime("image/png")).toBe(".png");
    expect(extensionOfMime("image/webp")).toBe(".webp");
    expect(extensionOfMime("image/avif")).toBe(".jpg");
  });

  test("只有 JPEG 输出且源图可能带透明时垫白底", () => {
    expect(needsAlphaFlatten("image/jpeg", true)).toBe(true);
    expect(needsAlphaFlatten("image/jpeg", false)).toBe(false);
    expect(needsAlphaFlatten("image/webp", true)).toBe(false);
    expect(needsAlphaFlatten("image/png", true)).toBe(false);
  });
});

describe("quality 守卫与换算", () => {
  test("isQualityPercent 只认 50–95 的整数", () => {
    expect(isQualityPercent(50)).toBe(true);
    expect(isQualityPercent(95)).toBe(true);
    expect(isQualityPercent(80)).toBe(true);
    expect(isQualityPercent(49)).toBe(false);
    expect(isQualityPercent(96)).toBe(false);
    expect(isQualityPercent(75.5)).toBe(false);
    expect(isQualityPercent(Number.NaN)).toBe(false);
    expect(isQualityPercent("80")).toBe(false);
  });

  test("qualityOfPercent:合法值 /100,越界收敛默认档(0.8)", () => {
    expect(qualityOfPercent(80)).toBe(0.8);
    expect(qualityOfPercent(50)).toBe(0.5);
    expect(qualityOfPercent(0)).toBe(0.8);
    expect(qualityOfPercent(120)).toBe(0.8);
    expect(qualityOfPercent(Number.NaN)).toBe(0.8);
  });

  test("isCompressMode 只认四种模式", () => {
    expect(isCompressMode("smart")).toBe(true);
    expect(isCompressMode("original")).toBe(true);
    expect(isCompressMode("webp")).toBe(true);
    expect(isCompressMode("jpeg")).toBe(true);
    expect(isCompressMode("png")).toBe(false);
    expect(isCompressMode("")).toBe(false);
  });
});

describe("savings", () => {
  test("savingsPercentOf:变小为正、变大为负、原图 0 字节为 null", () => {
    expect(savingsPercentOf(1000, 250)).toBeCloseTo(75);
    expect(savingsPercentOf(1000, 1500)).toBeCloseTo(-50);
    expect(savingsPercentOf(0, 10)).toBeNull();
    expect(savingsPercentOf(Number.NaN, 10)).toBeNull();
    expect(savingsPercentOf(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("savingsLabelOf:正数 -N%,四舍五入后无收益(含变大)「未减小」,null 透传给调用方", () => {
    expect(savingsLabelOf(1000, 250)).toBe("-75%");
    expect(savingsLabelOf(1000, 999)).toBe("未减小");
    expect(savingsLabelOf(1000, 1200)).toBe("未减小");
    expect(savingsLabelOf(0, 10)).toBeNull();
  });
});
