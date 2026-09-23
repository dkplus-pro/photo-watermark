import { loadFrameFonts } from "./fonts";
import { renderFrame } from "./render-core";
import type { FrameWorkerMessage, FrameWorkerResult, RenderSurface } from "./types";

/**
 * 渲染 Worker 入口(阶段 9)。
 *
 * 本文件运行在 **Worker 全局**,不在主线程:唯一的入口是 `onmessage`,唯一的出口是
 * `postMessage`,没有 window/document,数据只经消息传递(字节随 `Blob` 结构化克隆过来,
 * 因此这里禁止任何 fetch——源图、logo、字体之外的资源都不存在于本上下文)。
 *
 * tsconfig 的 lib 只有 DOM + ES2022、没有 lib.webworker,所以 `self` 在类型上是 Window、
 * `DedicatedWorkerGlobalScope` 也不存在。这里按「实际用到的成员」声明一个最小结构类型,
 * 并从 `globalThis` 上取:Worker 运行时 `globalThis` 就是 Worker 全局对象,`onmessage`
 * 与 `postMessage(message)` 的语义与 DOM 下的 Window 一致,类型上也不再撒谎。
 * 不要改成 `/// <reference lib="webworker" />`:那会让整个 admin 工程的 `self` 变成
 * WorkerGlobalScope,主线程侧的 DOM 类型随即全崩。
 */
interface WorkerScopeLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = globalThis as unknown as WorkerScopeLike;

/** Worker 侧渲染面:画布用 OffscreenCanvas,字体注册在 Worker 自己的 FontFaceSet 上。 */
const workerSurface: RenderSurface = {
  createCanvas: (width, height) => new OffscreenCanvas(width, height),
  // 字体清单是模块级常量 FRAME_FONTS(见 fonts.ts),整套注册才有意义,所以这里不接受入参。
  loadFonts: () => loadFrameFonts(globalThis)
};

/**
 * 回一条消息给主线程。
 *
 * `postMessage` 自身抛错(产物含不可克隆值)时补一条 error 回报:池按 id 配对在途任务,
 * 收不到回报的那一张会永久占住这个 worker,整批导出就挂死在这里。
 */
const post = (message: FrameWorkerMessage): void => {
  try {
    scope.postMessage(message);
  } catch (cause) {
    if (message.type !== "result") return;
    const reason = cause instanceof Error ? cause.message : String(cause);
    scope.postMessage({
      type: "error",
      id: message.id,
      message: `渲染产物无法回传主线程 (${reason})`
    });
  }
};

/**
 * 处理一张:任何路径都必须回报——成功 result、失败 error,没有第三种出口。
 * 「不回报」不是「这张失败」而是「整批卡住」,所以这里连异常都不往外抛。
 */
const handleRender = async (message: Extract<FrameWorkerMessage, { type: "render" }>) => {
  const { id, request } = message;
  try {
    const result: FrameWorkerResult = await renderFrame(request, workerSurface);
    post({ type: "result", id, result });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    post({ type: "error", id, message: reason || "渲染失败。" });
  }
};

scope.onmessage = (event: MessageEvent): void => {
  const message = event.data as FrameWorkerMessage | undefined;
  // 不认识的消息:主线程侧没有在途任务与之对应,不回消息不会挂住池。
  // id 非数字时同样丢弃——连回报目标都没有,乱回一个 id 反而会 settle 掉别人的任务。
  if (!message || message.type !== "render" || typeof message.id !== "number") return;
  void handleRender(message);
};
