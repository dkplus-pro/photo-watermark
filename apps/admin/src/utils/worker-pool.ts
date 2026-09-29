/**
 * 通用 Worker 池(从 `utils/frame/worker-pool.ts` 泛化抽出)。
 *
 * 职责:把 N 个任务摊到最多 `concurrency` 个 Worker 上,并按请求 id 把回报配对回
 * 对应的 Promise。池只负责调度与配对,不理解任务语义(渲染在 render-core、压缩在
 * compress-core)。Worker 的构造形态由调用方注入,池本身不出现任何具体 Worker 路径——
 * 「页面的 Worker 收口」因此仍是 utils 层的池工厂,页面与组件依旧不裸触 `new Worker`。
 *
 * 三条不可让的纪律(用例锁在 tests/utils/frame/worker-pool.test.ts,经 frame 门面覆盖):
 * 1. **懒创建**:一个 Worker 常驻几十 MB(独立 V8 isolate + 它自己的画布缓冲),没有任务
 *    就不该建,所以构造后 size 恒为 0,派发时才建;
 * 2. **按 id 配对**:Worker 内部是异步的,回报顺序与派发顺序无关。「谁先回算谁」会让 A 张
 *    拿到 B 张的产物,这是本模块最容易写错、也最难从产物上查出来的地方;
 * 3. **单张失败不污染池**(决策 D7):reject 只针对那一个 Promise;坏 Worker 被摘除,
 *    其余 Worker 继续服务。
 */

/** 并发下限:0/负数/NaN 一律收敛到 1。并发 0 意味着排队任务永远没人执行,那是死锁。 */
const MIN_CONCURRENCY = 1;

// 文案与池用例的断言逐字绑定(tests/utils/frame/worker-pool.test.ts),改文案必须同批改用例。
const CANCELLED_MESSAGE = "已取消";
const TERMINATED_MESSAGE = "Worker 池已销毁, 无法继续渲染。";
const WORKER_DIED_MESSAGE = "渲染 Worker 意外停止。";

/** 主线程 → Worker 的派发指令。字面量沿用 frame 时代的 "render",两条链路共用同一协议。 */
export interface PoolDispatchMessage<TRequest> {
  readonly type: "render";
  readonly id: number;
  readonly request: TRequest;
}

/** Worker → 主线程的回报:result 与 error 二选一,id 用于配对。 */
export type PoolReplyMessage<TResult> =
  | { readonly type: "result"; readonly id: number; readonly result: TResult }
  | { readonly type: "error"; readonly id: number; readonly message: string };

/**
 * 池用到的 Worker 成员。
 *
 * `onmessage`/`onerror` 用属性赋值而不是 addEventListener:一个 Worker 同一时刻只跑一个
 * 任务,消息通道是独占的,重复 addEventListener 反而会在摘除时漏清理。
 */
export interface PoolWorkerLike<TRequest> {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: PoolDispatchMessage<TRequest>): void;
  terminate(): void;
}

/** Worker 构造工厂:打包器契约(`new Worker(new URL(...))` 字面量)由调用方负责。 */
export type CreatePoolWorker<TRequest> = () => PoolWorkerLike<TRequest>;

/** 一次 run() 调用 = 一个 PendingTask;池按 id 反查它,并把产物交给对应的 Promise。 */
interface PendingTask<TRequest, TResult> {
  readonly id: number;
  readonly request: TRequest;
  readonly resolve: (result: TResult) => void;
  readonly reject: (reason: Error) => void;
}

const normalizeConcurrency = (value: number): number => {
  const integer = Number.isFinite(value) ? Math.floor(value) : MIN_CONCURRENCY;
  return Math.max(MIN_CONCURRENCY, integer);
};

