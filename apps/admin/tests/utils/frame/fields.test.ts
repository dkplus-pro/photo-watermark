import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * EXIF 提取与相框文案映射单测。
 * exifr 用 vi.mock 桩掉:动态 import 失败(等价「模块加载/网络失败」)与解析异常
 * 都必须降级为 `{}` 而不是把错误信息画进用户照片。
 */

const exifrState = vi.hoisted(() => ({
  current: {
    failImport: false,
    rejectParse: false,
    raw: {}
  } as {
    failImport: boolean;
    rejectParse: boolean;
    raw: Record<string, unknown> | null;
  }
}));

vi.mock("exifr", async () => {
  if (exifrState.current.failImport) {
    throw new Error("模拟 exifr 模块加载失败");
  }
  return {
    parse: vi.fn(async () => {
      if (exifrState.current.rejectParse) throw new Error("模拟 parse 失败");
      return exifrState.current.raw;
    })
  };
});

const loadFields = async () => {
  vi.resetModules();
  return await import("../../../src/utils/frame/fields");
};

const jpegBlob = (): Blob => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]);

beforeEach(() => {
  exifrState.current = { failImport: false, rejectParse: false, raw: {} };
});

describe("extractPhotoExif", () => {
  it("exifr 动态 import 失败时返回 {} 不抛", async () => {
    exifrState.current.failImport = true;
    const { extractPhotoExif } = await loadFields();
    await expect(extractPhotoExif(jpegBlob())).resolves.toEqual({});
  });

  it("parse 抛错(文件损坏)时返回 {} 不抛", async () => {
    exifrState.current.rejectParse = true;
    const { extractPhotoExif } = await loadFields();
    await expect(extractPhotoExif(jpegBlob())).resolves.toEqual({});
  });

  it("parse 返回 null(无 EXIF)时字段全空", async () => {
    exifrState.current.raw = null;
    const { extractPhotoExif } = await loadFields();
    const exif = await extractPhotoExif(jpegBlob());
    expect(exif).toEqual({
      cameraMake: undefined,
      cameraModel: undefined,
      lens: undefined,
      iso: undefined,
      aperture: undefined,
      shutter: undefined,
      focalLength: undefined,
      capturedAt: undefined
    });
  });

  it("常规字段:字符串修剪、ISO 数值原样、pick 清单里的字段都吃到", async () => {
    exifrState.current.raw = {
      Make: "  Canon  ",
      Model: "EOS R5",
      LensModel: "RF24-70mm F2.8",
      ISO: 100,
      FNumber: 2.8,
      ExposureTime: 0.004,
      FocalLength: 35,
      DateTimeOriginal: new Date("2026-01-02T03:04:05.000Z")
    };
    const { extractPhotoExif } = await loadFields();
    expect(await extractPhotoExif(jpegBlob())).toEqual({
      cameraMake: "Canon",
      cameraModel: "EOS R5",
      lens: "RF24-70mm F2.8",
      iso: 100,
      aperture: "f/2.8",
      shutter: "1/250s",
      focalLength: "35mm",
      capturedAt: "2026-01-02T03:04:05.000Z"
    });
  });

  it("光圈整数值渲染为 f/2(不带 .0),快门 ≥1 秒按 2s/1.3s 形态", async () => {
    exifrState.current.raw = { FNumber: 2, ExposureTime: 2 };
    const { extractPhotoExif } = await loadFields();
    const exif = await extractPhotoExif(jpegBlob());
    expect(exif.aperture).toBe("f/2");
    expect(exif.shutter).toBe("2s");

    exifrState.current.raw = { FNumber: "4", ExposureTime: 1.3 };
    const exif2 = await extractPhotoExif(jpegBlob());
    expect(exif2.aperture).toBe("f/4");
    expect(exif2.shutter).toBe("1.3s");
  });

  it("有理数三种形态(number / [num,den] / {numerator,denominator})都解析", async () => {
    const { extractPhotoExif } = await loadFields();
    exifrState.current.raw = {
      ExposureTime: [1, 250],
      FNumber: { numerator: 28, denominator: 10 }
    };
    const exif = await extractPhotoExif(jpegBlob());
    expect(exif.shutter).toBe("1/250s");
    expect(exif.aperture).toBe("f/2.8");

    exifrState.current.raw = { ExposureTime: "2", FocalLength: [85, 1], ISO: [400] };
    const exif2 = await extractPhotoExif(jpegBlob());
    expect(exif2.shutter).toBe("2s");
    expect(exif2.focalLength).toBe("85mm");
    expect(exif2.iso).toBe(400); // ISOSpeedRatings 的 SHORT 数组形态
  });

  it("吃不到的数字形态一律 undefined(不猜、不 NaN)", async () => {
    exifrState.current.raw = {
      FNumber: [1, 0], // 分母为 0
      ExposureTime: "abc",
      FocalLength: [1, 2, 3],
      ISO: {}
    };
    const { extractPhotoExif } = await loadFields();
    const exif = await extractPhotoExif(jpegBlob());
    expect(exif.aperture).toBeUndefined();
    expect(exif.shutter).toBeUndefined();
    expect(exif.focalLength).toBeUndefined();
    expect(exif.iso).toBeUndefined();
  });

  it("时间:Date 转 ISO;不可解析的字符串原样保留;全无效为 undefined", async () => {
    const { extractPhotoExif } = await loadFields();
    exifrState.current.raw = { DateTimeOriginal: new Date("2026-01-02T03:04:05.000Z") };
    expect((await extractPhotoExif(jpegBlob())).capturedAt).toBe("2026-01-02T03:04:05.000Z");

    // Date 之外的不可解析字符串 → 按契约原样返回
    exifrState.current.raw = { DateTimeOriginal: "not a timestamp" };
    expect((await extractPhotoExif(jpegBlob())).capturedAt).toBe("not a timestamp");

    exifrState.current.raw = { CreateDate: new Date("invalid") };
    expect((await extractPhotoExif(jpegBlob())).capturedAt).toBeUndefined();
  });
});

