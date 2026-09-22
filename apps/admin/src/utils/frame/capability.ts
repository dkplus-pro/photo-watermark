// 浏览器能力探测与内存感知并发(D6):canvas 面积上限靠探测、并发数按内存预算算。
// 本模块只允许 import types.ts 与 constants(Worker 与 node 单测里都要能独立运行)。

import { MOBILE_BREAKPOINT } from "../../constants";
import {
  BYTES_PER_PIXEL_JOB,
  CANVAS_AREA_CANDIDATES,
  DEFAULT_SIZE_TIER,
  FALLBACK_CANVAS_AREA,
  MAX_CONCURRENCY,
  MEMORY_BUDGET_DESKTOP,
  MEMORY_BUDGET_MOBILE,
  SIZE_TIERS
} from "./types";
import type {
  IsMobileEnvironment,
  MemoryAwareConcurrency,
  ProbeMaxCanvasArea,
  ResolveOutputSize,
  SizeTierDefinition,
  SizeTierKey,
  SupportsWorkerRendering
} from "./types";

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

// ---------------------------------------------------------------- 移动端判定

// iOS Safari 老机型 UA 里已无 "iPad"(桌面模式),故 iPad 判定靠 touchPoints + 视口宽兜底。
const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile/iu;

/**
 * 是否移动端环境。两条判定任一命中即 true:
 * 1. UA 正则;2. 多点触控 + 视口窄于断点(覆盖 iPadOS「请求桌面网站」下 UA 是 Macintosh 的形态)。
 * 全部取值带 typeof 守卫:本站是 SPA,但纯逻辑用例跑在 node 环境,裸读 navigator/window 会 ReferenceError。
 */
export const isMobileEnvironment: IsMobileEnvironment = () => {
  if (typeof navigator !== "undefined") {
    if (MOBILE_UA_PATTERN.test(navigator.userAgent ?? "")) return true;
    if (typeof window !== "undefined") {
      const maxTouchPoints = navigator.maxTouchPoints ?? 0;
      if (maxTouchPoints > 1 && window.innerWidth < MOBILE_BREAKPOINT) return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------- Worker 渲染支持

let workerSupportCache: boolean | null = null;

/**
 * 主线程能否把渲染整包交给 Worker。四个条件缺一不可:
 * Worker 建不了 / OffscreenCanvas 画不了 / createImageBitmap 解不了 / FontFace 注册不了,
 * 任何一种的后果都是 Worker 渲染「静默产出空白图」——比抛错更难排查,所以宁可在特性检测层就降级串行。
 * 只做特性检测,不 new Worker 试跑(创建即销毁一个 Worker 的成本远高于一次 typeof)。
 */
export const supportsWorkerRendering: SupportsWorkerRendering = () => {
  if (workerSupportCache !== null) return workerSupportCache;
  workerSupportCache =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined" &&
    typeof FontFace !== "undefined";
  return workerSupportCache;
};

/** 清除 Worker 支持缓存,仅供单测在「改环境后断言缓存仍生效」的场景使用。 */
export const resetWorkerSupportCache = (): void => {
  workerSupportCache = null;
};

// ---------------------------------------------------------------- canvas 面积探测

// 探测用的最小画布形状:OffscreenCanvas 与 HTMLCanvasElement 在本模块内只用到这些成员,
// 用结构类型统一表达,避免依赖 lib.webworker(tsconfig 只配了 DOM + ES2022)。
interface ProbeContextLike {
  fillStyle?: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: ArrayLike<number> };
}

interface ProbeCanvasLike {
  width: number;
  height: number;
  getContext(contextId: string): ProbeContextLike | null;
}

type OffscreenCanvasLikeConstructor = new (width: number, height: number) => ProbeCanvasLike;

const getOffscreenCtor = (): OffscreenCanvasLikeConstructor | null => {
  const candidate = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  return typeof candidate === "function" ? (candidate as OffscreenCanvasLikeConstructor) : null;
};

const createDomProbeCanvas = (): ProbeCanvasLike | null => {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  try {
    return document.createElement("canvas") as unknown as ProbeCanvasLike;
  } catch {
    return null;
  }
};

const createProbeCanvas = (side: number): ProbeCanvasLike | null => {
  const offscreenCtor = getOffscreenCtor();
  if (offscreenCtor) {
    // 优先 OffscreenCanvas:探测结果要同时服务 Worker 内的渲染画布,
    // Worker 里只有 OffscreenCanvas 可用,拿它探测的边界才是渲染真正会撞上的边界。
    try {
      return new offscreenCtor(side, side);
    } catch {
      // 构造失败按该候选不可用处理,继续尝试 DOM 画布
    }
  }
  const canvas = createDomProbeCanvas();
  if (!canvas) return null;
  canvas.width = side;
  canvas.height = side;
  return canvas;
};

const releaseProbeCanvas = (canvas: ProbeCanvasLike): void => {
  // 必须显式把宽高归零:多数浏览器只在尺寸变化时释放 canvas 的 backing store,
  // 坐等 GC 回收是未定义行为。探测会连续分配 25MP(约 100MB)级缓冲,
  // 不逐档释放的话探测过程本身就能把移动端推到 jetsam 边缘。
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // 释放失败不影响探测结论,忽略
  }
};

const probeCandidatePasses = (canvas: ProbeCanvasLike): boolean => {
  try {
    const context = canvas.getContext("2d");
    if (!context) return false;
    // 只确认 context 非 null 不够:超限的浏览器不报错,而是静默给一块全空白画布。
    // 画一个不透明像素再回读,读到非全零才算这块画布真的可写可读。
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 1, 1);
    const { data } = context.getImageData(0, 0, 1, 1);
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0) return true;
    }
    return false;
  } catch {
    // 任何异常(fill/getImageData 抛错)都视为该候选超限,交给调用方继续下一档
    return false;
  }
};

