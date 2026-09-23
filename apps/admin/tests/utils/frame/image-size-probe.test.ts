import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGE_HEAD_PROBE_BYTES,
  probeSizeFromHead,
  probeSourceSize
} from "../../../src/utils/frame/image-size-probe";
import {
  buildJpegHead,
  buildOrientationApp1,
  buildPngHead,
  buildRiffChunk,
  buildWebpExtended,
  buildWebpHead,
  buildWebpLossless,
  buildWebpLossy
} from "../../fixtures/build-image-containers";

/**
 * 源图尺寸探测单测(阶段 10)。
 *
 * 只 mock 一个边界:`render-core` 的解码器(它要真画布与 `createImageBitmap`,jsdom 都没有)。
 * 字节解析部分是纯函数,直接喂 `tests/fixtures/build-image-containers.ts` 的合成容器,
 * 这样「SOF/PNG/WebP 各自的数字偏移」与「Orientation 交换」都能被确定地验证。
 *
 * 六类边界:空值(null、过短、非图片字节)、零值(宽 0、0 字节文件)、越界(段长越界、方向值 9)、
 * 权限缺失(不适用:本层不碰任何鉴权与网络)、上游失败(二次解码也失败)、非法状态迁移(不适用)。
 */

const decodeDouble = vi.hoisted(() => vi.fn());
vi.mock("../../../src/utils/frame/render-core", () => ({ decodeImageScaled: decodeDouble }));

const textBytes = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);

beforeEach(() => {
  decodeDouble.mockReset();
});

describe("probeSizeFromHead · 不解码的源图尺寸探测", () => {
  it("JPEG 的 SOF0/SOF1/SOF2 都能读出宽高", () => {
    for (const marker of [0xc0, 0xc1, 0xc2]) {
      expect(probeSizeFromHead(buildJpegHead(4000, 3000, { sofMarker: marker }))).toEqual({
        width: 4000,
        height: 3000
      });
    }
  });

  it("EXIF Orientation 5/6/7/8 交换宽高;1 与非法值不交换(与 createImageBitmap 的转正口径一致)", () => {
    for (const orientation of [5, 6, 7, 8]) {
      for (const littleEndian of [true, false]) {
        const head = buildJpegHead(4000, 3000, {
          app1: buildOrientationApp1(orientation, littleEndian)
        });
        expect(probeSizeFromHead(head)).toEqual({ width: 3000, height: 4000 });
      }
    }
    expect(probeSizeFromHead(buildJpegHead(4000, 3000, { app1: buildOrientationApp1(1) }))).toEqual(
      { width: 4000, height: 3000 }
    );
    // 方向值越界(9)按「不旋转」处理,而不是猜一个旋转
    expect(probeSizeFromHead(buildJpegHead(400, 300, { app1: buildOrientationApp1(9) }))).toEqual({
      width: 400,
      height: 300
    });
  });

  it("空值与零值:null、过短、非图片字节、宽 0 一律 null(绝不返回 {0,0})", () => {
    expect(probeSizeFromHead(null)).toBeNull();
    expect(probeSizeFromHead(new Uint8Array(8))).toBeNull();
    expect(probeSizeFromHead(textBytes("not an image at all here"))).toBeNull();
    expect(probeSizeFromHead(buildPngHead(0, 600))).toBeNull();
    // 有损 WebP 的宽度字段是裸 14 位,0 就是 0;(VP8X 存的是「值−1」,宽 0 表达不出来,不构成零值用例)
    expect(probeSizeFromHead(buildWebpHead([buildWebpLossy(0, 480)]))).toBeNull();
    expect(probeSizeFromHead(buildWebpHead([buildWebpExtended(4000, 3000)]))).not.toBeNull();
  });

  it("段遍历不越界也不误判:先遇 SOS 即判负、段长越界判负、标志错位判负", () => {
    expect(
      probeSizeFromHead(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22]))
    ).toBeNull();
    expect(
      probeSizeFromHead(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x7f, 0xff, 0x08]))
    ).toBeNull();
    expect(probeSizeFromHead(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  it("PNG 读 IHDR;WebP 的 VP8X / VP8 / VP8L 各读各的", () => {
    expect(probeSizeFromHead(buildPngHead(2000, 1500))).toEqual({ width: 2000, height: 1500 });
    expect(probeSizeFromHead(buildWebpHead([buildWebpExtended(1024, 768)]))).toEqual({
      width: 1024,
      height: 768
    });
    expect(probeSizeFromHead(buildWebpHead([buildWebpLossy(640, 480)]))).toEqual({
      width: 640,
      height: 480
    });
    expect(probeSizeFromHead(buildWebpHead([buildWebpLossless(333, 222)]))).toEqual({
      width: 333,
      height: 222
    });
  });

  it("WebP 跳过未知 chunk(含奇数长度对齐)后仍能找到尺寸 chunk", () => {
    const odd = buildRiffChunk("ICCP", new Uint8Array([1, 2, 3])); // 3 字节 → 需补 1 字节对齐
    expect(probeSizeFromHead(buildWebpHead([odd, buildWebpExtended(800, 600)]))).toEqual({
      width: 800,
      height: 600
    });
    expect(probeSizeFromHead(buildWebpExtended(800, 600))).toBeNull(); // 没有 RIFF 容器即判负
  });

  it("探测读取量固定 64KB(远小于 EXIF_HEAD_BYTES,不把整文件读进内存)", () => {
    expect(IMAGE_HEAD_PROBE_BYTES).toBe(64 * 1024);
  });
});

describe("probeSourceSize · 头部读不出来才付二次解码的代价(Rare path)", () => {
  it("头部可解时一个像素都不解码", async () => {
    const file = new File([buildJpegHead(300, 200)], "a.jpg", { type: "image/jpeg" });
    expect(await probeSourceSize(file)).toEqual({ width: 300, height: 200 });
    expect(decodeDouble).not.toHaveBeenCalled();
  });

  it("头部不可解 → 全尺寸解一次只为拿尺寸,并且立刻 close()", async () => {
    const close = vi.fn();
    decodeDouble.mockResolvedValue({ width: 640, height: 480, close });
    const file = new File([textBytes("heic-ish bytes we cannot parse")], "a.heic");
    expect(await probeSourceSize(file)).toEqual({ width: 640, height: 480 });
    // 只为拿尺寸必须传 target=null;否则解出来的是缩放结果,尺寸就不再是源图口径
    expect(decodeDouble).toHaveBeenCalledWith(file, null);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("上游失败:二次解码也失败 → null,不抛错也不返回 {0,0},且不调用 close", async () => {
    const close = vi.fn();
    decodeDouble.mockImplementation(async () => {
      throw new Error("无法解码该图片");
    });
    const file = new File([textBytes("junk bytes here")], "a.bin");
    expect(await probeSourceSize(file)).toBeNull();
    expect(decodeDouble).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("解码回报 0 尺寸(退化的位图)也按 null 处理,不把 0 传给 resolveOutputSize", async () => {
    decodeDouble.mockResolvedValue({ width: 0, height: 0, close: vi.fn() });
    expect(await probeSourceSize(new File([textBytes("junk")], "a.bin"))).toBeNull();
  });

  it("零值:0 字节文件不读头部、不抛错,直接交给 Rare path", async () => {
    const close = vi.fn();
    decodeDouble.mockResolvedValue({ width: 1, height: 1, close });
    expect(await probeSourceSize(new Blob([], { type: "image/jpeg" }))).toEqual({
      width: 1,
      height: 1
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
