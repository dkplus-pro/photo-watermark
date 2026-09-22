import { sanitizeBaseName } from "../file-name";
import { memoryAwareConcurrency, probeMaxCanvasArea, resolveOutputSize } from "./capability";
import { CancelledExportError } from "./export-cancel";
import { readHeadBytes } from "./exif";
import { extractPhotoExif, frameFieldsFromExif } from "./fields";
import { probeSizeFromHead, probeSourceSize } from "./image-size-probe";
import { SIZE_TIERS } from "./types";
import type { CancelToken, FrameJob, FrameRenderSettings, OutputSize } from "./types";

/**
 * 派发前的准备(阶段 10 的内层):把用户选的 `File` 变成可渲染的 `FrameJob`,
 * 再为每张算出输出尺寸与整批并发数。
 *
 * 与 `export-batch.ts`(派发与回报)分文件的理由是变化方向不同:这里的全部逻辑都只依赖
 * 「文件字节 + 档位 + 浏览器能力」,不碰 Worker、不碰产物、也不关心失败怎么收敛;
 * 派发层反过来也是——它只吃算好的单元。两层各自可测,合起来才是流水线。
 *
 * 尺寸口径(决策 D20):源尺寸一律先从**头部字节**解析(`image-size-probe`),
 * 全尺寸解码只在解析失败时作为 Rare path 发生;这一步是「50 张批量不会在探测阶段就把内存吃光」的前提。
 */

/** 一个渲染单元:任务 + 主线程算好的输出尺寸 + 用于内存预算的参照尺寸。 */
export interface RenderUnit {
  readonly job: FrameJob;
  /** null = 按源图尺寸输出(探测失败或入参非法) */
  readonly target: OutputSize | null;
  /** 内存预算用的尺寸:目标 → 源图 → 档位上限(最坏情况)三选一 */
  readonly budget: OutputSize;
}

const areaOf = (size: OutputSize): number => size.width * size.height;

/**
 * 任务 id:`索引 + 体积 + 修改时间`,**可预测**而非随机。
 * 随机 id 会让「同一张图在两次导出里是两个任务」,进度弹框与失败列表就再也对不回用户选的文件,
 * 用例也无法稳定断言;索引段保证同一批里两张同名同体积的文件不会撞 id。
 */
const jobIdOf = (file: File, index: number): string =>
  `frame-job-${String(index)}-${String(file.size)}-${String(file.lastModified)}`;

/**
 * `File[]` → `FrameJob[]`:读头字节(给 EXIF 继承)+ 解 EXIF(给相框文案)。
 *
 * `sanitizeBaseName` 自己会按最后一个点剥扩展名,外面不要再切一次(`photo.2026.01.jpg` 会被切错)。
 * EXIF 相关的任何失败都不丢任务:`readHeadBytes` 与 `extractPhotoExif` 只会返回空值不会抛错,
 * 字段全空的相框照样出片,只是信息条少几行(D7:元数据缺失不是导出失败)。
 */
export const prepareFrameJobs = async (
  files: readonly File[],
  cancel?: CancelToken
): Promise<FrameJob[]> => {
  const jobs: FrameJob[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (cancel?.cancelled) throw new CancelledExportError();
    const file = files[index];
    const exifHead = await readHeadBytes(file);
    const fields = frameFieldsFromExif(await extractPhotoExif(file));
    jobs.push({
      id: jobIdOf(file, index),
      fileName: sanitizeBaseName(file.name),
      blob: file,
      fields,
      exifHead
    });
  }
  return jobs;
};

/**
 * 源尺寸:优先吃已经在手的 JPEG 头部字节(`readHeadBytes` 的产物,JPEG 场景零额外读取),
 * 读不出来再走 `probeSourceSize`(PNG/WebP 的容器解析,以及 Rare path 的二次解码)。
 */
const sourceSizeOf = async (job: FrameJob): Promise<OutputSize | null> =>
  probeSizeFromHead(job.exifHead) ?? probeSourceSize(job.blob);

/**
 * 逐张算目标尺寸,并顺带定下内存预算用的参照尺寸。
 *
 * `resolveOutputSize` 用 `{0,0}` 表达「入参非法」;这里把它与「尺寸探测失败」一起收敛成
 * `target = null`(按源图输出)——两种情况在语义上都是「不知道多大,就别缩放」。
 * budget 取「目标 → 源图 → 档位上限」三档兜底:尺寸未知时按档位最坏情况估并发,
 * 因为**高估并发是被系统杀页,低估只是慢一点**。
 */
export const buildRenderUnits = async (
  jobs: readonly FrameJob[],
  settings: FrameRenderSettings,
  cancel?: CancelToken
): Promise<RenderUnit[]> => {
  const maxCanvasArea = await probeMaxCanvasArea();
  const tierSide = Math.max(1, Math.round(Math.sqrt(SIZE_TIERS[settings.tier].maxPixels)));
  const units: RenderUnit[] = [];
  for (const job of jobs) {
    // 逐张之间查取消:Rare path 的解码有真实成本,取消后不该继续为剩下的图付这份内存。
    if (cancel?.cancelled) throw new CancelledExportError();
    const source = await sourceSizeOf(job);
    const resolved = source
      ? resolveOutputSize(source.width, source.height, settings.tier, maxCanvasArea)
      : null;
    const target = resolved && areaOf(resolved) > 0 ? resolved : null;
    units.push({ job, target, budget: target ?? source ?? { width: tierSide, height: tierSide } });
  }
  return units;
};

/** 并发数按「全部任务里最大的那张输出面积」取:小图不能把大图那几档的内存额度吃光。 */
export const concurrencyOf = (units: readonly RenderUnit[]): number => {
  const largest = units.reduce<RenderUnit | null>(
    (best, unit) => (!best || areaOf(unit.budget) > areaOf(best.budget) ? unit : best),
    null
  );
  // 没有单元时返回 0:memoryAwareConcurrency 的 0 语义是「一个 Worker 都不该拉起」,不是死锁。
  if (!largest) return 0;
  return memoryAwareConcurrency(largest.budget.width, largest.budget.height, units.length);
};
