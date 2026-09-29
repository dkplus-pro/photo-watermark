/**
 * 压缩产物的格式决策(压缩功能的唯一策略口径)。
 *
 * 为什么单独成文件且全部纯函数:输出格式是压缩链路里唯一「选错就毁产物」的决策——
 * PNG 透明被 JPEG 吃掉、WebP 在 Safari 编不出却被当成功,都属于静默错误。把决策集中到
 * 纯函数层,批处理(compress-batch)只负责执行,单测可以穷举矩阵钉住每一条分支。
 *
 * 依赖纪律:零 import(node 单测直接跑),不碰 Blob/canvas——探测与编码都不在这里。
 */

/** 输出格式模式:智能(默认)/ 保持原格式 / 强制 WebP / 强制 JPEG。 */
export type CompressOutputMode = "smart" | "original" | "webp" | "jpeg";

export const COMPRESS_MODES: readonly CompressOutputMode[] = ["smart", "original", "webp", "jpeg"];

export const DEFAULT_COMPRESS_MODE: CompressOutputMode = "smart";

/** 三个可编码目标 MIME(画布编码不出 GIF/AVIF,只在这三个里选)。 */
export type OutputMime = "image/jpeg" | "image/png" | "image/webp";

/** 输入容器类别:mime 判不出的按扩展名兜底,再不行归入 other。 */
export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "other";

/** 扩展名 → 类别的映射(不含点,小写)。 */
const KIND_BY_EXTENSION: Readonly<Record<string, ImageKind>> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  gif: "gif"
};

const KIND_BY_MIME: Readonly<Record<string, ImageKind>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

/**
 * 输入类别判定。`File.type` 在拖拽/部分系统下可能为空串,所以 mime 优先、扩展名兜底
 * (与 store/export 的受理口径同一理由);两者都认不出 → other(按「可能有透明」保守处理)。
 */
export const imageKindOf = (mime: string, fileName: string): ImageKind => {
  const byMime = KIND_BY_MIME[mime];
  if (byMime) return byMime;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "other";
  return KIND_BY_EXTENSION[fileName.slice(dotIndex + 1).toLowerCase()] ?? "other";
};

// ---------------------------------------------------------------- 头部透明探测

/** PNG IHDR 的 color type 在签名的第 25 字节:4(灰度+透明)与 6(RGBA)带 alpha 通道。 */
const PNG_COLOR_TYPE_OFFSET = 25;

/** WebP 扩展格式 VP8X 的 alpha 标志位(第 6 位,0x10)。 */
const WEBP_VP8X_ALPHA_FLAG = 0x1 << 4;

/**
 * 从头部字节判断「这张图是否可能带透明」。
 *
 * 返回值的语义是**保守**的:宁可误报「有透明」(多走 WebP/PNG 保住透明),也不允许把一张
 * 透明图压成黑底 JPEG——所以判定不出来时一律返回 true。只有 JPEG 能确定地返回 false。
 *
 * - PNG:签名校验后读 IHDR color type;头部被截断/不是 PNG → true(不猜)。
 * - WebP:VP8X 读 alpha 标志位;VP8 有损必然无 alpha;VP8L 读 alpha_is_used 位;认不出 → true。
 * - GIF:透明色是帧级属性,头部判不出来 → true。
 * - other(AVIF/HEIC 等):可能带 alpha → true。
 */
export const detectAlphaFromHead = (head: Uint8Array | null, kind: ImageKind): boolean => {
  if (kind === "jpeg") return false;
  if (!head) return true;
  if (kind === "png") {
    if (head.length <= PNG_COLOR_TYPE_OFFSET) return true;
    if (head[0] !== 0x89) return true;
    return head[PNG_COLOR_TYPE_OFFSET] === 4 || head[PNG_COLOR_TYPE_OFFSET] === 6;
  }
  if (kind === "webp") return detectWebpAlpha(head);
  return true;
};

/** WebP 的透明判定:RIFF/WEBP 签名 + 逐 chunk 找 VP8X 标志位;简单 VP8(有损)恒无 alpha。 */
const detectWebpAlpha = (head: Uint8Array): boolean => {
  if (head.length < 20) return true;
  if (head[0] !== 0x52 || head[8] !== 0x57) return true; // "R" / "W"
  // 第一个 chunk 从 12 开始;VP8X:四字 CC(12..15)+ 长度(16..19)+ 标志(20)
  const firstChunk = String.fromCharCode(head[12], head[13], head[14], head[15]);
  if (firstChunk === "VP8X")
    return head.length <= 20 ? true : (head[20] & WEBP_VP8X_ALPHA_FLAG) !== 0;
  if (firstChunk === "VP8 ") return false;
  if (firstChunk === "VP8L") {
    // VP8L:签名 0x2F + 4 字节小端(宽 14 位 | 高 14 位 | alpha_is_used 1 位 | 版本 3 位)
    if (head.length < 21 || head[20] !== 0x2f) return true;
    const bits = head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24);
    return ((bits >>> 28) & 1) === 1;
  }
  return true;
};

