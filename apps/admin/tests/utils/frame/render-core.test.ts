import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeImageScaled,
  mainThreadSurface,
  renderFrame
} from "../../../src/utils/frame/render-core";
import { DEFAULT_LOGO_SIZE, JPEG_QUALITY } from "../../../src/utils/frame/types";
import type { FrameRenderRequest, OutputSize, RenderSurface } from "../../../src/utils/frame/types";

/**
 * 渲染内核单测(阶段 9)。
 *
 * jsdom 里没有 OffscreenCanvas、没有 createImageBitmap、没有真 2d 上下文,所以内核的三条
 * 外部边界全部注入替身:`RenderSurface`(契约提供的合法注入点)、全局 `createImageBitmap`
 * 与 `OffscreenCanvas`(解码与逐级减半回退路径唯一依赖的全局能力)、`style-registry` 与
 * `exif`(模块边界,断言「内核怎么调它们」而不是它们的内部实现)。
 *
 * 六类边界对照:空值(target / exifHead / logoBlob 为 null)、越界(画布超限导致 getContext
 * 返回 null)、网络失败(浏览器不支持该编码 → 解码抛错)、非法状态迁移(失败路径仍要释放
 * 资源、已释放的位图不再被绘制端使用);零值与权限缺失在本层不适用——输出尺寸正数由
 * resolveOutputSize 保证,本站无鉴权。
 */

const { drawSpy, exifDouble } = vi.hoisted(() => ({
  drawSpy: vi.fn(),
  exifDouble: { buildExifApp1: vi.fn(), spliceExifIntoJpeg: vi.fn() }
}));

// 样式注册表替身保留「未注册返回 null」的真实语义,绘制实现换成可断言入参的 spy。
vi.mock("../../../src/utils/frame/style-registry", () => ({
  PLAIN_FRAME_STYLE_ID: "plain-frame",
  getFrameStyle: (styleId: string) =>
    styleId === "plain-frame" ? { id: styleId, draw: drawSpy } : null,
  listFrameStyleIds: () => ["plain-frame"]
}));

vi.mock("../../../src/utils/frame/exif", () => exifDouble);

// ---------------------------------------------------------------- 画布替身

interface FakeContext {
  readonly draws: OutputSize[];
  imageSmoothingQuality: string;
}

