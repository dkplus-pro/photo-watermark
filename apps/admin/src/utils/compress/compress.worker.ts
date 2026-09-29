import { compressImage } from "./compress-core";
import type { CompressRequest, CompressResult } from "./compress-core";
import type { PoolDispatchMessage, PoolReplyMessage } from "../worker-pool";

/**
 * 压缩 Worker 入口(结构与 frame.worker.ts 同一范式,纪律见那边):
 * 运行在 Worker 全局,唯一入口 onmessage、唯一出口 postMessage,没有 window/document。
 *
 * tsconfig 的 lib 没有 lib.webworker,`self` 在类型上是 Window;这里按「实际用到的成员」
 * 声明最小结构类型并从 globalThis 取,不引入 `/// <reference lib="webworker" />`
 * (那会把整个 admin 工程的 `self` 变成 WorkerGlobalScope,主线程 DOM 类型全崩)。
 */
interface WorkerScopeLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = globalThis as unknown as WorkerScopeLike;

/**
 * postMessage 自身抛错(产物含不可克隆值)时补一条 error 回报:池按 id 配对在途任务,
 * 收不到回报的那个任务会永久占住 Worker,整批就挂死在这里。
 */
const post = (message: PoolReplyMessage<CompressResult> | PoolDispatchMessage<never>): void => {
  try {
    scope.postMessage(message);
  } catch (cause) {
    if (message.type !== "result") return;
    const reason = cause instanceof Error ? cause.message : String(cause);
    scope.postMessage({
      type: "error",
      id: message.id,
      message: `压缩产物无法回传主线程 (${reason})`
    });
  }
};

/**
 * 处理一张:任何路径都必须回报——成功 result、失败 error,没有第三种出口。
 * 「不回报」不是「这张失败」而是「整批卡住」,所以这里连异常都不往外抛。
 */
const handleCompress = async (message: {
  readonly id: number;
  readonly request: CompressRequest;
}): Promise<void> => {
  const { id, request } = message;
  try {
    const result: CompressResult = await compressImage(request);
    post({ type: "result", id, result });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    post({ type: "error", id, message: reason || "压缩失败。" });
  }
};

scope.onmessage = (event: MessageEvent): void => {
  const message = event.data as PoolDispatchMessage<CompressRequest> | undefined;
  // 不认识的消息:主线程侧没有在途任务与之对应,不回消息不会挂住池。
  // id 非数字时同样丢弃——连回报目标都没有,乱回一个 id 反而会 settle 掉别人的任务。
  if (!message || message.type !== "render" || typeof message.id !== "number") return;
  void handleCompress(message);
};