// ---------------------------------------------------------------- 输出 MIME 决策

export interface OutputMimeDecision {
  readonly kind: ImageKind;
  readonly mode: CompressOutputMode;
  readonly hasAlpha: boolean;
  /** 当前浏览器画布能否编码 WebP(运行时探测,Safari 长期为否)。 */
  readonly webpSupported: boolean;
}

/** WebP 编不出的环境里,带透明退 PNG、不透明退 JPEG:保透明优先于保体积。 */
const alphaAwareFallback = (hasAlpha: boolean): OutputMime =>
  hasAlpha ? "image/png" : "image/jpeg";

/**
 * 一张图的输出 MIME。
 *
 * - smart:JPEG 保持 JPEG;其余(含 other)→ WebP,编不出 → 按透明退 PNG/JPEG。
 *   PNG 重编码为画布 PNG 几乎省不出体积(编码器无量化),所以「不指定格式」时不做
 *   PNG→PNG 这种无收益转换,统一走 WebP。
 * - original:jpeg/png/webp 三种可编码格式保持原样;gif/other 浏览器编不出,按 smart 口径。
 * - webp / jpeg:显式指定。jpeg 会把透明垫白底(flatten 由调用方按 hasAlpha 决定)。
 */
export const resolveOutputMime = (decision: OutputMimeDecision): OutputMime => {
  const { kind, mode, hasAlpha, webpSupported } = decision;
  if (mode === "jpeg") return "image/jpeg";
  if (mode === "webp") return webpSupported ? "image/webp" : alphaAwareFallback(hasAlpha);
  // smart 口径(也是 original 遇到编不出格式的回落口径):JPEG 保持 JPEG,其余转 WebP。
  if (kind === "jpeg") return "image/jpeg";
  if (mode === "original" && kind === "png") return "image/png";
  if (mode === "original" && kind === "webp" && webpSupported) return "image/webp";
  return webpSupported ? "image/webp" : alphaAwareFallback(hasAlpha);
};

/** MIME → 落盘扩展名(产物命名唯一口径;jpg 不写 .jpeg,与常见工具一致)。 */
export const extensionOfMime = (mime: string): string => {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
};

/**
 * 输出 JPEG 且源图可能带透明时必须垫白底(canvas 编码 JPEG 会把 alpha 合成到黑上)。
 * WebP/PNG 原生支持 alpha,不垫。
 */
export const needsAlphaFlatten = (mime: string, hasAlpha: boolean): boolean =>
  mime === "image/jpeg" && hasAlpha;

// ---------------------------------------------------------------- 体积与质量

/** 质量滑杆的取值区间(百分比整数);越界一律拒收,与 logoSize 滑杆同一守卫口径。 */
export const QUALITY_MIN = 50;
export const QUALITY_MAX = 95;
export const DEFAULT_QUALITY = 80;

export const isQualityPercent = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= QUALITY_MIN && (value as number) <= QUALITY_MAX;

export const isCompressMode = (value: unknown): value is CompressOutputMode =>
  typeof value === "string" && (COMPRESS_MODES as readonly string[]).includes(value);

/** 滑杆百分比 → 编码质量(0..1);非法值收敛到默认档,不抛错(展示参数不配拥有异常路径)。 */
export const qualityOfPercent = (percent: number): number => {
  const clamped = isQualityPercent(percent) ? percent : DEFAULT_QUALITY;
  return clamped / 100;
};

/**
 * 压缩节省的百分比(正数=变小)。原始体积非正数时返回 null——「0 字节原图省了 100%」
 * 这种句子没有意义,调用方按「未知」处理。
 */
export const savingsPercentOf = (originalBytes: number, compressedBytes: number): number | null => {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(compressedBytes)) return null;
  if (originalBytes <= 0) return null;
  return (1 - compressedBytes / originalBytes) * 100;
};

/**
 * 列表里「节省」一栏的展示口径:正数 `-62%`;四舍五入后无收益(含变大、不足 1%)给中性
 * 「未减小」——「-0%」这种句子比不显示更让人困惑。
 */
export const savingsLabelOf = (originalBytes: number, compressedBytes: number): string | null => {
  const percent = savingsPercentOf(originalBytes, compressedBytes);
  if (percent === null) return null;
  const rounded = Math.round(percent);
  if (rounded <= 0) return "未减小";
  return `-${String(rounded)}%`;
};
