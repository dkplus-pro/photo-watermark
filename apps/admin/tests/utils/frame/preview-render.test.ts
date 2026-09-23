import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREVIEW_JPEG_QUALITY,
  previewTargetOf,
  renderPreview
} from "../../../src/utils/frame/preview-render";
import { PREVIEW_LONG_EDGE } from "../../../src/utils/frame/types";
import type { FrameFields, OutputSize } from "../../../src/utils/frame/types";

/**
 * 预览渲染入口单测(阶段 11)。
 *
 * jsdom 里没有 canvas、没有 `createImageBitmap`、也没有 `OffscreenCanvas`,所以真渲染一次
 * 是不可能的(决策 D16:不做像素对比)。本文件的断言方式是「喂进去什么请求、拿到什么产物」:
 * `render-core`、`image-size-probe`(I/O)、`style-registry` 三个模块边界全部替换成替身,
 * 而被测的两条真实逻辑——`previewTargetOf` 的长边算法与 `renderPreview` 的请求装配——
 * 一行都不 mock。D18 的全部预算就压在 `previewTargetOf` 那几行算术上,它必须能被
 * 不启动渲染直接钉住,否则「预览按 1200 出图」这条只能靠人眼验收。
 *
 * 六类边界对照:空值(source 为空 Blob、探测不出尺寸)、零值(0×0 尺寸、size 为 0 的文件)、
 * 越界(长边远超 1200 的极端长条、未注册的样式 id)、网络失败(浏览器解不了这张图 →
 * renderFrame reject,消息必须原样透传)、非法状态迁移(样式未注册时不许碰文件字节);
 * 权限缺失不适用:本站匿名公开、无鉴权(apps/admin/AGENTS.md 第 3 节),本层也不发请求。
 */

const { renderFrameMock, probeHeadMock, probeSizeMock, getFrameStyleMock, surfaceDouble } =
  vi.hoisted(() => ({
    renderFrameMock: vi.fn(),
    probeHeadMock: vi.fn(async (blob: Blob) =>
      blob.size > 0 ? (new Uint8Array([0xff, 0xd8]) as Uint8Array | null) : null
    ),
    probeSizeMock: vi.fn((head: Uint8Array | null): OutputSize | null =>
      head && head.length > 0 ? { width: 1, height: 1 } : null
    ),
    getFrameStyleMock: vi.fn((styleId: string) =>
      styleId === "plain-frame" ? { id: styleId, draw: vi.fn() } : null
    ),
    surfaceDouble: { createCanvas: vi.fn(), loadFonts: vi.fn(async () => true) }
  }));

// 渲染内核与字节探测都是模块边界:本用例测的是「预览怎么装配一次渲染」,不是它们怎么实现。
vi.mock("../../../src/utils/frame/render-core", () => ({
  renderFrame: renderFrameMock,
  mainThreadSurface: surfaceDouble
}));

vi.mock("../../../src/utils/frame/image-size-probe", () => ({
  readProbeHeadBytes: probeHeadMock,
  probeSizeFromHead: probeSizeMock
}));

// 注册表替身保留「未注册返回 null」的真实语义,好让样式拦截这条分支可测。
vi.mock("../../../src/utils/frame/style-registry", () => ({
  PLAIN_FRAME_STYLE_ID: "plain-frame",
  getFrameStyle: getFrameStyleMock,
  listFrameStyleIds: () => ["plain-frame"]
}));

const FIELDS: FrameFields = { brand: "Canon", model: "EOS R6", exposure: "f/2.8  1/250s  ISO100" };

const makeFile = (byteLength: number, name = "photo.jpg"): File =>
  new File([new Uint8Array(byteLength)], name, { type: "image/jpeg" });

const REQUEST = {
  source: makeFile(2048),
  styleId: "plain-frame",
  logoMark: "JUZI",
  logoBlob: null,
  fields: FIELDS
};

