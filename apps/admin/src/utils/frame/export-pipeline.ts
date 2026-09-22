import { buildZipFileName } from "../file-name";
import { runRenderBatch } from "./export-batch";
import {
  CANCELLED_ERROR_MESSAGE,
  CancelledExportError,
  NO_FILES_ERROR_MESSAGE,
  createCancelToken,
  isCancelledExport
} from "./export-cancel";
import { prepareFrameJobs } from "./export-jobs";
import { probeSourceSize } from "./image-size-probe";
import { createZipWriter } from "./zip-writer";
import type { FrameTaskResult, RenderFrameBatch, RunFrameExport } from "./types";

/**
 * 导出流水线(阶段 10)——整条链路唯一有状态的编排者,也是页面对渲染引擎的唯一入口。
 *
 * 只做编排,不做具体动作:每个动作都有自己的模块,本文件负责把它们按顺序接起来。
 * 设计因果:
 * - **尺寸先于派发**(决策 D20):目标尺寸在主线程按「头部解析出的源尺寸 + 档位 + canvas 面积上限」
 *   算完(见 `export-jobs.buildRenderUnits`),Worker 只做解码期缩放。全尺寸解码一次只为拿尺寸,正是
 *   D20 要消掉的那约 96MB,所以尺寸走 `image-size-probe`,读不出来才允许 Rare path 的二次解码。
 * - **两条渲染路径同源**(决策 D6):Worker 池与主线程降级的全部差异被压进「怎么拿到一张的产物」
 *   一个函数(见 `export-batch.openChannel`),派发顺序、失败收敛、进度回报、打包因此同构,
 *   两条路径的汇总形状由用例断言相等——降级不是「凑能用」。
 * - **单张失败绝不中断批次**(决策 D7):失败收敛成 `FrameFailure` 逐条回报给页面,
 *   只有「一张都没成功」才升级为整批失败(那种情况下出空包比不出包更坏)。
 * - **产物逐张落 zip**(`zip-writer.ts`):流水线不持有产物字节序列。攒到最后一次性打包会让
 *   50 张中档成品约 200MB 全程驻留,而流式写入让在途产物数等于并发数(≤4)。
 * - **取消是停止派发而不是回滚**:已完成的字节不进包(包也不要了),在途任务被池 reject,
 *   抛 `CancelledExportError` 让页面走「已取消」分支而不是「导出失败」分支。
 *
 * 依赖纪律:不 import react/arco/store(`apps/admin/AGENTS.md` 第 1 节)。`fflate` 与
 * `utils/file-name` 出现在这一层是流水线专属的:本文件与 `zip-writer.ts` 只在主线程运行,
 * 不进 Worker;Worker 侧的 `frame.worker.ts` / `render-core.ts` 依旧零第三方运行时依赖。
 *
 * 页面(阶段 13)只需要这一组入口:`runFrameExport` 出包、`renderFrameBatch` 出逐张产物、
 * `createCancelToken` + `isCancelledExport` 接取消按钮、`probeSourceSize` 回写尺寸。
 */

export {
  CANCELLED_ERROR_MESSAGE,
  NO_FILES_ERROR_MESSAGE,
  CancelledExportError,
  createCancelToken,
  isCancelledExport
};

/** 尺寸探测对页面仍然有用(列表里显示「源图 6000×4000 → 输出 中档」),但不必让页面认识新模块。 */
export { probeSourceSize };

/** 一张都没成功的整批失败消息(明细已通过 handlers 进了 store,页面自己展示失败列表)。 */
export const noSuccessMessage = (total: number): string =>
  `没有一张图片导出成功: 全部 ${String(total)} 张都失败了, 未生成压缩包(失败原因见列表)。`;

/** 逐张产物收集器:给 `renderFrameBatch` 用,它服务的是「调用方要拿到每张成品」的场景。 */
const collector =
  (sink: FrameTaskResult[]) =>
  async (result: FrameTaskResult): Promise<void> => {
    sink.push(result);
  };

/**
 * 渲染一批并把产物收进 `FrameOutcome`。
 *
 * 与 `runFrameExport` 共用 `runRenderBatch` 调度,只有消费端不同。注意这条 API **会**持有
 * 全部产物 Blob(契约形状如此),导出链路因此不走它——逐张落 zip 才能把在途产物压在并发数量级。
 * 整批全失败在这条 API 上**不抛错**:产物数组与失败数组都如实返回,要不要报错由调用方决定。
 */
export const renderFrameBatch: RenderFrameBatch = async (jobs, settings, handlers, cancel) => {
  const results: FrameTaskResult[] = [];
  const tally = await runRenderBatch({
    jobs,
    settings,
    consume: collector(results),
    handlers,
    cancel
  });
  return { results, failures: tally.failures };
};

/**
 * 端到端导出:文件 → 任务准备 → 尺寸与并发 → 渲染(逐张落包)→ 汇总。
 *
 * 三种整批失败都抛中文错误,且都在 `handlers` 里把逐张明细先送出去:
 * 1. 一张都没选 → `NO_FILES_ERROR_MESSAGE`(连池都不建);
 * 2. 全部失败 → `noSuccessMessage()`(空 zip 会让用户以为下载成功,所以宁可不产出);
 * 3. 用户取消 → `CancelledExportError`,已累积分片由下面的 `discard()` 丢掉。
 *
 * `catch` 里统一 discard 再原样 rethrow:异常路径上绝不可能留下半截 zip 被当成成品下载。
 */
export const runFrameExport: RunFrameExport = async (files, settings, handlers, cancel) => {
  if (!files || files.length === 0) throw new Error(NO_FILES_ERROR_MESSAGE);
  const writer = createZipWriter();
  try {
    const jobs = await prepareFrameJobs(files, cancel);
    const tally = await runRenderBatch({
      jobs,
      settings,
      // 逐张落包:Blob 的字节交给 fflate 之后,这个闭包与流水线都不再持有产物引用。
      consume: async (result) => {
        await writer.add(result.fileName, result.blob);
      },
      handlers,
      cancel
    });
    if (tally.succeeded === 0) throw new Error(noSuccessMessage(jobs.length));
    const zip = await writer.finish();
    return {
      zip,
      zipFileName: buildZipFileName(new Date()),
      succeeded: tally.succeeded,
      total: jobs.length,
      failures: tally.failures
    };
  } catch (error) {
    // 不吞也不改写:取消与全失败的分支判定交给页面(`isCancelledExport`),这里只负责丢掉分包。
    writer.discard();
    throw error;
  }
};
