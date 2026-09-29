import { WorkerPool } from "../worker-pool";
import type { PoolWorkerLike } from "../worker-pool";
import type { CompressRequest, CompressResult } from "./compress-core";

/**
 * 压缩 Worker 池:通用池(`utils/worker-pool.ts`)以压缩请求/产物实例化,
 * Worker 构造走 rspack 唯一识别的 `new Worker(new URL(...))` 字面量
 * (打包器契约详见 frame/worker-pool.ts 的注释,改写法产物会静默加载失败)。
 */

const createCompressWorker = (): PoolWorkerLike<CompressRequest> =>
  new Worker(new URL("./compress.worker.ts", import.meta.url), {
    type: "module"
  }) as unknown as PoolWorkerLike<CompressRequest>;

/**
 * 压缩链路自己的 Worker 支持判定,不复用 frame 的 `supportsWorkerRendering`:
 * 那边要求 FontFace(渲染要画字),压缩不需要——判定面不同,复用会把「无 FontFace 但
 * 能压缩」的环境错误地打进串行路径。
 */
export const supportsCompressWorker = (): boolean =>
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap !== "undefined";

export const createCompressPool = (
  concurrency: number
): WorkerPool<CompressRequest, CompressResult> =>
  new WorkerPool<CompressRequest, CompressResult>(concurrency, createCompressWorker);
