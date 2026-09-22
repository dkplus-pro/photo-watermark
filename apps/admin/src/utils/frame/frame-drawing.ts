import { MONO_FONT_STACK, PRIMARY_FONT_STACK } from "./fonts";
import type { DrawFrameComposition, LogoRenderInput } from "./types";

/**
 * 「黑底相框」样式的绘制引擎(阶段 3)。
 *
 * 纯绘制函数:不 fetch、不建 Worker、不碰 window/document,只按传入的 2D 上下文与
 * 画布尺寸产出像素,供主线程预览与 Worker 的 OffscreenCanvas 共用同一份实现。
 * 画布坐标系即输出尺寸,原图像素已在解码期转正,故此处不再处理 EXIF Orientation。
 *
 * 几何全部为纯比例(D4):每个量都由画布宽/高乘系数导出,不设任何视觉上下限,
 * 因此 300×400 的缩略图与 6000×8000 的原图观感一致。唯一例外是分隔线线宽,
 * 见 FRAME_GEOMETRY.dividerLineWidth。
 */

/** 画布配色(沿用参考实现),供单测断言与后续样式复用。 */
export interface FramePalette {
  readonly background: string;
  readonly strip: string;
  readonly stripFade: string;
  readonly text: string;
  readonly muted: string;
  readonly logoBackground: string;
  readonly logoText: string;
}

export const FRAME_PALETTE: FramePalette = {
  background: "#09090b",
  strip: "rgba(9, 9, 11, 0.9)",
  stripFade: "rgba(9, 9, 11, 0)",
  text: "#fafafa",
  muted: "rgba(250, 250, 250, 0.78)",
  logoBackground: "#fafafa",
  logoText: "#09090b"
};

/** 比例系数表:除 dividerLineWidth 外一律 `画布宽/高 × 系数`,不设极值。 */
export const FRAME_GEOMETRY = {
  /** 信息条高度 = 画布高 × 0.2 */
  stripHeight: 0.2,
  /** 左右内边距 = 画布宽 × 0.036 */
  paddingX: 0.036,
  /** logo 高度 = 信息条高 × 0.45 */
  logoHeight: 0.45,
  /** logo 宽度上限 = 画布宽 × 0.2(位图等比缩放的外接框) */
  logoWidth: 0.2,
  /** logo 垂直中心 = 信息条顶 + 信息条高 × 0.56 */
  logoCenterY: 0.56,
  /** logo 与文字块内边距 = logo 高 × 0.42 */
  logoMarkPadding: 0.42,
  /** logo 文字块字号 = logo 高 × 0.36 */
  logoMarkFont: 0.36,
  /** logo 文字截断宽度 = logo 高 × 2.4 */
  logoMarkTextWidth: 2.4,
  /** 分隔线与两侧的空白 = 内边距 × 0.54 */
  dividerGap: 0.54,
  /** 分隔线上端 = 信息条顶 + 信息条高 × 0.4 */
  dividerTop: 0.4,
  /** 分隔线下端 = 信息条顶 + 信息条高 × 0.7 */
  dividerBottom: 0.7,
  /** 分隔线不透明度 */
  dividerAlpha: 0.55,
  /** 分隔线线宽 = 画布宽 × 0.0012,下限 1px —— 全表唯一极值:低于 1px 的线在画布上会消失 */
  dividerLineWidth: 0.0012,
  /** 参数文字字号 = 画布宽 × 0.018 */
  metadataFont: 0.018,
  /** 两行并存时第一行基线 = 信息条顶 + 信息条高 × 0.48 */
  firstRowY: 0.48,
  /** 仅一行时该行基线 = 信息条顶 + 信息条高 × 0.56 */
  singleRowY: 0.56,
  /** 第二行基线 = 信息条顶 + 信息条高 × 0.7 */
  secondRowY: 0.7
} as const;

/** 分隔线线宽的像素下限,唯一保留的极值(细分隔线在缩略尺寸下按比例会退化为 0 而消失)。 */
const MIN_DIVIDER_LINE_WIDTH = 1;

/** 第一行内字段间隔。 */
const METADATA_SPACER = "  ";
/** 第二行机型与镜头间隔。 */
const SECONDARY_SPACER = "     ";

/** 绘制上下文类型直接从契约派生,联合类型不在本文件重复声明。 */
type FrameContext = Parameters<DrawFrameComposition>[0];

const frameFont = (size: number, weight: number, family: string) =>
  `${weight} ${Math.round(size)}px ${family}`;

/** 按 measureText 逐字截断并补省略号,宽度充裕时原样返回。 */
const fitText = (context: FrameContext, value: string, maxWidth: number) => {
  const normalized = value.trim();
  if (!normalized || context.measureText(normalized).width <= maxWidth) {
    return normalized;
  }
  let candidate = normalized;
  while (candidate.length > 1) {
    candidate = candidate.slice(0, -1);
    const truncated = `${candidate}…`;
    if (context.measureText(truncated).width <= maxWidth) return truncated;
  }
  return "…";
};

/** 位图 logo:在外接框内等比缩放并垂直居中,返回占用的宽度供分隔线定位。 */
const drawLogoBitmap = (
  context: FrameContext,
  bitmap: ImageBitmap,
  x: number,
  centerY: number,
  maxHeight: number,
  maxWidth: number
) => {
  // 防零宽位图除零(NaN 守卫),不是视觉下限。
  const naturalWidth = Math.max(bitmap.width, 1);
  const naturalHeight = Math.max(bitmap.height, 1);
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, x, centerY - drawHeight / 2, drawWidth, drawHeight);
  return drawWidth;
};

