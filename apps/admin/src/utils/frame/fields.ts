import type { ExtractPhotoExif, FrameFields, FrameFieldsFromExif, PhotoExif } from "./types";

/**
 * EXIF 提取与相框文案映射(阶段 4)。
 *
 * extractPhotoExif 用 exifr 解析原始文件(动态 import,约 30KB 只在需要时进 bundle);
 * 解析失败一律返回 `{}` —— 契约里 PhotoExif 字段全可选,绘制端保证无文字就不画,
 * 绝不能像旧实现那样把错误信息塞进字段画进用户照片。
 */

type RawExif = Record<string, unknown>;

/** 字段清单照抄参考实现的 pick 口径。 */
const EXIF_PICK_FIELDS = [
  "Make",
  "Model",
  "LensModel",
  "Lens",
  "ISO",
  "FNumber",
  "ApertureValue",
  "ExposureTime",
  "ShutterSpeedValue",
  "FocalLength",
  "DateTimeOriginal",
  "CreateDate"
];

// ---------------------------------------------------------------- 原始值归一

/**
 * exifr 的数字字段形态不唯一(真实行为,非臆测):
 * - `number` 或字符串(如 "1/250" 之外的纯数字串);
 * - 有理数数组 `[numerator, denominator]`(TIFF RATIONAL 直出,如 [1, 250]);
 * - `{ numerator, denominator }` 对象形态;
 * - 长度为 1 的数组是 ISOSpeedRatings 这类 SHORT 数组(如 [100]),取首元素。
 * 吃不下时返回 undefined,由调用方留空。
 */
const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length === 1) return toNumber(value[0]);
    if (value.length === 2) {
      const denominator = toNumber(value[1]);
      const numerator = toNumber(value[0]);
      if (numerator === undefined || !denominator) return undefined;
      return numerator / denominator;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const denominator = toNumber(record.denominator);
    const numerator = toNumber(record.numerator);
    if (numerator !== undefined && denominator) return numerator / denominator;
  }
  return undefined;
};

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  return undefined;
};

/** 数值原样输出:整数不带小数(`2` 而非 `2.0`),小数保留一位。 */
const formatPlainNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

// ---------------------------------------------------------------- 文案格式化

/** `f/2.8` 形态;整数光圈不带小数点(`f/2` 而非 `f/2.0`)。 */
export const formatAperture = (value: number | undefined): string | undefined =>
  value === undefined ? undefined : `f/${formatPlainNumber(value)}`;

/** 快门:小于 1 秒写分母取整的 `1/250s`,≥1 秒写 `2s` / `1.3s`。 */
export const formatShutter = (seconds: number | undefined): string | undefined => {
  if (seconds === undefined || seconds <= 0) return undefined;
  if (seconds >= 1) return `${formatPlainNumber(seconds)}s`;
  return `1/${Math.round(1 / seconds)}s`;
};

/** 焦距:`35mm` 形态。 */
export const formatFocalLength = (value: number | undefined): string | undefined =>
  value === undefined || value <= 0 ? undefined : `${formatPlainNumber(value)}mm`;

/** Date / ISO 串 / 时间戳统一为 ISO 字符串;无法解析的时间原样返回字符串(与参考实现一致)。 */
const toCapturedAt = (value: unknown): string | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : date.toISOString();
  }
  const timestamp = toNumber(value);
  if (timestamp !== undefined) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
};

const pickNumber = (raw: RawExif, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    const parsed = toNumber(raw[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

// ---------------------------------------------------------------- 契约实现

/** 动态 import exifr(约 30KB,只有真的要读 EXIF 时才进 bundle);任何异常降级为空对象。 */
export const extractPhotoExif: ExtractPhotoExif = async (file) => {
  try {
    const exifr = await import("exifr");
    const raw = ((await exifr.parse(file, { pick: EXIF_PICK_FIELDS })) ?? {}) as RawExif;
    return {
      cameraMake: toTrimmedString(raw.Make),
      cameraModel: toTrimmedString(raw.Model),
      lens: toTrimmedString(raw.LensModel ?? raw.Lens),
      iso: pickNumber(raw, ["ISO"]),
      aperture: formatAperture(pickNumber(raw, ["FNumber", "ApertureValue"])),
      shutter: formatShutter(pickNumber(raw, ["ExposureTime", "ShutterSpeedValue"])),
      focalLength: formatFocalLength(pickNumber(raw, ["FocalLength"])),
      capturedAt: toCapturedAt(raw.DateTimeOriginal ?? raw.CreateDate)
    };
  } catch {
    return {};
  }
};

/**
 * EXIF → 相框文字字段。
 * exposure 行口径:`光圈  快门  ISO100`(两个空格分隔,与参考实现 frameFieldsFromExif 对齐,
 * ISO 前缀不带空格以适配信息条宽度)。model 与 lens 同框时长时会被绘制端 fitText 截断,属预期。
 */
export const frameFieldsFromExif: FrameFieldsFromExif = (exif?: PhotoExif): FrameFields => {
  if (!exif) return {};
  const exposure = [exif.aperture, exif.shutter, exif.iso ? `ISO${exif.iso}` : undefined]
    .filter(Boolean)
    .join("  ");
  return {
    brand: exif.cameraMake?.trim() || undefined,
    model: exif.cameraModel?.trim() || undefined,
    lens: exif.lens?.trim() || undefined,
    focalLength: exif.focalLength?.trim() || undefined,
    exposure: exposure || undefined
  };
};
