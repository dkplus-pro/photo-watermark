import piexif from "piexifjs";

/**
 * 合成 JPEG 夹具(不提交二进制 jpg:污染 diff,也覆盖不了异常分支)。
 *
 * 说明:我们的 head 解析/splice 只依赖 JPEG 段标志与偏移,不依赖真实压缩数据,
 * 因此这里按段结构拼出「合法形状」的字节序列(SOI/APP0/[APP1]/DQT/SOF0/SOS/伪扫描数据/EOI),
 * APP1 用 piexif.dump 生成,与真机产物的段布局一致。
 */

// piexif.dump 产出 latin1 字符串(`Exif\0\0` 开头),latin1 与字节一一对应。
export const latin1ToBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

export interface FixtureExifDict {
  orientation?: number;
  make?: string;
  model?: string;
  /** 追加超大 MakerNote 用,单位字节 */
  padBytes?: number;
}

/** 生成已含 `Exif\0\0` 前缀的 APP1 payload(即 piexif.dump 的产物字节)。 */
export const buildExifPayload = (dict: FixtureExifDict = {}): Uint8Array => {
  const { orientation = 6, make = "FixtureCam", model = "FX-100", padBytes = 0 } = dict;
  const piexifTyped = piexif as unknown as {
    ImageIFD: { Orientation: number; Make: string; Model: string };
    ExifIFD: { PixelXDimension: number; PixelYDimension: number; MakerNote: number };
    dump: (input: Record<string, unknown>) => string;
  };
  const exif: Record<number, unknown> = {
    [piexifTyped.ExifIFD.PixelXDimension]: 640,
    [piexifTyped.ExifIFD.PixelYDimension]: 480
  };
  if (padBytes > 0) exif[piexifTyped.ExifIFD.MakerNote] = "p".repeat(padBytes);
  return latin1ToBytes(
    piexifTyped.dump({
      "0th": {
        [piexifTyped.ImageIFD.Orientation]: orientation,
        [piexifTyped.ImageIFD.Make]: make,
        [piexifTyped.ImageIFD.Model]: model
      },
      Exif: exif,
      GPS: {},
      Interop: {},
      "1st": {},
      thumbnail: null
    })
  );
};

/** 给 payload 套上 0xFFE1 标志 + 2 字节大端长度字段,得到可直接嵌入的 APP1 段。 */
export const buildApp1Segment = (payload: Uint8Array): Uint8Array => {
  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = ((payload.length + 2) >>> 8) & 0xff;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);
  return segment;
};

const APP0_JFIF = new Uint8Array([
  0xff,
  0xe0,
  0x00,
  0x10, // 段长 16
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00,
  0x01,
  0x02,
  0x00,
  0x00,
  0x40,
  0x00,
  0x40,
  0x00,
  0x00
]);
// 段长度字段 = payload 字节数 + 2(含字段自身),必须与实写字节严格一致,否则段遍历会错位。
const DQT = new Uint8Array([0xff, 0xdb, 0x00, 0x06, 0x00, 0x01, 0x02, 0x03]);
const SOF0 = new Uint8Array([0xff, 0xc0, 0x00, 0x09, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01]);
const SOS_HEAD = new Uint8Array([0xff, 0xda, 0x00, 0x06, 0x04, 0x00, 0x02, 0x00]);
const FAKE_SCAN = new Uint8Array([0x11, 0x22, 0x33, 0xff, 0x44, 0x55]);
const EOI = new Uint8Array([0xff, 0xd9]);

/** PNG 魔数头,用于「非 JPEG」用例。 */
export const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d
]);

export interface BuildJpegOptions {
  /** 嵌入的 APP1 段;缺省不嵌 */
  app1Segment?: Uint8Array;
  /** 在 APP1 之后再塞一个注释段,把 SOS 推远一点,验证按段遍历而非搜索字节 */
  withComment?: boolean;
}

/** 拼出「按段合法」的 JPEG 字节。SOS 之后是伪扫描数据(含假 0xFF 标志)。 */
// 返回值要能直接进 `new Blob([...])`:标注成裸 `Uint8Array` 会被放宽成
// `Uint8Array<ArrayBufferLike>`,而 TS 5.9 的 `BlobPart` 只接受 `ArrayBuffer`  backed 视图。
export const buildJpegBytes = (options: BuildJpegOptions = {}): Uint8Array<ArrayBuffer> => {
  const { app1Segment, withComment = false } = options;
  const comment = new Uint8Array([0xff, 0xfe, 0x00, 0x07, 0x41, 0x42, 0xff, 0xe1, 0x43]); // 注释内容里故意放一串 0xFFE1
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8]), APP0_JFIF];
  if (app1Segment) parts.push(app1Segment);
  if (withComment) parts.push(comment);
  parts.push(DQT, SOF0, SOS_HEAD, FAKE_SCAN, EOI);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

export const buildJpegBlob = (options: BuildJpegOptions = {}): Blob =>
  new Blob([buildJpegBytes(options)], { type: "image/jpeg" });

/**
 * 带缩略图的 EXIF payload:piexif.dump 会校验 thumbnail 是合法 JPEG 段结构并重建 "1st" IFD,
 * 我们的合成 JPEG 恰好满足(它只遍历段标志)。buildExifApp1 走 load/dump 往返必须原样保留它。
 */
export const buildExifPayloadWithThumbnail = (): Uint8Array => {
  const piexifTyped = piexif as unknown as {
    ImageIFD: { Orientation: number; Make: string };
    ExifIFD: { PixelXDimension: number };
    dump: (input: Record<string, unknown>) => string;
  };
  const thumbnail = Array.from(buildJpegBytes(), (byte) => String.fromCharCode(byte)).join("");
  return latin1ToBytes(
    piexifTyped.dump({
      "0th": {
        [piexifTyped.ImageIFD.Orientation]: 5,
        [piexifTyped.ImageIFD.Make]: "ThumbCam"
      },
      Exif: { [piexifTyped.ExifIFD.PixelXDimension]: 320 },
      GPS: {},
      Interop: {},
      "1st": {},
      thumbnail
    })
  );
};

/** 在字节数组里找第一个 `markerLow` 标志(前面必须是段边界形状),测试断言用。 */
export const findAllMarkerOffsets = (bytes: Uint8Array, markerHigh = 0xe1): number[] => {
  const offsets: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === markerHigh) offsets.push(i);
  }
  return offsets;
};
