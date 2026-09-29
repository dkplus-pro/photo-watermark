import { WorkerPool } from "../worker-pool";
import type { PoolWorkerLike } from "../worker-pool";
import type {
  CreateFrameWorkerPool,
  FrameRenderRequest,
  FrameWorkerPoolLike,
  FrameWorkerResult
} from "./types";

/**
 * 渲染 Worker 池(阶段 9 引入,现已泛化为 `utils/worker-pool.ts` 的通用池)。
 *
 * 本文件只剩 frame 侧的两件事:
 * 1. **Worker 构造的打包器契约**:rspack(Modern.js 的默认打包器)只识别
 *    `new Worker(new URL("./x.worker.ts", import.meta.url))` 这一种字面量,识别后把入口
 *    切成独立 chunk,并把 URL 重写成带 hash 的产物地址。改成 `new Worker("./frame.worker.ts")`
 *    类型照样通过、构建也不报错,但产物里是一个相对当前页面的坏 URL——运行时静默加载失败,
 *    表现为「所有任务都失败」。
 * 2. frame 契约的类型化门面:流水线(export-batch)与池用例都按 `createFrameWorkerPool` /
 *    `pool.render` 消费,泛型池的方法名 `run` 在这里包一层,不外泄。
 *
 * 池级纪律(懒创建、按 id 配对、单张失败不污染池)全部在通用池里,用例经本门面覆盖。
 */

const createRenderWorker = (): PoolWorkerLike<FrameRenderRequest> =>
  new Worker(new URL("./frame.worker.ts", import.meta.url), {
    type: "module"
  }) as unknown as PoolWorkerLike<FrameRenderRequest>;

/**
 * 渲染 Worker 池:泛型池以 `FrameRenderRequest / FrameWorkerResult` 实例化。
 * 池不理解渲染语义(那在 render-core 里);`render` 入参即发往 Worker 的完整请求。
 */
export class FrameWorkerPool
  extends WorkerPool<FrameRenderRequest, FrameWorkerResult>
  implements FrameWorkerPoolLike
{
  constructor(concurrency: number) {
    super(concurrency, createRenderWorker);
  }

  /** FrameWorkerPoolLike 的派发入口名;流水线与用例按 `render` 消费。 */
  render(request: FrameRenderRequest): Promise<FrameWorkerResult> {
    return this.run(request);
  }
}

/** 池工厂:并发数由调用方按内存预算算好传入(见 capability.memoryAwareConcurrency)。 */
export const createFrameWorkerPool: CreateFrameWorkerPool = (concurrency) =>
  new FrameWorkerPool(concurrency);