export class WorkerPool<TRequest, TResult> {
  /** 存活的 Worker;崩溃/终止即从这里摘除,所以它同时是 size 的事实源。 */
  private readonly living: Array<PoolWorkerLike<TRequest>> = [];
  /** 在途 + 排队任务的索引,按请求 id 反查;回报到达即删除,天然挡住重复 settle。 */
  private readonly tasks = new Map<number, PendingTask<TRequest, TResult>>();
  /** 没有空闲 Worker 时,待派发的任务在这里排队。 */
  private readonly waiting: Array<PendingTask<TRequest, TResult>> = [];
  /** Worker → 该 Worker 当前在跑的任务 id;null 表示空闲。与 Worker 同生命周期。 */
  private readonly runningTaskId = new Map<PoolWorkerLike<TRequest>, number | null>();
  private readonly concurrency: number;
  private readonly createWorker: CreatePoolWorker<TRequest>;
  private phase: "active" | "cancelled" | "terminated" = "active";
  private sequence = 0;

  constructor(concurrency: number, createWorker: CreatePoolWorker<TRequest>) {
    this.concurrency = normalizeConcurrency(concurrency);
    this.createWorker = createWorker;
  }

  /** 当前存活的 Worker 数(懒创建后才有值,崩溃摘除会使其回落)。 */
  get size(): number {
    return this.living.length;
  }

  /**
   * 派发一个任务。Worker 报错即 reject,由调用方收敛成单张失败(D7)。
   *
   * 池已 cancel/terminate 后**明确拒绝**新任务(而不是重建 Worker):调用方拿到的是一条
   * 失败记录,与「这一批已经放弃」的语义一致,也不会出现「点了取消又偷偷起 Worker」。
   */
  run(request: TRequest): Promise<TResult> {
    if (this.phase === "cancelled") return Promise.reject(new Error(CANCELLED_MESSAGE));
    if (this.phase === "terminated") return Promise.reject(new Error(TERMINATED_MESSAGE));
    this.sequence += 1;
    const id = this.sequence;
    return new Promise<TResult>((resolve, reject) => {
      const pending: PendingTask<TRequest, TResult> = { id, request, resolve, reject };
      this.tasks.set(id, pending);
      this.waiting.push(pending);
      this.dispatch();
    });
  }

  /**
   * 取消这一批:停止派发,在途与排队任务全部 reject(「已取消」)。
   *
   * 刻意**不 terminate** Worker——销毁是调用方的决定(它可能还要读已回传的结果)。
   * 被 reject 的在途任务若稍后真有产物寄回,配对表里已经没有它,产物被丢弃。
   */
  cancel(): void {
    if (this.phase !== "active") return;
    this.phase = "cancelled";
    this.rejectAll(new Error(CANCELLED_MESSAGE));
  }

  /** 销毁全部 Worker,池进入终态:此后 size 为 0、run 一律 reject。 */
  terminate(): void {
    if (this.phase === "terminated") return;
    this.phase = "terminated";
    this.rejectAll(new Error(TERMINATED_MESSAGE));
    for (const worker of this.living) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    this.runningTaskId.clear();
    this.living.length = 0;
  }

  /** 取消与终止共用:排队与在途任务全部 reject,并清空配对状态。 */
  private rejectAll(reason: Error): void {
    this.waiting.length = 0;
    for (const pending of this.tasks.values()) pending.reject(reason);
    this.tasks.clear();
    for (const worker of this.runningTaskId.keys()) this.runningTaskId.set(worker, null);
  }

  /**
   * 派发循环:先把手里的任务塞给空闲 Worker;一个都不空闲且还没到并发上限才新建。
   *
   * 「没有空闲 Worker」等价于「在途任务数 ≥ 已创建数」——每个 Worker 至多跑一个任务,
   * 两条判据不会给出不同结论,这里取实现上直接可读的那条。
   */
  private dispatch(): void {
    while (this.waiting.length > 0 && this.phase === "active") {
      const idle = this.living.find((worker) => this.runningTaskId.get(worker) === null);
      if (idle) {
        const pending = this.waiting.shift();
        if (pending) this.assign(idle, pending);
        continue;
      }
      if (this.living.length >= this.concurrency) return;
      const pending = this.waiting.shift();
      if (!pending) return;
      const created = this.spawn();
      if (created) {
        this.assign(created, pending);
        continue;
      }
      // Worker 建不起来(极端环境 / 产物缺失):立即 reject 这一个。让它无声排队的话,
      // 整批会挂在同一个原因上,用户只看到「卡住」而不是「失败」。
      this.tasks.delete(pending.id);
      pending.reject(new Error("无法创建渲染 Worker, 请刷新页面后重试。"));
    }
  }