interface FakeCanvasRecord {
  width: number;
  height: number;
  readonly context: FakeContext | null;
  getContext(contextId: string): FakeContext | null;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

interface CanvasScaffold {
  readonly created: FakeCanvasRecord[];
  readonly encoded: { type?: string; quality?: number }[];
  readonly events: string[];
  /** offscreen = Worker 分支(convertToBlob),dom = 主线程降级分支(toBlob) */
  branch: "offscreen" | "dom";
  nullContext: boolean;
  fontsLoaded: boolean;
  jpeg: Blob;
}

const createCanvasScaffold = (): CanvasScaffold => ({
  created: [],
  encoded: [],
  events: [],
  branch: "offscreen",
  nullContext: false,
  fontsLoaded: true,
  jpeg: new Blob(["jpeg-bytes"], { type: "image/jpeg" })
});

const createFakeContext = (): FakeContext => {
  const draws: OutputSize[] = [];
  return {
    draws,
    imageSmoothingQuality: "",
    drawImage: (_source: unknown, _x: number, _y: number, width: number, height: number) => {
      draws.push({ width, height });
    }
  } as FakeContext;
};

const registerCanvas = (
  scaffold: CanvasScaffold,
  width: number,
  height: number
): FakeCanvasRecord => {
  const context = scaffold.nullContext ? null : createFakeContext();
  const canvas: FakeCanvasRecord = {
    width,
    height,
    context,
    getContext: (contextId: string) => (contextId === "2d" ? context : null)
  };
  if (scaffold.branch === "offscreen") {
    canvas.convertToBlob = (options) => {
      scaffold.encoded.push(options ?? {});
      return Promise.resolve(scaffold.jpeg);
    };
  } else {
    canvas.toBlob = (callback, type, quality) => {
      scaffold.encoded.push({ type, quality });
      callback(scaffold.jpeg);
    };
  }
  scaffold.created.push(canvas);
  return canvas;
};

const createFakeSurface = (scaffold: CanvasScaffold): RenderSurface => ({
  createCanvas: (width, height) =>
    registerCanvas(scaffold, width, height) as unknown as OffscreenCanvas,
  loadFonts: async () => {
    scaffold.events.push("fonts");
    return scaffold.fontsLoaded;
  }
});

/**
 * 解码回退路径不吃 surface(render-core 只能按全局能力造画布),所以这里把
 * 全局 OffscreenCanvas 换成登记到同一个 scaffold 的假类,才能断言减半链路。
 */
const stubGlobalOffscreenCanvas = (scaffold: CanvasScaffold): void => {
  class FakeScalingCanvas implements FakeCanvasRecord {
    width: number;
    height: number;
    readonly context: FakeContext | null;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.context = scaffold.nullContext ? null : createFakeContext();
      scaffold.created.push(this);
    }

    getContext(contextId: string): FakeContext | null {
      return contextId === "2d" ? this.context : null;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeScalingCanvas);
};

// ---------------------------------------------------------------- 解码器替身

interface DecoderScaffold {
  readonly calls: { source: unknown; options?: Record<string, unknown> }[];
  /** 每 close() 一次追加一条,顺序即释放顺序——内存泄漏守卫看的就是这个列表 */
  readonly closed: OutputSize[];
  sourceSize: OutputSize;
  /** 指定源(如 logo)单独给尺寸,便于在 closed 里分辨是哪张位图 */
  readonly sizeBySource: { source: unknown; size: OutputSize }[];
  /** false = 浏览器收下 resize 选项却静默忽略(部分 Safari 的真实行为) */
  honorResize: boolean;
  rejectWith: "never" | "withOptions" | "always";
  failingSource?: unknown;
}

const createDecoderScaffold = (overrides: Partial<DecoderScaffold> = {}): DecoderScaffold => ({
  calls: [],
  closed: [],
  sourceSize: { width: 4000, height: 3000 },
  sizeBySource: [],
  honorResize: true,
  rejectWith: "never",
  ...overrides
});

const makeBitmap = (scaffold: DecoderScaffold, size: OutputSize): ImageBitmap => ({
  ...size,
  close: () => {
    scaffold.closed.push(size);
  }
});

const stubCreateImageBitmap = (scaffold: DecoderScaffold): void => {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (source: unknown, options?: Record<string, unknown>): Promise<ImageBitmap> => {
      scaffold.calls.push({ source, options });
      const broken = Boolean(scaffold.failingSource) && source === scaffold.failingSource;
      if (broken || scaffold.rejectWith === "always") throw new Error("Unsupported image format");
      if (options) {
        if (scaffold.rejectWith === "withOptions") throw new Error("not supported");
        if (scaffold.honorResize) {
          return makeBitmap(scaffold, {
            width: options.resizeWidth as number,
            height: options.resizeHeight as number
          });
        }
      }
      const pinned = scaffold.sizeBySource.find((entry) => entry.source === source);
      if (pinned) return makeBitmap(scaffold, pinned.size);
      const drawable = source as Partial<OutputSize>;
      if (typeof drawable?.width === "number" && typeof drawable?.height === "number") {
        // 源是画布(减半链路的最后一步):按画布尺寸返回,产物尺寸因此可被断言
        return makeBitmap(scaffold, { width: drawable.width, height: drawable.height });
      }
      return makeBitmap(scaffold, scaffold.sourceSize);
    })
  );
};

// ---------------------------------------------------------------- 请求夹具

const createRequest = (overrides: Partial<FrameRenderRequest> = {}): FrameRenderRequest => ({
  fileName: "sample",
  blob: new Blob(["photo-bytes"], { type: "image/jpeg" }),
  target: { width: 2000, height: 1500 },
  jpegQuality: JPEG_QUALITY,
  styleId: "plain-frame",
  fields: { exposure: "f/2.8  1/250s  ISO100", model: "X-T5" },
  exifHead: null,
  logoMark: "PH",
  logoBlob: null,
  logoSize: DEFAULT_LOGO_SIZE,
  ...overrides
});