beforeEach(() => {
  renderFrameMock.mockReset();
  probeHeadMock.mockClear();
  probeSizeMock.mockReset();
  getFrameStyleMock.mockClear();
  // 默认给一张能画出来的图:各用例只覆盖自己要验的那一处。
  probeSizeMock.mockReturnValue({ width: 6000, height: 4000 });
  renderFrameMock.mockResolvedValue({
    blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }),
    width: 1200,
    height: 800,
    exifInjected: false
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("previewTargetOf 长边算法(D18)", () => {
  it("契约常量就是 1200,缩放必须跟着它而不是写死的数字", () => {
    expect(PREVIEW_LONG_EDGE).toBe(1200);
    expect(previewTargetOf({ width: 2400, height: 2400 })).toEqual({ width: 1200, height: 1200 });
  });

  it("横图按长边等比缩小,短边保持比例", () => {
    expect(previewTargetOf({ width: 6000, height: 4000 })).toEqual({ width: 1200, height: 800 });
  });

  it("竖图同样按长边(这里是高)算,不受宽高顺序影响", () => {
    expect(previewTargetOf({ width: 4000, height: 6000 })).toEqual({ width: 800, height: 1200 });
  });

  it("只缩不放:源图长边小于 1200 时返回 null(按源图尺寸输出)", () => {
    expect(previewTargetOf({ width: 800, height: 600 })).toBeNull();
  });

  it("边界:长边正好等于 1200 也不放大、不缩放", () => {
    expect(previewTargetOf({ width: 1200, height: 900 })).toBeNull();
  });

  it("零值:尺寸全 0 时返回 null 而不是除零得到 NaN/Infinity", () => {
    expect(previewTargetOf({ width: 0, height: 0 })).toBeNull();
  });

  it("空值:探测不出尺寸(null)时返回 null,即「别缩放」", () => {
    expect(previewTargetOf(null)).toBeNull();
  });

  it("越界:极端长条(20000×1)短边被钉在 1px,不出现 0 尺寸画布", () => {
    expect(previewTargetOf({ width: 20000, height: 1 })).toEqual({ width: 1200, height: 1 });
  });

  it("长边恒不越过预算:一批递减尺寸里最长边都 ≤1200", () => {
    const sizes = [
      { width: 8256, height: 5504 },
      { width: 3000, height: 3001 },
      { width: 1201, height: 1200 },
      { width: 40000, height: 30 }
    ];
    for (const size of sizes) {
      const target = previewTargetOf(size);
      // 只缩不放的源图本就 ≤1200,此时返回 null 而不是硬凑一张 1200 的放大图。
      if (Math.max(size.width, size.height) <= PREVIEW_LONG_EDGE) {
        expect(target).toBeNull();
        continue;
      }
      expect(target).not.toBeNull();
      expect(Math.max(target?.width ?? 0, target?.height ?? 0)).toBeLessThanOrEqual(1200);
      expect(target?.width).toBeGreaterThan(0);
      expect(target?.height).toBeGreaterThan(0);
    }
  });
});

describe("renderPreview 请求装配", () => {
  it("走主线程画布面,目标尺寸按长边算,质量与 EXIF 按预览口径", async () => {
    const logoBlob = new Blob(["logo"], { type: "image/svg+xml" });
    const blob = await renderPreview({ ...REQUEST, logoBlob });

    expect(blob).toBeInstanceOf(Blob);
    expect(renderFrameMock).toHaveBeenCalledTimes(1);
    const [request, surface] = renderFrameMock.mock.calls[0];
    expect(surface).toBe(surfaceDouble);
    expect(request).toMatchObject({
      // 源字节原样交给内核,预览不重新编码、不落盘。
      blob: REQUEST.source,
      target: { width: 1200, height: 800 },
      // 预览质量是独立一档(0.85),不是导出的 JPEG_QUALITY(0.92):质量再高只会让人误看成品。
      jpegQuality: PREVIEW_JPEG_QUALITY,
      styleId: "plain-frame",
      fields: FIELDS,
      exifHead: null,
      logoMark: "JUZI",
      logoBlob
    });
  });

  it("预览质量常量确实是独立的一档且低于导出质量", () => {
    expect(PREVIEW_JPEG_QUALITY).toBe(0.85);
    expect(PREVIEW_JPEG_QUALITY).toBeLessThan(0.92);
  });

  it("不拉源图整幅字节:只读头部,尺寸从头部解析(D20 的预览侧同款纪律)", async () => {
    await renderPreview(REQUEST);
    expect(probeHeadMock).toHaveBeenCalledTimes(1);
    expect(probeHeadMock.mock.calls[0][0]).toBe(REQUEST.source);
    expect(probeSizeMock).toHaveBeenCalledTimes(1);
    expect(probeSizeMock.mock.calls[0][0]).toEqual(new Uint8Array([0xff, 0xd8]));
  });

  it("尺寸探测不出来时 target 为 null,即按源图尺寸画而不是猜一个缩放", async () => {
    probeSizeMock.mockReturnValue(null);
    await renderPreview(REQUEST);
    expect(renderFrameMock.mock.calls[0][0].target).toBeNull();
  });

  it("空值:fields 为空对象时照样渲染(信息条没字就不画,不是失败)", async () => {
    await renderPreview({ ...REQUEST, fields: {} });
    expect(renderFrameMock.mock.calls[0][0].fields).toEqual({});
  });

  it("logoBlob 为 null 时原样传下去,由绘制端走 mark 文字块", async () => {
    await renderPreview({ ...REQUEST, logoBlob: null, logoMark: "JUZI" });
    const request = renderFrameMock.mock.calls[0][0];
    expect(request.logoBlob).toBeNull();
    expect(request.logoMark).toBe("JUZI");
  });
});

describe("renderPreview 失败口径", () => {
  it("样式未注册:抛中文错误并点名 styleId,且不去读文件字节", async () => {
    await expect(renderPreview({ ...REQUEST, styleId: "not-registered" })).rejects.toThrow(
      /未在注册表登记/u
    );
    await expect(renderPreview({ ...REQUEST, styleId: "not-registered" })).rejects.toThrow(
      /not-registered/u
    );
    expect(probeHeadMock).not.toHaveBeenCalled();
    expect(renderFrameMock).not.toHaveBeenCalled();
  });

  it("零值:空文件(size 0)直接判失败,不建解码、不产出空白预览", async () => {
    await expect(renderPreview({ ...REQUEST, source: makeFile(0) })).rejects.toThrow(/内容为空/u);
    expect(probeHeadMock).not.toHaveBeenCalled();
    expect(renderFrameMock).not.toHaveBeenCalled();
  });

  it("上游解码失败时消息原样透传,不改写成第二套文案(口径归 render-core)", async () => {
    renderFrameMock.mockRejectedValue(
      new Error("无法解码该图片: 浏览器不支持此编码(HEIC/RAW)或文件已损坏 (boom)")
    );
    await expect(renderPreview(REQUEST)).rejects.toThrow(/^无法解码该图片: /u);
  });

  it("内核抛非 Error 时不崩在错误处理里,仍然 reject", async () => {
    renderFrameMock.mockRejectedValue("raw-string-failure");
    await expect(renderPreview(REQUEST)).rejects.toBe("raw-string-failure");
  });
});
