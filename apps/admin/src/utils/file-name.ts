import type { SanitizeBaseName, UniqueName } from "./frame/types";

/**
 * 文件名工具:导出产物(zip 与 zip 内的 JPEG)命名与表单展示的唯一口径。
 * 命名规则同时照顾 Windows/macOS/Linux 三个落盘目标,并把「用户看到的名字」
 * 与「落盘的名字」分开:`displayNameOf` 只管展示,`sanitizeBaseName` 才做消毒。
 */

/** 输出图片的扩展名;渲染引擎恒输出 JPEG(契约见 frame/types.ts 的 D3)。 */
export const JPEG_EXTENSION = ".jpg";

/** 批量导出 zip 的前缀,用户在下载目录里靠它认产物。 */
export const ZIP_FILE_PREFIX = "frame-export";

/** 展示层降级占位:体积算不出时给一条中性文案,而不是 NaN/undefined。 */
export const SIZE_UNAVAILABLE = "—";

const ZIP_EXTENSION = ".zip";

/**
 * 主名长度上限(码点数)。文件系统的名义上限是单段 255 字节,
 * 但中文名一个字符就占 3 字节,80 个码点(~240 字节)是三个平台都安全的余量。
 */
const MAX_BASE_NAME_CHARS = 80;

/** 消毒后什么都不剩时的兜底主名。 */
const UNTITLED_BASE_NAME = "untitled";

/** 同名冲突时 `-2/-3…` 序号的试探上限,超过后改走时间戳(见 uniqueName)。 */
const UNIQUE_TRIAL_LIMIT = 1000;

/** 时间戳也撞车时的随机后缀尝试次数。 */
const UNIQUE_RANDOM_TRIES = 16;

/** 字节进位基数:文件大小展示按 1024 递进,与用户在属性面板看到的一致。 */
const BYTE_BASE = 1024;

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * 文件系统非法字符取三大平台的交集(Windows 最严),外加控制字符。
 * 控制段写成 `\p{Cc}` 而不是 `\x00-\x1f`:前者既躲开 eslint 的 no-control-regex
 * (源码里不出现裸控制字符),也顺带覆盖 C1(U+0080-U+009F)——那同样是不能落盘的垃圾。
 * `u` 标志让正则按码点而非码元处理,避免把代理对当成两个字符。
 */
const ILLEGAL_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;

/** Windows 不允许名字以空白或点结尾,落盘会被静默改写,所以两头都要清。 */
const trimEdges = (value: string): string => value.trim().replace(/\.+$/u, "");

/**
 * 只在最后一个点处切分:`photo.2026.01.jpg` 的日期点属于主名,
 * 用 `split(".")[0]` 会把它砍成 `photo`。无点则整体就是主名、扩展名为空。
 */
const splitBaseAndExtension = (name: string): { base: string; extension: string } => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) {
    return { base: name, extension: "" };
  }
  return { base: name.slice(0, dotIndex), extension: name.slice(dotIndex) };
};

/**
 * 把任意用户文件名消毒成可作为主名落盘的字符串(不含扩展名)。
 *
 * 处理顺序不可调换:
 * 1. 剥扩展名——必须最先做,否则后面的截断会把扩展名切一半,主名和 `.jpg` 糊在一起;
 * 2. 替换非法字符——扩展名的点已在第 1 步剥离,这一步剩下的点/斜杠都是主名内容,统一换 `_`;
 * 3. 清首尾——剥扩展名与替换都会暴露新的结尾(如 `photo.` 变 `photo`),按 Windows 口径去空白与结尾点;
 * 4. 截断——只能在清理之后做,截完还可能重新出现尾随空格(`79 个字符 + " x"`),故再清一次首尾;
 * 5. 空串兜底——`".jpg"` 这类只有扩展名的输入会走到这里。
 */
export const sanitizeBaseName: SanitizeBaseName = (name) => {
  const cleaned = trimEdges(splitBaseAndExtension(name).base.replace(ILLEGAL_CHARS, "_"));
  // Array.from 按码点展开再截:`String.prototype.slice(0, 80)` 数的是 UTF-16 码元,
  // 会把 emoji 切成半个代理对——半个字符落盘非法,macOS 会显示成 `?`。
  const codePoints = Array.from(cleaned);
  const limited =
    codePoints.length > MAX_BASE_NAME_CHARS
      ? trimEdges(codePoints.slice(0, MAX_BASE_NAME_CHARS).join(""))
      : cleaned;
  return limited === "" ? UNTITLED_BASE_NAME : limited;
};

