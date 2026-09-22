import { outputNameOf } from "../file-name";
import { supportsWorkerRendering } from "./capability";
import { CancelledExportError } from "./export-cancel";
import { buildRenderUnits, concurrencyOf } from "./export-jobs";
import { FRAME_FONTS } from "./fonts";
import { mainThreadSurface, renderFrame } from "./render-core";
import { createFrameWorkerPool } from "./worker-pool";
import { PACK_FAILURE_PREFIX } from "./zip-writer";
import { JPEG_QUALITY } from "./types";
import type { RenderUnit } from "./export-jobs";
import type {
  CancelToken,
  FrameFailure,
  FrameJob,
  FrameProgressHandlers,
  FrameRenderRequest,
  FrameRenderSettings,
  FrameTaskResult,
  FrameWorkerResult
} from "./types";

/**
 * 批次调度(阶段 10 的内层):把一组 `FrameJob` 跑完,产出逐张结果与逐张失败。
 *
 * 分文件边界:
 * - `export-jobs.ts` 只管派发前的准备(任务整形、尺寸、并发数),不碰 Worker 也不碰产物;
 * - `export-pipeline.ts` 只管编排与产物去向(zip / 汇总),不碰派发细节;
 * - 本层夹在中间:只有「怎么派发、怎么收敛失败」。两条对外 API(zip 导出与逐张产物)
 *   共用这一份调度代码,只有消费端不同——这正是决策 D6 要求「降级路径与 Worker 路径同源」的落点。
 *
 * 三条不可让的纪律:
 * 1. **目标尺寸在派发前算完**(决策 D20):Worker 收到的请求已经带 target,它只做解码期缩放;
 *    源尺寸一律走 `image-size-probe` 的头部解析,全尺寸解码只在探测失败时作为 Rare path 发生。
 * 2. **单张失败不中断批次**(决策 D7):任何一张的异常都收敛成 `FrameFailure` 并继续派发。
 * 3. **池必在 finally 里 terminate**:漏一次就是每导一次泄漏一批 Worker。
 */

/** 批次跑完的账:成功张数 + 逐张失败明细(顺序即回报顺序,页面按序展示)。 */
export interface RenderBatchTally {
  readonly failures: FrameFailure[];
  /** 可变:派发循环里每个槽位都往它累加(只在工作线程之外的单线程事件循环中写,无竞态) */
  succeeded: number;
}

/** 一张产物怎么处置:落 zip(导出链路)或收进数组(逐张产物链路)。 */
export type ConsumeRendered = (result: FrameTaskResult) => Promise<void>;

export interface RenderBatchOptions {
  readonly jobs: readonly FrameJob[];
  readonly settings: FrameRenderSettings;
  readonly consume: ConsumeRendered;
  readonly handlers?: FrameProgressHandlers;
  readonly cancel?: CancelToken;
}

// ---------------------------------------------------------------- 失败收敛

/** 渲染失败的人话口径(与 docs/watermark-frame-plan.md 第 5 节的文案表对齐)。 */
const DECODE_FAILURE_MESSAGE = "无法解码该图片: 浏览器可能不支持此编码(如 HEIC)或文件已损坏";
const CANVAS_FAILURE_MESSAGE = "画布创建失败: 设备绘图上限不足, 请改用更低档位";
const WORKER_FAILURE_MESSAGE = "渲染 Worker 异常停止, 请重试或改用更小档位";

/**
 * 把渲染/打包异常翻译成用户能照着做事的中文消息。
 *
 * 分类必须是三条而不是「原样抛出」:解码失败要换格式、画布超限要降档、Worker 异常要重开页面,
 * 用户面对的处置动作完全不同。打包失败原样透传(它自带 `压缩包写入失败` 前缀,再套一层会稀释原因)。
 */
const describeFailure = (cause: unknown): string => {
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (reason.startsWith(PACK_FAILURE_PREFIX)) return reason;
  if (/解码|不支持此编码|unsupported|corrupt|damaged/iu.test(reason)) return DECODE_FAILURE_MESSAGE;
  if (/上下文|canvas|画布|面积超出/iu.test(reason)) return CANVAS_FAILURE_MESSAGE;
  if (/worker/iu.test(reason)) return `${WORKER_FAILURE_MESSAGE} (${reason})`;
  return `导出失败: ${reason}`;
};

// ---------------------------------------------------------------- 派发与回报

const requestOf = (unit: RenderUnit, settings: FrameRenderSettings): FrameRenderRequest => ({
  fileName: unit.job.fileName,
  blob: unit.job.blob,
  target: unit.target,
  // 质量恒 0.92(D3):档位只改尺寸不改质量,所以请求侧没有「按档位调质量」这一说。
  jpegQuality: JPEG_QUALITY,
  styleId: settings.styleId,
  fields: unit.job.fields,
  exifHead: unit.job.exifHead,
  logoMark: settings.logoMark,
  logoBlob: settings.logoBlob,
  fonts: FRAME_FONTS
});

/** 怎么拿到一张的产物:两条渲染路径唯一被允许不同的地方(决策 D6)。 */
type ProduceResult = (request: FrameRenderRequest) => Promise<FrameWorkerResult>;