  private spawn(): PoolWorkerLike<TRequest> | null {
    let worker: PoolWorkerLike<TRequest>;
    try {
      worker = this.createWorker();
    } catch {
      return null;
    }
    this.living.push(worker);
    this.runningTaskId.set(worker, null);
    // 在创建点绑处理器:闭包持有 worker 自身,回报才能按「谁回的」做配对与摘除。
    worker.onmessage = (event: MessageEvent) => {
      this.handleReply(worker, event);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.handleWorkerCrash(worker, event);
    };
    return worker;
  }

  private assign(worker: PoolWorkerLike<TRequest>, pending: PendingTask<TRequest, TResult>): void {
    this.runningTaskId.set(worker, pending.id);
    const message: PoolDispatchMessage<TRequest> = {
      type: "render",
      id: pending.id,
      request: pending.request
    };
    try {
      worker.postMessage(message);
    } catch (cause) {
      // 投递即抛 = 消息通道已断, 与崩溃同处理: 摘除它, 否则它会一直「在忙」把并发吃光。
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.settleError(pending.id, new Error(`渲染任务投递失败 (${reason})`));
      this.evict(worker);
    }
  }

  /**
   * 回报配对:只认「本 Worker 当前在跑的那个 id」。
   *
   * 三个丢弃分支都必要:串台(回了不属于自己的 id)、重复回报(任务已 settle)、
   * 取消后迟到的产物(配对表已清空)。任何一种若被接受,都会把别人的产物交给这个 Promise。
   */
  private handleReply(worker: PoolWorkerLike<TRequest>, event: MessageEvent): void {
    const message = event.data as PoolReplyMessage<TResult> | undefined;
    if (!message || typeof message.id !== "number") return;
    if (this.runningTaskId.get(worker) !== message.id) return;
    if (message.type !== "result" && message.type !== "error") return;
    const pending = this.tasks.get(message.id);
    if (!pending) return;
    this.tasks.delete(message.id);
    this.runningTaskId.set(worker, null);
    if (message.type === "result") pending.resolve(message.result);
    else pending.reject(new Error(message.message || WORKER_DIED_MESSAGE));
    this.dispatch();
  }

  private settleError(id: number, reason: Error): void {
    const pending = this.tasks.get(id);
    if (!pending) return;
    this.tasks.delete(id);
    pending.reject(reason);
  }

  /**
   * Worker 崩溃(脚本加载失败、内部未捕获异常、被系统回收):
   * reject 它手上那个任务 → 摘除它 → 继续派发。后续任务不再派给这张坏 Worker,整批不会因它
   * 挂死;并发额度由 dispatch 在需要时自然补建。
   */
  private handleWorkerCrash(worker: PoolWorkerLike<TRequest>, event: ErrorEvent): void {
    const failedId = this.runningTaskId.get(worker);
    this.runningTaskId.set(worker, null);
    if (failedId !== null && failedId !== undefined) {
      this.settleError(failedId, new Error(event?.message || WORKER_DIED_MESSAGE));
    }
    this.evict(worker);
    this.dispatch();
  }

  /** 从存活集合摘除:此后 dispatch 不会再选它,size 也不再计入它。 */
  private evict(worker: PoolWorkerLike<TRequest>): void {
    const index = this.living.indexOf(worker);
    if (index >= 0) this.living.splice(index, 1);
    this.runningTaskId.delete(worker);
  }
}
