import { afterEach, describe, expect, it, vi } from "vitest";

import piexif from "piexifjs";

import { buildExifApp1, readHeadBytes, spliceExifIntoJpeg } from "../../../src/utils/frame/exif";
import { EXIF_HEAD_BYTES } from "../../../src/utils/frame/types";
import {
  buildApp1Segment,
  buildExifPayload,
  buildExifPayloadWithThumbnail,
  buildJpegBlob,
  buildJpegBytes,
  findAllMarkerOffsets,
  latin1ToBytes,
  PNG_HEAD
} from "../../fixtures/build-jpeg";

/**
 * EXIF 读取与继承单测(D8)。
 * 夹具全部由 tests/fixtures/build-jpeg.ts 按 JPEG 段结构合成,不依赖二进制文件;
 * 断言重点是「零拷贝纪律」与「任何异常降级为不注入」。
 */

// @types/piexifjs 的 ExifDict 值类型是 any,测试侧同样局部收窄。
interface PiexifDictLike {
  "0th"?: Record<string, number>;
  Exif?: Record<string, number>;
}

const piexifTyped = piexif as unknown as {
  ImageIFD: { Orientation: number };
  ExifIFD: { PixelXDimension: number; PixelYDimension: number };
  load: (payloadLatin1: string) => PiexifDictLike;
};

/** 跳过 0xFFE1 标志 + 2 字节长度字段,把 payload latin1 化喂给 piexif.load。 */
const parseSegment = (segment: Uint8Array): PiexifDictLike =>
  piexifTyped.load(Array.from(segment.subarray(4), (byte) => String.fromCharCode(byte)).join(""));

const lengthFieldOf = (segment: Uint8Array): number => (segment[2] << 8) | segment[3];

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