const runCanvasAreaProbe = (): number => {
  for (const area of CANVAS_AREA_CANDIDATES) {
    const side = Math.round(Math.sqrt(area));
    const canvas = createProbeCanvas(side);
    if (!canvas) continue;
    try {
      if (probeCandidatePasses(canvas)) return area;
    } finally {
      releaseProbeCanvas(canvas);
    }
  }
  return FALLBACK_CANVAS_AREA;
};

let maxCanvasAreaPromise: Promise<number> | null = null;

/**
 * 探测当前浏览器可用的最大 canvas 面积(像素数)。
 *
 * 从 CANVAS_AREA_CANDIDATES 大到小逐档试:建 1:1 画布、画一个不透明像素、回读非全零才算通过
 * (iOS Safari 老机型 5MP、新机型 16-25MP、部分安卓 WebView 25MP,超限行为是静默空白而非报错)。
 * 全生命周期只探测一次并 memoize 同一个 Promise(并发调用只触发一次探测);
 * 返回值恒为正数、永不 reject——探测失败最保守也是 FALLBACK_CANVAS_AREA,不能让导出链死在这。
 */
export const probeMaxCanvasArea: ProbeMaxCanvasArea = () => {
  if (!maxCanvasAreaPromise) {
    maxCanvasAreaPromise = (async () => {
      try {
        return runCanvasAreaProbe();
      } catch {
        return FALLBACK_CANVAS_AREA;
      }
    })();
  }
  return maxCanvasAreaPromise;
};

/** 清除面积探测缓存,仅供单测使用。 */
export const resetMaxCanvasAreaCache = (): void => {
  maxCanvasAreaPromise = null;
};

// ---------------------------------------------------------------- 输出尺寸(D3)

/**
 * 按档位与浏览器面积上限,算出等比缩放的输出尺寸。**只缩不放**:
 * 用户要的是原图(决策 D3/D4),插值放大是失真,源图像素不超配额时一律原样输出。
 */
export const resolveOutputSize: ResolveOutputSize = (
  sourceWidth,
  sourceHeight,
  tier,
  maxCanvasArea
) => {
  if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) {
    return { width: 0, height: 0 };
  }
  // 未知 tier 回落 medium:tier 来自 localStorage 持久化,可能被用户手改坏;
  // 输出尺寸只是体验参数,回落比抛错友好。注意这与 getFrameStyle 的严格性不同——
  // 样式 id 决定像素级绘制内容,错用样式会产出错误成品,所以那边必须返回 null 交上层拦截。
  const tierDefinition: SizeTierDefinition =
    SIZE_TIERS[tier as SizeTierKey] ?? SIZE_TIERS[DEFAULT_SIZE_TIER];
  const sourcePixels = sourceWidth * sourceHeight;
  // maxCanvasArea 非法(NaN/0/负)时视作无上限,只受档位约束:探测结果的缺失不该放大成尺寸错误。
  const canvasCap = isPositiveFinite(maxCanvasArea) ? maxCanvasArea : Number.POSITIVE_INFINITY;
  const targetPixels = Math.min(tierDefinition.maxPixels, canvasCap, sourcePixels);
  if (sourcePixels <= targetPixels) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.sqrt(targetPixels / sourcePixels);
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  if (width * height <= targetPixels) {
    return { width, height };
  }
  // floor 之后乘积仍可能越界:1×N 这类极端长条,短边被 Math.max(1, …) 钉死在 1,
  // 缩放全落在长边上,floor 误差让长边超出配额。语义等价于「较大边逐 1 递减直到达标」
  // 的循环收敛,但逐减要上百万次迭代,故一次除法直接收敛到循环终点:长边 = floor(配额 / 短边)。
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(1, Math.floor(targetPixels / shortEdge));
  return width <= height
    ? { width: shortEdge, height: longEdge }
    : { width: longEdge, height: shortEdge };
};

// ---------------------------------------------------------------- 内存感知并发

/**
 * 按内存预算给出导出并发数(不用 hardwareConcurrency:一个 24MP 任务在途约 192MB,
 * 按 8 核开机会在移动端被系统杀页)。
 *
 * **前提**:width/height 必须是 `resolveOutputSize` 算出的**输出尺寸**而非源图尺寸——
 * 解码期缩放(D20)后驻留内存的是输出画布,按源图算会把小档位的并发错误地压到 1。
 */
export const memoryAwareConcurrency: MemoryAwareConcurrency = (width, height, jobCount) => {
  const tasks = Number.isFinite(jobCount) ? Math.floor(jobCount) : 0;
  if (tasks <= 0) {
    // 与下方「至少 1」是不同的边界:没有任务就不该拉起任何 Worker,返回 0 让池直接短路。
    return 0;
  }
  const pixels = isPositiveFinite(width * height) ? width * height : 1;
  const perJobBytes = pixels * BYTES_PER_PIXEL_JOB;
  const budget = isMobileEnvironment() ? MEMORY_BUDGET_MOBILE : MEMORY_BUDGET_DESKTOP;
  const capacity = Math.floor(budget / perJobBytes);
  return Math.max(1, Math.min(MAX_CONCURRENCY, tasks, capacity));
};