describe("frameFieldsFromExif", () => {
  it("undefined / 空对象 → 全字段 undefined(绘制端无文字不画)", async () => {
    const { frameFieldsFromExif } = await loadFields();
    expect(frameFieldsFromExif()).toEqual({
      brand: undefined,
      model: undefined,
      lens: undefined,
      focalLength: undefined,
      exposure: undefined
    });
    expect(Object.values(frameFieldsFromExif({})).every((v) => v === undefined)).toBe(true);
  });

  it("只有 iso → exposure === 'ISO100'", async () => {
    const { frameFieldsFromExif } = await loadFields();
    expect(frameFieldsFromExif({ iso: 100 }).exposure).toBe("ISO100");
  });

  it("exposure 按 `光圈  快门  ISO` 两空格拼接,缺项跳过", async () => {
    const { frameFieldsFromExif } = await loadFields();
    expect(frameFieldsFromExif({ aperture: "f/2.8", shutter: "1/250s", iso: 400 }).exposure).toBe(
      "f/2.8  1/250s  ISO400"
    );
    expect(frameFieldsFromExif({ aperture: "f/4", iso: 200 }).exposure).toBe("f/4  ISO200");
  });

  it("brand/model/lens/focalLength 直通映射,空白串视为缺失", async () => {
    const { frameFieldsFromExif } = await loadFields();
    expect(
      frameFieldsFromExif({
        cameraMake: "Nikon",
        cameraModel: " Z6 ",
        lens: "  ",
        focalLength: "50mm"
      })
    ).toEqual({
      brand: "Nikon",
      model: "Z6",
      lens: undefined,
      focalLength: "50mm",
      exposure: undefined
    });
  });
});
