import piexifRaw from "piexifjs";

import { EXIF_HEAD_BYTES } from "./types";
import type { BuildExifApp1, ReadHeadBytes, SpliceExifIntoJpeg } from "./types";

/**
 * EXIF 读取与继承(D8)。
 *
 * 参考实现把整个 JPEG latin1 字符串化后交给 piexif.insert,10MB 图峰值内存放大约 4-6 倍;
 * 本模块的原则是 piexif 只碰「文件头 256KB 里的 APP1 段 payload」,图像字节始终留在
 * Blob 内,拼接用 `new Blob([slice, app1, slice])` 完成——Blob.parts 只持有引用,不进 JS 内存。
 * 全链路任何异常都降级为「不注入 EXIF」:EXIF 丢失绝不能让导出失败。
 */

// ---------------------------------------------------------------- piexif 局部收窄

/**
 * piexifjs 的 dict 形状(@types 里各 IFD 值是 any、thumbnail 漏了 null,不可直接用);
 * 只在解析 head 时消费,故在本文件内收窄,不污染 types.ts 冻结契约。
 */
interface PiexifDict {
  "0th"?: Record<number, unknown>;
  "1st"?: Record<number, unknown>;
  Exif?: Record<number, unknown>;
  GPS?: Record<number, unknown>;
  Interop?: Record<number, unknown>;
  thumbnail?: string | null;
}

interface PiexifLike {
  readonly ImageIFD: { readonly Orientation: number };
  readonly ExifIFD: { readonly PixelXDimension: number; readonly PixelYDimension: number };
  load: (exifPayloadLatin1: string) => PiexifDict;
  dump: (dict: PiexifDict) => string;
}

const piexif = piexifRaw as unknown as PiexifLike;

// ---------------------------------------------------------------- JPEG 段常量

const MARKER_PREFIX = 0xff;
const MARKER_SOS = 0xda; // 0xFFDA,扫描数据开始,之后再找段标志会撞上压缩数据里的假标志
const MARKER_APP1 = 0xe1; // 0xFFE1
const SOI_HIGH = 0xff;
const SOI_LOW = 0xd8;

/** APP1 段标志(2 字节) + 段长度字段(2 字节),长度字段的值 = payload 字节数 + 2。 */
const APP1_FRAME_OVERHEAD = 4;

/**
 * splice 时扫描 jpeg 头部的窗口:canvas 编码产物的段表只有几百字节,
 * 真实相机图的 SOS 也紧跟在段表之后(通常 <10KB),64KB 覆盖两个场景绰绰有余。
 */
const HEAD_SCAN_BYTES = 64 * 1024;

// ---------------------------------------------------------------- 段遍历

interface App1Location {
  /** 0xFFE1 标志的字节偏移 */
  readonly start: number;
  /** payload 结束后的下一个字节偏移(= start + 2 + 段长度字段值) */
  readonly end: number;
  /** 仅 payload 字节(含 `Exif\0\0` 前缀) */
  readonly payload: Uint8Array;
}

interface HeadScanResult {
  /** 第一个 0xFFDA(SOS)标志的偏移;找不到则为 null(降级信号) */
  readonly sosOffset: number | null;
  /** 第一个以 `Exif\0\0` 开头的 APP1 段;无则 undefined */
  readonly app1?: App1Location;
}

/** latin1 化:每字节一字符,只在 ≤256KB 的 head/payload 上使用,这是 piexifjs 的入参形状。 */
const bytesToLatin1 = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
};

/** 逐字节写入预分配 Uint8Array。禁用 Array.from 中间数组——dump 串最长不过 64KB,但原则同 D8。 */
const latin1ToBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

const readUint16BE = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] << 8) | bytes[offset + 1];

const startsWithExif = (bytes: Uint8Array, payloadOffset: number): boolean =>
  bytes[payloadOffset] === 0x45 &&
  bytes[payloadOffset + 1] === 0x78 &&
  bytes[payloadOffset + 2] === 0x69 &&
  bytes[payloadOffset + 3] === 0x66; // "Exif"

/**
 * 按 JPEG 段结构遍历 head(不搜索字节序列——压缩数据里到处是假的 0xFFxx)。
 * sosStopAt 之前停止找 APP1:SOS 之后属于扫描数据,里面的 "Exif" 巧合不是段。
 */
const scanHeadSegments = (head: Uint8Array): HeadScanResult => {
  if (head.length < 2 || head[0] !== SOI_HIGH || head[1] !== SOI_LOW) {
    return { sosOffset: null };
  }
  let offset = 2;
  let app1: App1Location | undefined;
  while (offset + 4 <= head.length) {
    if (head[offset] !== MARKER_PREFIX) break;
    const marker = head[offset + 1];
    if (marker === MARKER_SOS) return { sosOffset: offset, app1 };
    // 填充字节 0xFF/0x00、独立标志(0x01、D0-D7 重启标记、D8/D9)无长度字段,直接前进 2 字节。
    // 刻意用闭区间:D0 以上的 E0-EF(APP 段)有长度字段,必须落到下面的遍历分支。
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xff ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      offset += 2;
      continue;
    }
    const segmentLength = readUint16BE(head, offset + 2);
    const end = offset + 2 + segmentLength;
    if (segmentLength < 2 || end > head.length) break;
    if (!app1 && marker === MARKER_APP1 && startsWithExif(head, offset + 4)) {
      app1 = { start: offset, end, payload: head.slice(offset + 4, end) };
    }
    offset = end;
  }
  return { sosOffset: null, app1 };
};

