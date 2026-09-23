/**
 * 合成图片容器夹具(阶段 10 的尺寸探测用)。
 *
 * 与 `build-jpeg.ts` 同一思路:不提交二进制图,而是**按段/chunk 结构拼字节**。
 * 探测器的全部依赖就是这些数字的偏移与长度,所以合法形状足够,真实压缩数据不需要。
 * 刻意不复用 `build-jpeg.ts` 的 SOF:它的宽高写死 8×8,而「方向交换后宽高必须不等」是硬要求。
 */

/** 5 字节 JFIF 风格 APP0:段长字段(3)= 长度字段自身 2 字节 + 1 字节载荷,段遍历靠它才不错位。 */
const APP0 = new Uint8Array([0xff, 0xe0, 0x00, 0x03, 0x00]);

export interface BuildJpegHeadOptions {
  /** SOF 标志低字节:0xc0 基线 / 0xc1 增量离散余弦 / 0xc2 无损,三者都要能读 */
  readonly sofMarker?: number;
  /** 插在 SOI 与 SOF 之间的 APP1 段(方向信息从这里读) */
  readonly app1?: Uint8Array;
}

/** 拼出「SOF 可被头部解析器读到」的 JPEG 前段。 */
export const buildJpegHead = (
  width: number,
  height: number,
  options: BuildJpegHeadOptions = {}
): Uint8Array<ArrayBuffer> => {
  // SOFn:标志(2) 段长(2) 精度(1) 高(2) 宽(2) 分量数(1) 首个分量 id(1)
  const sof = new Uint8Array([
    0xff,
    options.sofMarker ?? 0xc0,
    0x00,
    0x09,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01
  ]);
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x03, 0x00]);
  const eoi = new Uint8Array([0xff, 0xd9]);
  const parts = [
    new Uint8Array([0xff, 0xd8]),
    APP0,
    ...(options.app1 ? [options.app1] : []),
    sof,
    sos,
    eoi
  ];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

/**
 * 只含 Orientation 一个 tag 的最小 APP1(自带 "Exif\0\0" 前缀与段长字段)。
 * 大小端各拼一遍,用来证明 TIFF 解析没把字节序写死。
 */
export const buildOrientationApp1 = (orientation: number, littleEndian = true): Uint8Array => {
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const tiffLength = 8 + 2 + 12 + 4; // 头 + 条目数 + 一个条目 + 下一 IFD 指针
  const payload = new Uint8Array(exifHeader.length + tiffLength);
  payload.set(exifHeader, 0);
  payload.set(
    littleEndian ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a],
    exifHeader.length
  );
  const view = new DataView(payload.buffer);
  const tiff = exifHeader.length;
  view.setUint32(tiff + 4, 8, littleEndian); // IFD0 相对 TIFF 起点的偏移
  const ifd = tiff + 8;
  view.setUint16(ifd, 1, littleEndian); // 条目数
  view.setUint16(ifd + 2, 0x0112, littleEndian); // tag = Orientation
  view.setUint16(ifd + 4, 3, littleEndian); // type = SHORT
  view.setUint32(ifd + 6, 1, littleEndian); // count
  view.setUint16(ifd + 10, orientation, littleEndian); // 值落在 4 字节字段的前两字节
  view.setUint32(ifd + 14, 0, littleEndian); // 无下一个 IFD
  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = ((payload.length + 2) >> 8) & 0xff;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);
  return segment;
};

/** PNG:签名(8) + 长度(4) + "IHDR"(4) + 宽(4) + 高(4)。 */
export const buildPngHead = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

/** RIFF chunk:fourcc + 4 字节小端长度 + 载荷 + 偶数对齐填充。 */
export const buildRiffChunk = (fourcc: string, data: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(8 + data.length + (data.length % 2));
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 4; index += 1) bytes[index] = fourcc.charCodeAt(index);
  view.setUint32(4, data.length, true);
  bytes.set(data, 8);
  return bytes;
};

/** RIFF/WEBP 容器:把若干 chunk 依次塞进去。 */
export const buildWebpHead = (chunks: readonly Uint8Array[]): Uint8Array => {
  const inner = new Uint8Array(12 + chunks.reduce((sum, part) => sum + part.length, 0));
  const view = new DataView(inner.buffer);
  inner.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, inner.length - 8, true);
  inner.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  let offset = 12;
  for (const part of chunks) {
    inner.set(part, offset);
    offset += part.length;
  }
  return inner;
};

/** 扩展格式 VP8X:标志(4) + 宽−1(3) + 高−1(3)。 */
export const buildWebpExtended = (width: number, height: number): Uint8Array => {
  const data = new Uint8Array(10);
  data[4] = (width - 1) & 0xff;
  data[5] = ((width - 1) >> 8) & 0xff;
  data[6] = ((width - 1) >> 16) & 0xff;
  data[7] = (height - 1) & 0xff;
  data[8] = ((height - 1) >> 8) & 0xff;
  data[9] = ((height - 1) >> 16) & 0xff;
  return buildRiffChunk("VP8X", data);
};

/** 有损 VP8:帧标签(3) + 起始码 9D 01 2A + 宽(2,低 14 位) + 高(2,低 14 位)。 */
export const buildWebpLossy = (width: number, height: number): Uint8Array => {
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);
  data[0] = 0x30; // 帧标签,内容对尺寸无影响
  data.set([0x9d, 0x01, 0x2a], 3);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return buildRiffChunk("VP8 ", data);
};

/** 无损 VP8L:签名 0x2F + 一个 32 位里前 14 位宽−1、接着 14 位高−1。 */
export const buildWebpLossless = (width: number, height: number): Uint8Array => {
  const data = new Uint8Array(6);
  const view = new DataView(data.buffer);
  data[0] = 0x2f;
  view.setUint32(1, (width - 1) | ((height - 1) << 14), true);
  return buildRiffChunk("VP8L", data);
};