const headWithExif = (padBytes = 0): Uint8Array =>
  buildJpegBytes({ app1Segment: buildApp1Segment(buildExifPayload({ padBytes })) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readHeadBytes", () => {
  it("只取前 EXIF_HEAD_BYTES,整个 Blob 不进内存", async () => {
    const sliceSpy = vi.spyOn(Blob.prototype, "slice");
    const head = await readHeadBytes(buildJpegBlob());
    expect(head).not.toBeNull();
    expect(sliceSpy).toHaveBeenCalledWith(0, EXIF_HEAD_BYTES);
    expect(head?.[0]).toBe(0xff);
    expect(head?.[1]).toBe(0xd8);
  });

  it("空 Blob 返回 null", async () => {
    expect(await readHeadBytes(new Blob([], { type: "image/jpeg" }))).toBeNull();
  });

  it("非 JPEG 头(PNG 魔数)返回 null", async () => {
    expect(await readHeadBytes(new Blob([PNG_HEAD], { type: "image/png" }))).toBeNull();
  });

  it("arrayBuffer 读取失败(磁盘/内存异常)返回 null", async () => {
    const spy = vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValue(new Error("read failed"));
    expect(await readHeadBytes(buildJpegBlob())).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("buildExifApp1", () => {
  it("head 为 null 返回 null", () => {
    expect(buildExifApp1(null, 800, 600)).toBeNull();
  });

  it("head 里没有 EXIF 段返回 null", () => {
    expect(buildExifApp1(buildJpegBytes(), 800, 600)).toBeNull();
  });

  it("无 EXIF 但字节流里出现假 0xFFE1(注释段内)也不误判:按段遍历而非搜字节", () => {
    const head = buildJpegBytes({ withComment: true });
    expect(findAllMarkerOffsets(head).length).toBeGreaterThan(0); // 假标志确实存在
    expect(buildExifApp1(head, 800, 600)).toBeNull();
  });

  it("产出完整 APP1 段:Orientation 修正为 1、像素尺寸写入", () => {
    const segment = buildExifApp1(headWithExif(), 1234, 567);
    expect(segment).not.toBeNull();
    const bytes = segment as Uint8Array;
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xe1);
    expect(lengthFieldOf(bytes)).toBe(bytes.length - 2);
    const dict = parseSegment(bytes);
    expect(dict["0th"]?.[String(piexifTyped.ImageIFD.Orientation)]).toBe(1);
    expect(dict.Exif?.[String(piexifTyped.ExifIFD.PixelXDimension)]).toBe(1234);
    expect(dict.Exif?.[String(piexifTyped.ExifIFD.PixelYDimension)]).toBe(567);
  });

  it("原 EXIF 含缩略图(1st IFD)时完整继承", () => {
    const head = buildJpegBytes({
      app1Segment: buildApp1Segment(buildExifPayloadWithThumbnail())
    });
    const segment = buildExifApp1(head, 1000, 800);
    expect(segment).not.toBeNull();
    const payload = Array.from((segment as Uint8Array).subarray(4), (byte) =>
      String.fromCharCode(byte)
    ).join("");
    // 缩略图的 JPEG 骨架(SOI...EOI)必须原样出现在新段 payload 里
    expect(payload).toContain("\xff\xd8");
    expect(payload).toContain("\xff\xd9");
  });

  it("width/height 为 0、负数、2^31、2^53 时不抛错且长度字段自洽", () => {
    const head = headWithExif();
    for (const [width, height] of [
      [0, 0],
      [2 ** 31, 2 ** 31],
      [-5, 2 ** 53]
    ] as const) {
      const segment = buildExifApp1(head, width, height);
      expect(segment).not.toBeNull();
      const bytes = segment as Uint8Array;
      expect(lengthFieldOf(bytes)).toBe(bytes.length - 2);
    }
  });

  it("payload 逼近 64KB 上限时长度字段仍正确", () => {
    const segment = buildExifApp1(headWithExif(65_000), 800, 600);
    expect(segment).not.toBeNull();
    const bytes = segment as Uint8Array;
    expect(bytes.length).toBeGreaterThan(65_000);
    expect(lengthFieldOf(bytes)).toBe(bytes.length - 2);
  });

  it("APP1 声明长度超出 head 实际字节(EXIF 过大/截断)降级返回 null,不产损坏段", () => {
    // 段长度字段按 65535 声明,但 payload 只写了 64KB 且截断在 TIFF 中部
    const huge = buildApp1Segment(new Uint8Array(65531).fill(0x70));
    const head = buildJpegBytes({ app1Segment: huge });
    // 截断 payload 无 "Exif\0\0" 魔数 → 段遍历拿不到 APP1;若声明长度越界则直接 break
    expect(buildExifApp1(head, 800, 600)).toBeNull();
  });

  it("piexif.load 抛错(畸形 EXIF payload)返回 null", () => {
    const garbage = latin1ToBytes("Exif\0\0not-a-real-tiff-at-all");
    expect(
      buildExifApp1(buildJpegBytes({ app1Segment: buildApp1Segment(garbage) }), 8, 8)
    ).toBeNull();
  });

  it("APP1 段存在但无有效 TIFF(视为无 EXIF)返回 null", () => {
    const emptyish = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    expect(
      buildExifApp1(buildJpegBytes({ app1Segment: buildApp1Segment(emptyish) }), 8, 8)
    ).toBeNull();
  });
});

describe("spliceExifIntoJpeg", () => {
  it("app1 为 null 返回同一个 blob 引用", async () => {
    const jpeg = buildJpegBlob();
    expect(await spliceExifIntoJpeg(jpeg, null)).toBe(jpeg);
  });

  it("在 SOS 前插入 APP1,产物 SOI 开头", async () => {
    const app1 = buildExifApp1(headWithExif(), 1024, 768);
    expect(app1).not.toBeNull();
    const bytes = await bytesOf(await spliceExifIntoJpeg(buildJpegBlob(), app1));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    const app1Offsets = findAllMarkerOffsets(bytes);
    const sosOffsets = findAllMarkerOffsets(bytes, 0xda);
    expect(app1Offsets[0]).toBeLessThan(sosOffsets[0]);
  });

  it("源 head 已有 APP1 时剔除后插入,结果里 0xFFE1 只出现一次且位于 SOS 前", async () => {
    const original = buildApp1Segment(buildExifPayload({ make: "OldCam" }));
    const jpeg = buildJpegBlob({ app1Segment: original });
    const app1 = buildExifApp1(headWithExif(), 2000, 1500);
    const bytes = await bytesOf(await spliceExifIntoJpeg(jpeg, app1));
    const app1Offsets = findAllMarkerOffsets(bytes);
    expect(app1Offsets.length).toBe(1);
    expect(app1Offsets[0]).toBeLessThan(findAllMarkerOffsets(bytes, 0xda)[0]);
  });

  it("重复 splice 同一 blob 两次不累积 APP1", async () => {
    const app1 = buildExifApp1(headWithExif(), 900, 600);
    const jpeg = buildJpegBlob({ app1Segment: buildApp1Segment(buildExifPayload()) });
    const once = await spliceExifIntoJpeg(jpeg, app1);
    const twice = await spliceExifIntoJpeg(once, app1);
    expect(findAllMarkerOffsets(await bytesOf(twice)).length).toBe(1);
  });

  it("找不到 SOS(非 JPEG 头/截断)返回原 blob 引用,不抛错", async () => {
    const broken = new Blob([PNG_HEAD], { type: "image/jpeg" });
    const app1 = buildExifApp1(headWithExif(), 800, 600);
    expect(await spliceExifIntoJpeg(broken, app1)).toBe(broken);
  });

  it("零拷贝纪律:50MB 假 Blob 上切片区间远小于 size,且从不整体 arrayBuffer", async () => {
    const headBytes = buildJpegBytes();
    const arrayBufferSpy = vi.fn(async () => {
      throw new Error("不允许把大 Blob 整体读进内存");
    });
    const sliceSpy = vi.fn((start?: number, end?: number) => {
      // 头部扫描拿真字节;其余区间拿占位小 Blob(内容不影响拼接断言)
      if (start === 0 && end !== undefined) {
        return new Blob([headBytes.subarray(0, Math.min(end, headBytes.length))], {
          type: "image/jpeg"
        });
      }
      return new Blob([new Uint8Array([0x00])], { type: "image/jpeg" });
    });
    const huge = {
      size: 50_000_000,
      type: "image/jpeg",
      slice: sliceSpy,
      arrayBuffer: arrayBufferSpy
    } as unknown as Blob;

    const app1 = buildExifApp1(headWithExif(), 800, 600);
    const out = await spliceExifIntoJpeg(huge, app1);
    expect(out).not.toBe(huge);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    // 从未出现 slice(0) 单参全量取;每个切片都是头部窗口内的小区间
    const calls = sliceSpy.mock.calls as Array<[number | undefined, number | undefined]>;
    expect(calls.length).toBeGreaterThan(0);
    for (const [start, end] of calls) {
      expect(typeof start).toBe("number");
      expect(end === undefined || end - (start as number) <= 64 * 1024).toBe(true);
    }
  });

  it("真实 Blob 上同样成立:唯一一次 arrayBuffer 发生在 64KB 头切片上,jpeg 本体不被读", async () => {
    const jpeg = buildJpegBlob({ app1Segment: buildApp1Segment(buildExifPayload()) });
    const app1 = buildExifApp1(headWithExif(), 640, 480);
    const spy = vi.spyOn(Blob.prototype, "arrayBuffer");
    await spliceExifIntoJpeg(jpeg, app1);
    expect(spy).toHaveBeenCalledTimes(1);
    const receiver = spy.mock.contexts[0] as Blob;
    expect(receiver).not.toBe(jpeg);
    expect(receiver.size).toBeLessThanOrEqual(64 * 1024);
  });
});
