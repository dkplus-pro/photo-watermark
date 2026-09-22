import { decodeImageScaled } from "./render-core";
import type { OutputSize } from "./types";

/**
 * 源图尺寸探测(阶段 10,导出流水线的前置依赖)。
 *
 * 为什么必须有「不解码的尺寸探测」:输出档位要先算 `resolveOutputSize(源宽, 源高, …)`,
 * 而拿到源宽高的常规手段是解码一次——那正是决策 D20 要避免的动作(24MP 源图 = 约 96MB 的
 * RGBA 位图,移动端直接被系统杀页)。尺寸因此必须**从文件头段的数字里读**,不从位图里读。
 *
 * 支持的容器:SOF0/SOF1/SOF2 三种基线 JPEG 段、PNG 的 IHDR、WebP 的 VP8X/VP8 /VP8L。
 * 只有全部解析失败(HEIC/AVIF 等我们没有段解析器的容器、段被截断、非图片)才走
 * `probeByFullDecode` 这条 Rare path:全尺寸解一次、立刻 `close()`、渲染时再按目标尺寸解**第二次**。
 * 双解码的代价就是那份约 96MB 的临时位图,所以触发条件必须窄,且由用例锁住
 * (tests/utils/frame/export-pipeline.test.ts 的「探测失败走二次解码」)。
 *
 * 依赖纪律:本文件不 import store/routes/hooks/react/arco,唯一外部依赖是 render-core 的解码器,
 * 纯字节解析部分(`probeSizeFromHead`)可以在 node 里直接喂合成数据测。
 */

/**
 * 探测用的头部读取量。
 * 真实照片的 SOF 段紧跟在 APP0/APP1(含缩略图,可到几十 KB)之后,64KB 覆盖得住;
 * 再大就是在为「段表异常长」的畸形文件买单,而那种文件本来就该走 Rare path。
 */
export const IMAGE_HEAD_PROBE_BYTES = 64 * 1024;

/** EXIF TIFF 里 Orientation 的 tag 号(0th IFD)。 */
const TAG_ORIENTATION = 0x0112;

/** TIFF SHORT 类型号:Orientation 一定是 SHORT(3),其它类型按「读不到」处理。 */
const TIFF_TYPE_SHORT = 3;

/**
 * 1/5/6/8 这四种方向要交换宽高:它们表示「像素行被旋转 90°/270° 存放」。
 * `createImageBitmap` 默认按 from-image 转正,位图尺寸已经是转正后的口径,
 * 所以头部解析出的裸尺寸必须做同样的交换,两者才会一致——否则「按位图尺寸算档位」
 * 与「按头部尺寸算档位」会给出不同的输出,预览与成品尺寸就对不上。
 */
const rotatesDimensions = (orientation: number): boolean =>
  orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;

const positiveSize = (width: number, height: number): OutputSize | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;

const u16be = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] << 8) | bytes[offset + 1];

const u16le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] | (bytes[offset + 1] << 8);

const u32be = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x1000000 +
  ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);

const u32le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset + 3] * 0x1000000 +
  ((bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset]);

/** WebP 的 24 位小端画布字段存的是「实际值 − 1」。 */
const u24leMinusOne = (bytes: Uint8Array, offset: number): number =>
  1 + (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16));

const matchesAscii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
};

// ---------------------------------------------------------------- JPEG

/**
 * 从 APP1 的 TIFF 里读 Orientation。
 * 段偏移由调用方给出(tiffStart 指向 `Exif\0\0` 之后的 TIFF 头),任何越界一律返回 1(不旋转):
 * 方向读不出来时「按原样输出」比「猜一个旋转」更接近用户预期。
 */
const readTiffOrientation = (bytes: Uint8Array, tiffStart: number): number => {
  const little = matchesAscii(bytes, tiffStart, "II");
  if (!little && !matchesAscii(bytes, tiffStart, "MM")) return 1;
  const word = (offset: number): number => (little ? u16le(bytes, offset) : u16be(bytes, offset));
  const dword = (offset: number): number => (little ? u32le(bytes, offset) : u32be(bytes, offset));
  const ifdStart = tiffStart + dword(tiffStart + 4);
  const count = word(ifdStart);
  if (count <= 0 || count > 0xffff) return 1;
  for (let entry = 0; entry < count; entry += 1) {
    const at = ifdStart + 2 + entry * 12;
    if (at + 12 > bytes.length) return 1;
    if (word(at) !== TAG_ORIENTATION) continue;
    // Orientation 规范上是 SHORT,值直接放在 4 字节 value 字段的低两字节(无间接偏移)。
    if (word(at + 2) !== TIFF_TYPE_SHORT) return 1;
    const orientation = word(at + 8);
    return orientation >= 2 && orientation <= 8 ? orientation : 1;
  }
  return 1;
};

/** 是否为带长度字段的 SOF 段(排除同区间的 DHT 0xC4 / 保留 0xC8 / DAC 0xCC)。 */
const isStartOfFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * 按 JPEG 段结构走一遍头部:SOF0/SOF1/SOF2 给裸宽高,APP1(EXIF) 给 Orientation。
 * 刻意按段遍历而不是搜字节——压缩数据里到处是假的 0xFFxx 标志(与 exif.ts 同一口径;
 * 那边的段遍历是模块私有且只找 APP1,本模块要的是 SOF,不去改别人的文件)。
 * 找到 SOF 即可提前收工:SOF 之后紧接着就是 SOS,再往里是扫描数据,没有更多信息。
 */