/**
 * 在已占用集合里为 candidate 找一个不冲突的名字。
 *
 * **纯函数约定**:本函数只读 `used`,绝不往里写。登记由调用方做,
 * 否则两处都往 Set 里塞会让同一名字被计入两次、后续全部错位。
 */
export const uniqueName: UniqueName = (used, candidate) => {
  if (!used.has(candidate)) {
    return candidate;
  }
  const { base, extension } = splitBaseAndExtension(candidate);
  // 序号插在扩展名之前:`a.jpg` → `a-2.jpg`。追加成 `a.jpg-2` 的话系统不再按图片认它。
  for (let index = 2; index <= UNIQUE_TRIAL_LIMIT + 1; index += 1) {
    const trial = `${base}-${String(index)}${extension}`;
    if (!used.has(trial)) {
      return trial;
    }
  }
  // 上千个同名文件的极端情形:退回时间戳。
  const stampedBase = `${base}-${String(Date.now())}`;
  if (!used.has(`${stampedBase}${extension}`)) {
    return `${stampedBase}${extension}`;
  }
  for (let retry = 0; retry < UNIQUE_RANDOM_TRIES; retry += 1) {
    const salt = String(1000 + Math.floor(Math.random() * 9000));
    const salted = `${stampedBase}-${salt}${extension}`;
    if (!used.has(salted)) {
      return salted;
    }
  }
  // 最后仍是确定性序号:used 是有限的 size 个成员,试 size+1 个互不相同的候选必有空位,
  // 因此下面这个循环有界,不存在「同一毫秒导入两千张同名图」就卡死的可能。
  const maxTries = used.size + 1;
  for (let index = 0; index < maxTries; index += 1) {
    const forced = `${stampedBase}-r${String(index)}${extension}`;
    if (!used.has(forced)) {
      return forced;
    }
  }
  return `${stampedBase}-r${String(maxTries)}${extension}`;
};

/**
 * zip 产物文件名:`frame-export-YYYY-MM-DD.zip`。
 *
 * 年月日一律取本地时区:用户晚上导出时,`toISOString()`(UTC)会让文件名写上昨天,
 * 在东八区几乎每天下午之后都错。构造 Date 后读本地 getter 才是用户预期的日期。
 */
export const buildZipFileName = (date: Date): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ZIP_FILE_PREFIX}-${year}-${month}-${day}${ZIP_EXTENSION}`;
};

/** 列表里给用户看的主名:只剥扩展名,非法字符原样保留(展示不是落盘)。 */
export const displayNameOf = (file: File): string => {
  const base = splitBaseAndExtension(file.name).base.trim();
  // `.jpg` 这类没有主名的文件,展示回原名比展示空字符串有用。
  return base === "" ? file.name : base;
};

/**
 * 表单里的体积展示:B 取整,KB/MB/GB 保留一位小数,阈值 1024 进位。
 * 非法输入(负数/NaN/Infinity)返回占位符——展示层不该抛错。
 */
export const formatByteSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return SIZE_UNAVAILABLE;
  }
  if (bytes === 0) {
    return `0 ${BYTE_UNITS[0]}`;
  }
  let exponent = 0;
  while (exponent < BYTE_UNITS.length - 1 && bytes >= BYTE_BASE ** (exponent + 1)) {
    exponent += 1;
  }
  const scaled = bytes / BYTE_BASE ** exponent;
  const text = exponent === 0 ? String(Math.round(scaled)) : scaled.toFixed(1);
  // 进位边界:1048575 字节按 KB 表达会写成 `1024.0 KB`,数值上就是 1MB,升一格。
  if (Number(text) >= BYTE_BASE && exponent < BYTE_UNITS.length - 1) {
    return `${(Number(text) / BYTE_BASE).toFixed(1)} ${BYTE_UNITS[exponent + 1]}`;
  }
  return `${text} ${BYTE_UNITS[exponent]}`;
};

/** zip 内单张图的最终文件名:消毒后的主名 + 固定扩展名。 */
export const outputNameOf = (baseName: string): string =>
  `${sanitizeBaseName(baseName)}${JPEG_EXTENSION}`;