const exifHead = new Uint8Array([0xff, 0xd8]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("decodeImageScaled:解码期缩放(D20)", () => {
  it("target 非空时按 resizeWidth/resizeHeight/resizeQuality=high 解码", async () => {
    const decoder = createDecoderScaffold();
    stubCreateImageBitmap(decoder);
    const blob = new Blob(["photo"]);

    const bitmap = await decodeImageScaled(blob, { width: 2000, height: 1500 });

    expect(decoder.calls).toEqual([
      { source: blob, options: { resizeWidth: 2000, resizeHeight: 1500, resizeQuality: "high" } }
    ]);
    expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 2000, height: 1500 });
  });

  it("target 为 null 时全尺寸解码、不传 resize 选项", async () => {
    const decoder = createDecoderScaffold();
    stubCreateImageBitmap(decoder);

    const bitmap = await decodeImageScaled(new Blob(["photo"]), null);

    expect(decoder.calls).toHaveLength(1);
    expect(decoder.calls[0]?.options).toBeUndefined();
    expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 4000, height: 3000 });
  });

  it("浏览器静默忽略 resize 选项时退回全尺寸解码 + 逐级减半,产物尺寸等于 target", async () => {
    const decoder = createDecoderScaffold({ honorResize: false });
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);
    stubGlobalOffscreenCanvas(scaffold);

    const bitmap = await decodeImageScaled(new Blob(["photo"]), { width: 1000, height: 750 });

    // 第一次带选项(被忽略)、第二次全尺寸、第三次从画布解出目标尺寸
    expect(decoder.calls.map((call) => Boolean(call.options))).toEqual([true, false, false]);
    // 减半链路 4000×3000 → 2000×1500 → 1000×750,而不是 6000px 一次缩到位
    const [first, second] = scaffold.created;
    expect(first?.context?.draws).toEqual([{ width: 2000, height: 1500 }]);
    expect(second?.context?.draws).toEqual([{ width: 1000, height: 750 }]);
    expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 1000, height: 750 });
  });

  it("带 resize 选项直接抛错时同样走回退路径", async () => {
    const decoder = createDecoderScaffold({ rejectWith: "withOptions" });
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);
    stubGlobalOffscreenCanvas(scaffold);

    const bitmap = await decodeImageScaled(new Blob(["photo"]), { width: 2000, height: 1500 });

    expect(decoder.calls.map((call) => Boolean(call.options))).toEqual([true, false, false]);
    expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 2000, height: 1500 });
  });

  it("回退路径释放「被忽略的全尺寸位图」与全部中间画布", async () => {
    const decoder = createDecoderScaffold({ honorResize: false });
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);
    stubGlobalOffscreenCanvas(scaffold);

    await decodeImageScaled(new Blob(["photo"]), { width: 1000, height: 750 });

    // 两张 4000×3000:选项被忽略的产物 + 全尺寸解码的源,都必须 close();
    // 减半中间画布靠宽高归零释放,返回值那张交给调用方 close。
    expect(decoder.closed).toEqual([
      { width: 4000, height: 3000 },
      { width: 4000, height: 3000 }
    ]);
    expect(scaffold.created.map((canvas) => [canvas.width, canvas.height])).toEqual([
      [0, 0],
      [0, 0]
    ]);
  });

  it("编码不支持(HEIC 等)时抛中文可读错误", async () => {
    const decoder = createDecoderScaffold({ rejectWith: "always" });
    stubCreateImageBitmap(decoder);

    await expect(decodeImageScaled(new Blob(["heic"]), null)).rejects.toThrow(/无法解码/);
    await expect(decodeImageScaled(new Blob(["heic"]), { width: 10, height: 10 })).rejects.toThrow(
      /无法解码/
    );
  });

  it("环境没有 createImageBitmap 时抛中文错误而不是静默产出空图", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(decodeImageScaled(new Blob(["photo"]), null)).rejects.toThrow(
      /createImageBitmap|无法解码/
    );
  });
});