// ---------------------------------------------------------------- readHeadBytes

/**
 * 只取文件头 EXIF_HEAD_BYTES(256KB):`file.slice(0, N).arrayBuffer()`,
 * 整个 Blob 不进内存(slice 返回引用,底层字节由浏览器管理)。
 * 空文件、读取失败、非 JPEG(SOG 校验不过,如 PNG/WebP 转来的)一律返回 null。
 */
export const readHeadBytes: ReadHeadBytes = async (file) => {
  try {
    if (!file || file.size === 0) return null;
    const buffer = await file.slice(0, EXIF_HEAD_BYTES).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 2 || bytes[0] !== SOI_HIGH || bytes[1] !== SOI_LOW) return null;
    return bytes;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- buildExifApp1

const isDictEmpty = (dict: PiexifDict): boolean =>
  !dict.thumbnail &&
  ["0th", "1st", "Exif", "GPS", "Interop"].every(
    (key) => Object.keys((dict as Record<string, object>)[key] ?? {}).length === 0
  );

/** 输出尺寸写入 EXIF 前夹到 [0, 2^32-1] 的整数;非有限值(如 2^53 溢出)返回 null 表示跳过。 */
const clampDimension = (value: number): number | null => {
  if (!Number.isFinite(value)) return null;
  const int = Math.trunc(value);
  if (int < 0) return 0;
  return Math.min(int, 0xffffffff);
};

/**
 * 以源图 head 里的 APP1 为底,产出可直接拼接的完整 APP1 段(含 0xFFE1 标志与长度字段)。
 *
 * 修正两处:
 * 1. Orientation→1——像素已在解码期按原 Orientation 转正,原样保留会让查看器再旋转一次;
 * 2. PixelX/YDimension 同步为实际输出尺寸(源图记录的是原尺寸,与产物对不上)。
 *
 * 原 head 含缩略图("1st" IFD + thumbnail)时,load/dump 往返原样保留(完整继承是硬要求)。
 * EXIF 段规范上装不下 >64KB 的 payload(长度字段仅 16 位),超限时降级返回 null,
 * 宁可不注入也不产出长度自相矛盾的损坏文件。
 */
export const buildExifApp1: BuildExifApp1 = (head, width, height) => {
  if (!head) return null;
  try {
    const { app1 } = scanHeadSegments(head);
    if (!app1) return null;
    // piexif.load 接受以 "Exif\0\0" 开头的 payload 字符串——这里 latin1 化的最多 256KB,可接受。
    const dict = piexif.load(bytesToLatin1(app1.payload));
    if (isDictEmpty(dict)) return null;

    const zeroth = dict["0th"] ?? {};
    zeroth[piexif.ImageIFD.Orientation] = 1;
    dict["0th"] = zeroth;
    if (dict.Exif) {
      const pixelX = clampDimension(width);
      const pixelY = clampDimension(height);
      if (pixelX !== null) dict.Exif[piexif.ExifIFD.PixelXDimension] = pixelX;
      if (pixelY !== null) dict.Exif[piexif.ExifIFD.PixelYDimension] = pixelY;
    }

    const payload = latin1ToBytes(piexif.dump(dict));
    if (payload.length + 2 > 0xffff) return null;

    const segment = new Uint8Array(APP1_FRAME_OVERHEAD + payload.length);
    segment[0] = MARKER_PREFIX;
    segment[1] = MARKER_APP1;
    segment[2] = ((payload.length + 2) >>> 8) & 0xff;
    segment[3] = (payload.length + 2) & 0xff;
    segment.set(payload, APP1_FRAME_OVERHEAD);
    return segment;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- spliceExifIntoJpeg

/**
 * 零拷贝拼接:在 SOS 前插入 app1,并剔除 SOS 前已存在的 APP1
 * (源图直传场景下可能出现两个 APP1,多数查看器只读第一个,重复会让尺寸修正失效)。
 *
 * 只 `jpeg.slice(0, HEAD_SCAN_BYTES)` 读头部定位段偏移;前段/后段用 `jpeg.slice(...)`
 * 引用原 Blob 字节,从不 arrayBuffer 整个文件。任何异常(过小/无 SOS/构造失败)都
 * 返回原 jpeg——降级不抛错。
 */
export const spliceExifIntoJpeg: SpliceExifIntoJpeg = async (jpeg, app1) => {
  if (!app1) return jpeg;
  try {
    const head = new Uint8Array(await jpeg.slice(0, HEAD_SCAN_BYTES).arrayBuffer());
    const { sosOffset, app1: existing } = scanHeadSegments(head);
    if (sosOffset === null) return jpeg;

    const parts: BlobPart[] = [];
    if (existing) {
      parts.push(jpeg.slice(0, existing.start), jpeg.slice(existing.end, sosOffset));
    } else {
      parts.push(jpeg.slice(0, sosOffset));
    }
    // new Uint8Array(...) 复制 app1(≤64KB,可忽略):TS 5.7+ 的 BlobPart 只接受
    // Uint8Array<ArrayBuffer>,而契约入参是 ArrayBufferLike 泛型,拷贝顺带完成收窄。
    parts.push(new Uint8Array(app1), jpeg.slice(sosOffset));
    return new Blob(parts, { type: "image/jpeg" });
  } catch {
    return jpeg;
  }
};