const probeJpegSize = (bytes: Uint8Array): OutputSize | null => {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null; // SOS/EOI:SOF 已不可能出现
    const standalone =
      marker === 0x00 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd9);
    if (standalone) {
      offset += 2;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xe1 && matchesAscii(bytes, offset + 4, "Exif")) {
      orientation = readTiffOrientation(bytes, offset + 10);
    } else if (isStartOfFrameMarker(marker) && length >= 9) {
      // SOFn: 长度字段 | 精度(1) | 高(2) | 宽(2) | 分量数(1) | 分量表…
      const size = positiveSize(u16be(bytes, offset + 7), u16be(bytes, offset + 5));
      if (!size) return null;
      return rotatesDimensions(orientation) ? { width: size.height, height: size.width } : size;
    }
    offset = end;
  }
  return null;
};

// ---------------------------------------------------------------- PNG

/** PNG 的可读尺寸只在 IHDR 里:签名(8) + 长度(4) + "IHDR"(4) 之后是宽(4)高(4)。 */
const probePngSize = (bytes: Uint8Array): OutputSize | null => {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    !matchesAscii(bytes, 1, "PNG") ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    !matchesAscii(bytes, 12, "IHDR")
  ) {
    return null;
  }
  return positiveSize(u32be(bytes, 16), u32be(bytes, 20));
};

// ---------------------------------------------------------------- WebP

/** 有损 WebP 关键帧的 3 字节起始码 0x9D 0x01 0x2A(尺寸字段紧跟其后)。 */
const hasLossySyncCode = (bytes: Uint8Array, offset: number): boolean =>
  bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a;

/**
 * RIFF 容器逐 chunk 前进(每个 chunk 偶数对齐,长度字段记的是奇数时的实际字节数):
 * - `VP8X` 扩展格式:标志(4) + 宽−1(3) + 高−1(3)
 * - `VP8 ` 有损:帧标签(3) + 起始码 9D 01 2A + 宽(2,低 14 位) + 高(2,低 14 位)
 * - `VP8L` 无损:签名 0x2F + 4 字节里前 14 位是宽−1、接着 14 位是高−1
 */
const probeWebpSize = (bytes: Uint8Array): OutputSize | null => {
  if (bytes.length < 20 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const size = u32le(bytes, offset + 4);
    const data = offset + 8;
    if (size < 0 || data + size > bytes.length) return null;
    if (fourcc === "VP8X" && size >= 10) {
      return positiveSize(u24leMinusOne(bytes, data + 4), u24leMinusOne(bytes, data + 7));
    }
    if (fourcc === "VP8 " && size >= 10 && hasLossySyncCode(bytes, data + 3)) {
      return positiveSize(
        (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
        (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff
      );
    }
    if (fourcc === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = u32le(bytes, data + 1);
      return positiveSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    offset = data + size + (size % 2);
  }
  return null;
};

// ---------------------------------------------------------------- 对外口径

/**
 * 纯函数版尺寸探测:已读好的头部字节 → 转正后的显示尺寸;认不出来返回 **null**
 * (不返回 `{0,0}`——`resolveOutputSize` 已经用 0 表达「入参非法」,两种语义不能混)。
 *
 * GIF/BMP/AVIF/HEIC 等容器不在这里判定:它们要么浏览器根本解不了(交给渲染期失败列表,D7),
 * 要么由 Rare path 兜住。null 的语义是「这里读不出来」,不是「这张图没有尺寸」。
 */
export const probeSizeFromHead = (head: Uint8Array | null): OutputSize | null => {
  if (!head || head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8) return probeJpegSize(head);
  if (head[0] === 0x89) return probePngSize(head);
  return probeWebpSize(head);
};

/** 读探测用的头部;空文件与读取失败返回 null(交给 Rare path,不抛错)。 */
export const readProbeHeadBytes = async (file: Blob): Promise<Uint8Array | null> => {
  try {
    if (!file || file.size === 0) return null;
    return new Uint8Array(await file.slice(0, IMAGE_HEAD_PROBE_BYTES).arrayBuffer());
  } catch {
    // 读取失败不该让导出中断:返回值 null 会让上层改走 Rare path,再失败就是单张失败记录(D7)。
    return null;
  }
};

/**
 * Rare path:全尺寸解码只为拿尺寸,拿到就 `close()`。
 *
 * 代价明说:这一次解码会临时分配约「源像素 × 4B」的位图(24MP ≈ 96MB),而流水线随后渲染时
 * 还会按目标尺寸**再解一次**——也就是本应被 D20 消掉的那份内存被付出了两次。
 * 所以它只在头部解析与容器识别全部失败时才允许发生(HEIC/AVIF/段被截断/编码异常),
 * 且解码失败直接返回 null:这种文件在渲染期同样会失败,不在这里提前判死。
 */
const probeByFullDecode = async (file: Blob): Promise<OutputSize | null> => {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decodeImageScaled(file, null);
    return positiveSize(bitmap.width, bitmap.height);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};

/**
 * 一个文件的源图尺寸:`{@link probeSizeFromHead}` 优先,Rare path 兜底。
 * 阶段 13 的页面也用它把尺寸回写进 store(`ExportFileEntry.width/height`)。
 * 返回 null 表示探测失败,调用方按「未知尺寸」处理(流水线会退化成按源图输出)。
 */
export const probeSourceSize = async (file: Blob): Promise<OutputSize | null> => {
  const head = await readProbeHeadBytes(file);
  return probeSizeFromHead(head) ?? probeByFullDecode(file);
};