describe("renderFrame:Worker 与主线程共用的单张渲染", () => {
  it("注册字体 → 解码 → 建画布 → 绘制 → 编码,结果尺寸取自位图实际尺寸", async () => {
    const decoder = createDecoderScaffold();
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);

    const result = await renderFrame(createRequest(), createFakeSurface(scaffold));

    expect(scaffold.events).toEqual(["fonts"]);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    const [context, width, height, bitmap, fields, logo] = drawSpy.mock.calls[0];
    expect(context).toBe(scaffold.created[0]?.getContext("2d"));
    expect({ width, height }).toEqual({ width: 2000, height: 1500 });
    expect(bitmap.width).toBe(2000);
    expect(fields).toEqual({ exposure: "f/2.8  1/250s  ISO100", model: "X-T5" });
    expect(logo).toEqual({ mark: "PH", scale: 1 });
    expect(scaffold.encoded).toEqual([{ type: "image/jpeg", quality: JPEG_QUALITY }]);
    expect(result).toEqual({ blob: scaffold.jpeg, width: 2000, height: 1500, exifInjected: false });
    expect(decoder.closed).toEqual([{ width: 2000, height: 1500 }]);
    expect(scaffold.created[0]?.width).toBe(0);
    expect(scaffold.created[0]?.height).toBe(0);
  });

  it("字体注册返回 false 时仍继续出图(字体缺失只影响观感)", async () => {
    const scaffold = createCanvasScaffold();
    scaffold.fontsLoaded = false;
    stubCreateImageBitmap(createDecoderScaffold());

    const result = await renderFrame(createRequest({ target: null }), createFakeSurface(scaffold));

    expect(result.width).toBe(4000);
    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it("主线程降级分支用 toBlob 取字节,不碰 toDataURL(base64 放大会吃光预算)", async () => {
    const decoder = createDecoderScaffold();
    const scaffold = createCanvasScaffold();
    scaffold.branch = "dom";
    stubCreateImageBitmap(decoder);

    const result = await renderFrame(createRequest(), createFakeSurface(scaffold));

    expect(scaffold.created[0]?.convertToBlob).toBeUndefined();
    expect(scaffold.encoded).toEqual([{ type: "image/jpeg", quality: JPEG_QUALITY }]);
    expect(result.blob).toBe(scaffold.jpeg);
    expect(decoder.closed).toEqual([{ width: 2000, height: 1500 }]);
  });

  it("画布上下文取不到时按面积超限报错,失败路径仍释放位图与画布", async () => {
    const decoder = createDecoderScaffold();
    const scaffold = createCanvasScaffold();
    scaffold.nullContext = true;
    stubCreateImageBitmap(decoder);

    await expect(renderFrame(createRequest(), createFakeSurface(scaffold))).rejects.toThrow(
      /无法取得 2000×1500 画布的 2d 上下文.*上限/
    );
    expect(decoder.closed).toEqual([{ width: 2000, height: 1500 }]);
    expect(scaffold.created[0]?.width).toBe(0);
    expect(drawSpy).not.toHaveBeenCalled();
  });

  it("未知 styleId 抛错且不静默回落", async () => {
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(createDecoderScaffold());

    await expect(
      renderFrame(createRequest({ styleId: "not-registered" }), createFakeSurface(scaffold))
    ).rejects.toThrow(/未在注册表登记/);
    expect(drawSpy).not.toHaveBeenCalled();
  });

  it("logo 位图解码失败不算整张失败:退回文字块", async () => {
    const logoBlob = new Blob(["broken-logo"]);
    const decoder = createDecoderScaffold({ failingSource: logoBlob });
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);

    const result = await renderFrame(createRequest({ logoBlob }), createFakeSurface(scaffold));

    expect(result.width).toBe(2000);
    const logo = drawSpy.mock.calls[0][5];
    // 基准档(10)换算出 scale=1;缺位图即绘制端走文字块
    expect(logo).toEqual({ mark: "PH", scale: 1 });
    // 源图一次 + logo 一次(抛错),失败的那张没有位图可 close
    expect(decoder.calls).toHaveLength(2);
    expect(decoder.closed).toEqual([{ width: 2000, height: 1500 }]);
  });

  it("logo 可用时位图与文字兜底一起交给绘制端,并在 finally 里一并 close", async () => {
    const logoBlob = new Blob(["logo"]);
    const decoder = createDecoderScaffold({
      sizeBySource: [{ source: logoBlob, size: { width: 64, height: 32 } }]
    });
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);

    await renderFrame(createRequest({ logoBlob }), createFakeSurface(scaffold));

    const logo = drawSpy.mock.calls[0][5];
    expect(logo.mark).toBe("PH");
    expect(logo.bitmap).toMatchObject({ width: 64, height: 32 });
    expect(decoder.closed).toEqual([
      { width: 2000, height: 1500 },
      { width: 64, height: 32 }
    ]);
  });

  it("logo大小档位换算成比例:scale = logoSize / LOGO_SIZE_MAX 随请求交给绘制端", async () => {
    stubCreateImageBitmap(createDecoderScaffold());
    const scaffold = createCanvasScaffold();

    await renderFrame(createRequest({ logoSize: 5 }), createFakeSurface(scaffold));

    expect(drawSpy.mock.calls[0][5]).toMatchObject({ scale: 0.5 });
  });

  it("exifHead 为 null 时不注入、也不调 splice", async () => {
    stubCreateImageBitmap(createDecoderScaffold());
    const scaffold = createCanvasScaffold();

    const result = await renderFrame(
      createRequest({ exifHead: null }),
      createFakeSurface(scaffold)
    );

    expect(exifDouble.buildExifApp1).not.toHaveBeenCalled();
    expect(exifDouble.spliceExifIntoJpeg).not.toHaveBeenCalled();
    expect(result.exifInjected).toBe(false);
  });

  it("EXIF 正常注入:按输出尺寸修正后拼接,exifInjected 为 true", async () => {
    stubCreateImageBitmap(createDecoderScaffold());
    const scaffold = createCanvasScaffold();
    const app1 = new Uint8Array([0xff, 0xe1]);
    const spliced = new Blob(["spliced"], { type: "image/jpeg" });
    exifDouble.buildExifApp1.mockReturnValue(app1);
    exifDouble.spliceExifIntoJpeg.mockResolvedValue(spliced);

    const result = await renderFrame(createRequest({ exifHead }), createFakeSurface(scaffold));

    expect(exifDouble.buildExifApp1).toHaveBeenCalledWith(exifHead, 2000, 1500);
    expect(exifDouble.spliceExifIntoJpeg).toHaveBeenCalledWith(scaffold.jpeg, app1);
    expect(result.blob).toBe(spliced);
    expect(result.exifInjected).toBe(true);
  });

  it("splice 降级原样返回时 exifInjected 如实报 false", async () => {
    stubCreateImageBitmap(createDecoderScaffold());
    const scaffold = createCanvasScaffold();
    exifDouble.buildExifApp1.mockReturnValue(new Uint8Array([0xff, 0xe1]));
    exifDouble.spliceExifIntoJpeg.mockImplementation(async (jpeg: Blob) => jpeg);

    const result = await renderFrame(createRequest({ exifHead }), createFakeSurface(scaffold));

    expect(result.blob).toBe(scaffold.jpeg);
    expect(result.exifInjected).toBe(false);
  });

  it("EXIF 环节抛异常时仍交付未注入的成品(元数据丢失不作废照片)", async () => {
    stubCreateImageBitmap(createDecoderScaffold());
    const scaffold = createCanvasScaffold();
    exifDouble.buildExifApp1.mockImplementation(() => {
      throw new Error("piexif 内部异常");
    });

    const result = await renderFrame(createRequest({ exifHead }), createFakeSurface(scaffold));

    expect(result.blob).toBe(scaffold.jpeg);
    expect(result.exifInjected).toBe(false);
  });

  it("target 为 null 时按源图尺寸建画布(原图档/预览)", async () => {
    const decoder = createDecoderScaffold();
    const scaffold = createCanvasScaffold();
    stubCreateImageBitmap(decoder);

    const result = await renderFrame(createRequest({ target: null }), createFakeSurface(scaffold));

    expect(decoder.calls[0]?.options).toBeUndefined();
    expect(result.width).toBe(4000);
    expect(result.height).toBe(3000);
    // 建画布时按 4000×3000,结束时归零释放
    expect(scaffold.created[0]).toMatchObject({ width: 0, height: 0 });
  });
});

describe("mainThreadSurface:主线程降级面", () => {
  it("createCanvas 产出已设尺寸的 DOM canvas", () => {
    const canvas = mainThreadSurface.createCanvas(123, 45);

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 123, height: 45 });
  });

  it("loadFonts 在缺 FontFace/font set 的环境降级为布尔值而不抛错", async () => {
    const loaded = await mainThreadSurface.loadFonts();

    expect(typeof loaded).toBe("boolean");
  });
});