interface Channel {
  readonly produce: ProduceResult;
  readonly usedWorker: boolean;
  readonly concurrency: number;
  /** 让在途任务立刻 reject;主线程路径没有这个能力,留空即「等这一张画完」 */
  readonly abortInFlight?: () => void;
  /** 销毁通道背后的资源(池)。降级路径没有资源,所以没有这个成员。 */
  readonly dispose?: () => void;
}

/**
 * 打开渲染通道:Worker 可用走池,否则主线程串行(D6 要求降级路径存在且被测到)。
 *
 * 降级路径**不建池**且并发写死 1:主线程只有一个 UI 线程,并发渲染会直接把交互卡死;
 * `usedWorker` 如实反映来源,页面与用例都靠它分辨两条路径。
 */
const openChannel = (concurrency: number): Channel => {
  if (!supportsWorkerRendering()) {
    return {
      produce: (request) => renderFrame(request, mainThreadSurface),
      usedWorker: false,
      concurrency: 1
    };
  }
  // 池是懒创建的(构造不花钱,派发才建 Worker),所以这里可以直接按预算并发数建它。
  const pool = createFrameWorkerPool(concurrency);
  return {
    produce: (request) => pool.render(request),
    usedWorker: true,
    concurrency,
    abortInFlight: () => pool.cancel(),
    dispose: () => pool.terminate()
  };
};

const runBatch = async (
  units: readonly RenderUnit[],
  settings: FrameRenderSettings,
  channel: Channel,
  consume: ConsumeRendered,
  handlers: FrameProgressHandlers | undefined,
  cancel: CancelToken | undefined,
  tally: RenderBatchTally
): Promise<void> => {
  let cursor = 0;
  let stopped = false;
  const cancelled = (): boolean => Boolean(cancel?.cancelled);

  /**
   * 取消监听在**注册时刻**就绑死当前通道的 abortInFlight:令牌可能是复用的(用户连点两次导出),
   * 迟到绑会取消不到在途任务,表现是「点了取消还要等几十秒」。
   */
  cancel?.onChange(() => {
    stopped = true;
    channel.abortInFlight?.();
  });

  const settleUnit = async (unit: RenderUnit): Promise<void> => {
    const fileName = outputNameOf(unit.job.fileName);
    const fail = (cause: unknown): void => {
      const failure: FrameFailure = {
        jobId: unit.job.id,
        fileName,
        message: describeFailure(cause)
      };
      tally.failures.push(failure);
      handlers?.onJobFailed?.(failure);
    };
    /**
     * 取消判定**只以令牌为准**:上游(池、渲染内核)抛来的异常文本不可信,
     * 若凭一句「导出已取消」就把这张悄悄吞掉,决策 D7 的失败列表会凭空少一条。
     * 池被 `cancel()` 打断时令牌必然已是取消态,因此不需要第二条判据。
     */
    let rendered: FrameWorkerResult;
    try {
      rendered = await channel.produce(requestOf(unit, settings));
    } catch (cause) {
      if (cancelled()) {
        stopped = true;
        return;
      }
      fail(cause); // 单张失败只记账,不 rethrow——这是 D7 的全部意义
      return;
    }
    if (cancelled()) {
      // 取消后已产出的字节不落 zip:这一张既不成功也不失败,整批按取消收口。
      stopped = true;
      return;
    }
    const result: FrameTaskResult = {
      jobId: unit.job.id,
      fileName,
      blob: rendered.blob,
      width: rendered.width,
      height: rendered.height,
      usedWorker: channel.usedWorker,
      exifInjected: rendered.exifInjected
    };
    try {
      await consume(result);
    } catch (cause) {
      if (cancelled()) {
        stopped = true;
        return;
      }
      fail(cause);
      return;
    }
    tally.succeeded += 1;
    handlers?.onJobDone?.(result);
  };

  /**
   * 槽位各自从共享游标取任务,而不是 `jobs.map(run)`:后者会把 N 个 Promise 同时挂出去,
   * 「停止派发新任务」就没有落点(取消时后面几十张照样进渲染队列)。
   */
  const slot = async (): Promise<void> => {
    while (!cancelled() && !stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= units.length) return;
      await settleUnit(units[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, channel.concurrency) }, () => slot()));
  if (cancelled() || stopped) throw new CancelledExportError();
};

/**
 * 跑完一批渲染:算尺寸 → 开通道(池或主线程串行)→ 派发 → 关通道。
 *
 * 池的 terminate 写在 finally:失败、取消、正常结束三条路径都必须走到,
 * 否则每导一次泄漏一批 Worker(每个常驻几十 MB,`apps/admin/AGENTS.md` 第 5 节)。
 */
export const runRenderBatch = async (options: RenderBatchOptions): Promise<RenderBatchTally> => {
  const { jobs, settings, consume, handlers, cancel } = options;
  const units = await buildRenderUnits(jobs, settings, cancel);
  const tally: RenderBatchTally = { failures: [], succeeded: 0 };
  // 没有单元就不建池:空批次拉起一个 Worker 是纯浪费(也是 runFrameExport 的前置守卫之外)
  if (units.length === 0) return tally;

  const channel = openChannel(concurrencyOf(units));
  try {
    await runBatch(units, settings, channel, consume, handlers, cancel, tally);
  } finally {
    channel.dispose?.();
  }
  return tally;
};