/** 文字块 logo:浅色底板 + 深色文字,返回占用的宽度供分隔线定位。 */
const drawLogoMark = (
  context: FrameContext,
  mark: string,
  x: number,
  centerY: number,
  height: number
) => {
  const horizontalPadding = height * FRAME_GEOMETRY.logoMarkPadding;
  // logo 走主字体粗体:Jost 700 正是为此打包的第二条 webfont(等宽栈只服务参数行)。
  context.font = frameFont(height * FRAME_GEOMETRY.logoMarkFont, 700, PRIMARY_FONT_STACK);
  const normalizedMark = fitText(context, mark, height * FRAME_GEOMETRY.logoMarkTextWidth);
  const markWidth = context.measureText(normalizedMark).width + horizontalPadding * 2;
  context.fillStyle = FRAME_PALETTE.logoBackground;
  context.fillRect(x, centerY - height / 2, markWidth, height);
  context.fillStyle = FRAME_PALETTE.logoText;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(normalizedMark, x + markWidth / 2, centerY);
  return markWidth;
};

/** logo 与 EXIF 文字之间的细分隔竖线。 */
const drawDivider = (
  context: FrameContext,
  x: number,
  stripY: number,
  stripHeight: number,
  width: number
) => {
  context.save();
  context.strokeStyle = FRAME_PALETTE.muted;
  context.globalAlpha = FRAME_GEOMETRY.dividerAlpha;
  context.lineWidth = Math.max(MIN_DIVIDER_LINE_WIDTH, width * FRAME_GEOMETRY.dividerLineWidth);
  context.beginPath();
  context.moveTo(x, stripY + stripHeight * FRAME_GEOMETRY.dividerTop);
  context.lineTo(x, stripY + stripHeight * FRAME_GEOMETRY.dividerBottom);
  context.stroke();
  context.restore();
};

/**
 * 在已按输出尺寸建好的画布上绘制完整相框:
 * 黑底 → 原图 → 信息条渐变 → logo(位图优先,否则文字块) → 分隔竖线 → 两行 EXIF 文字。
 * 两行文字全空时信息条仍然绘制,但不画文字与分隔线。
 */
export const drawFrameComposition: DrawFrameComposition = (
  context,
  width,
  height,
  image,
  fields,
  logo?: LogoRenderInput
) => {
  context.clearRect(0, 0, width, height);
  context.fillStyle = FRAME_PALETTE.background;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const stripHeight = height * FRAME_GEOMETRY.stripHeight;
  const stripY = height - stripHeight;
  const paddingX = width * FRAME_GEOMETRY.paddingX;

  const overlayGradient = context.createLinearGradient(0, height, 0, stripY);
  overlayGradient.addColorStop(0, FRAME_PALETTE.strip);
  overlayGradient.addColorStop(1, FRAME_PALETTE.stripFade);
  context.fillStyle = overlayGradient;
  context.fillRect(0, stripY, width, stripHeight);

  const mark = logo?.bitmap ? "" : (logo?.mark ?? "").trim();
  const logoPresent = Boolean(logo?.bitmap || mark);
  const firstRow = [fields.focalLength, fields.exposure].filter(Boolean).join(METADATA_SPACER);
  const secondRow = [fields.model, fields.lens].filter(Boolean).join(SECONDARY_SPACER);

  let textX = paddingX;
  let textWidth = width - paddingX * 2;

  if (logoPresent) {
    const logoHeight = stripHeight * FRAME_GEOMETRY.logoHeight;
    const logoCenterY = stripY + stripHeight * FRAME_GEOMETRY.logoCenterY;
    const logoWidth = logo?.bitmap
      ? drawLogoBitmap(
          context,
          logo.bitmap,
          paddingX,
          logoCenterY,
          logoHeight,
          width * FRAME_GEOMETRY.logoWidth
        )
      : drawLogoMark(context, mark, paddingX, logoCenterY, logoHeight);
    if (firstRow || secondRow) {
      const dividerGap = paddingX * FRAME_GEOMETRY.dividerGap;
      const dividerX = paddingX + logoWidth + dividerGap;
      drawDivider(context, dividerX, stripY, stripHeight, width);
      textX = dividerX + dividerGap;
      textWidth = width - textX - paddingX;
    }
  }

  context.textAlign = "left";
  context.textBaseline = "middle";
  const metadataSize = width * FRAME_GEOMETRY.metadataFont;
  if (firstRow) {
    context.font = frameFont(metadataSize, 400, PRIMARY_FONT_STACK);
    context.fillStyle = FRAME_PALETTE.text;
    context.fillText(
      fitText(context, firstRow, textWidth),
      textX,
      stripY + stripHeight * (secondRow ? FRAME_GEOMETRY.firstRowY : FRAME_GEOMETRY.singleRowY)
    );
  }
  if (secondRow) {
    context.font = frameFont(metadataSize, 300, MONO_FONT_STACK);
    context.fillStyle = FRAME_PALETTE.muted;
    context.fillText(
      fitText(context, secondRow, textWidth),
      textX,
      stripY + stripHeight * FRAME_GEOMETRY.secondRowY
    );
  }
};
