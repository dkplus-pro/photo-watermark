import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMobileEnvironment,
  memoryAwareConcurrency,
  probeMaxCanvasArea,
  resetMaxCanvasAreaCache,
  resetWorkerSupportCache,
  resolveOutputSize,
  supportsWorkerRendering
} from "../../../src/utils/frame/capability";
import {
  CANVAS_AREA_CANDIDATES,
  FALLBACK_CANVAS_AREA,
  MAX_CONCURRENCY,
  SIZE_TIERS
} from "../../../src/utils/frame/types";
import type { SizeTierKey } from "../../../src/utils/frame/types";

/**
 * 能力探测与内存感知并发单测(阶段 5)。
 * 全部用注入的假 OffscreenCanvas / document / navigator 驱动分支,不依赖真实浏览器行为
 * (jsdom 没有 2d canvas 实现,真机 canvas 上限也不该由单测负责)。
 * 六类边界中「网络失败」「权限缺失」对本模块不适用:探测是纯本地同步逻辑,无请求、无鉴权。
 */

// ---------------------------------------------------------------- 假 canvas 装置

interface FakeCanvasOptions {
  /** 面积 >= 该值的候选 getContext("2d") 抛错(模拟分配失败) */
  throwFromArea?: number;
  /** 面积 >= 该值的候选 getContext 返回 null(模拟超限拿不到上下文) */
  nullContextFromArea?: number;
  /** 面积 >= 该值的候选回读全零(模拟部分浏览器超限不报错、静默给空白画布) */
  blankFromArea?: number;
}

interface FakeCanvasInstance {
  width: number;
  height: number;
}

const createFakeCanvasClass = (
  options: FakeCanvasOptions,
  created: FakeCanvasInstance[]
): unknown => {
  return class FakeProbeCanvas {
    width: number;
    height: number;

    constructor(width = 0, height = 0) {
      this.width = width;
      this.height = height;
      created.push(this as unknown as FakeCanvasInstance);
    }

    getContext(contextId: string): unknown {
      if (contextId !== "2d") return null;
      const area = this.width * this.height;
      if (options.throwFromArea !== undefined && area >= options.throwFromArea) {
        throw new Error("模拟画布缓冲分配失败");
      }
      if (options.nullContextFromArea !== undefined && area >= options.nullContextFromArea) {
        return null;
      }
      const blank = options.blankFromArea !== undefined && area >= options.blankFromArea;
      let painted = false;
      return {
        fillStyle: "",
        fillRect: () => {
          if (!blank) painted = true;
        },
        getImageData: () => ({ data: painted ? [255, 0, 0, 255] : [0, 0, 0, 0] })
      };
    }
  };
};

const stubOffscreenCanvas = (options: FakeCanvasOptions, created: FakeCanvasInstance[]): void => {
  vi.stubGlobal("OffscreenCanvas", createFakeCanvasClass(options, created));
};

const stubDomCanvas = (options: FakeCanvasOptions, created: FakeCanvasInstance[]): void => {
  const FakeCanvas = createFakeCanvasClass(options, created) as new () => unknown;
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return new FakeCanvas() as unknown as HTMLCanvasElement;
    return original(tag);
  });
};

// ---------------------------------------------------------------- probeMaxCanvasArea

describe("probeMaxCanvasArea", () => {
  let created: FakeCanvasInstance[];

  beforeEach(() => {
    created = [];
    resetMaxCanvasAreaCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("回读全零视为超限,落到第一个可读写的小档位", async () => {
    // 面积 >= 8,000,000 的候选静默空白:25.1M/16.7M/8.3M 三档失败,4.1M 通过
    // (阈值刻意落在候选面积之间:探测按 1:1 边长取整,实际试的面积与候选值有取整差)
    stubOffscreenCanvas({ blankFromArea: 8_000_000 }, created);
    await expect(probeMaxCanvasArea()).resolves.toBe(4_194_304);
    // 从大到小逐档试探,前 4 档各建一块画布
    expect(created).toHaveLength(4);
  });

  it("getContext 返回 null 时继续下一个候选", async () => {
    stubOffscreenCanvas({ nullContextFromArea: 25_165_824 }, created);
    await expect(probeMaxCanvasArea()).resolves.toBe(16_777_216);
    expect(created).toHaveLength(2);
  });

  it("候选探测抛错算该候选失败并继续", async () => {
    stubOffscreenCanvas({ throwFromArea: 25_165_824, blankFromArea: 16_000_000 }, created);
    await expect(probeMaxCanvasArea()).resolves.toBe(8_388_608);
    expect(created).toHaveLength(3);
  });

  it("OffscreenCanvas 与 DOM 画布都不可用时返回兜底面积", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", undefined);
    await expect(probeMaxCanvasArea()).resolves.toBe(FALLBACK_CANVAS_AREA);
  });

  it("没有 OffscreenCanvas 时退回 document.createElement 的画布探测", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    stubDomCanvas({ blankFromArea: 8_000_000 }, created);
    await expect(probeMaxCanvasArea()).resolves.toBe(4_194_304);
    expect(created.length).toBeGreaterThan(0);
  });

  it("全部候选失败返回 FALLBACK_CANVAS_AREA 且永不 reject", async () => {
    stubOffscreenCanvas({ blankFromArea: 1 }, created);
    const area = await probeMaxCanvasArea();
    expect(area).toBe(FALLBACK_CANVAS_AREA);
    expect(area).toBeGreaterThan(0);
    expect(created).toHaveLength(CANVAS_AREA_CANDIDATES.length);
  });

  it("memoize:第二次调用与并发调用都复用同一次探测", async () => {
    stubOffscreenCanvas({ blankFromArea: 8_000_000 }, created);
    const [first, second] = await Promise.all([probeMaxCanvasArea(), probeMaxCanvasArea()]);
    expect(first).toBe(4_194_304);
    expect(second).toBe(first);
    const probesAfterFirst = created.length;
    await expect(probeMaxCanvasArea()).resolves.toBe(first);
    expect(created).toHaveLength(probesAfterFirst); // 第二次没有再建任何画布
  });

  it("每试完一个候选立刻把画布宽高归零释放缓冲", async () => {
    stubOffscreenCanvas({ blankFromArea: 8_388_608 }, created);
    await probeMaxCanvasArea();
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------- resolveOutputSize

describe("resolveOutputSize", () => {
  const UNLIMITED_CANVAS = Number.POSITIVE_INFINITY;

  it("源图像素不超档位配额时原样输出、绝不放大(D3/D4)", () => {
    expect(resolveOutputSize(500, 400, "original", UNLIMITED_CANVAS)).toEqual({
      width: 500,
      height: 400
    });
  });

  it("三档各自等比缩小且乘积不越配额", () => {
    const tiers: readonly SizeTierKey[] = ["original", "medium", "small"];
    for (const tier of tiers) {
      const out = resolveOutputSize(8000, 6000, tier, UNLIMITED_CANVAS);
      expect(out.width * out.height).toBeLessThanOrEqual(SIZE_TIERS[tier].maxPixels);
      // 等比:宽高比误差只在取整引入的范围内
      expect(Math.abs(out.width / out.height - 8000 / 6000)).toBeLessThan(0.01);
    }
    // 8000×6000 恰好 48MP,original 档 24MP = 精确 0.5 倍面积 → 比例 1/√2
    expect(resolveOutputSize(8000, 6000, "original", UNLIMITED_CANVAS)).toEqual({
      width: 5656,
      height: 4242
    });
    expect(resolveOutputSize(8000, 6000, "medium", UNLIMITED_CANVAS)).toEqual({
      width: 4000,
      height: 3000
    });
    expect(resolveOutputSize(8000, 6000, "small", UNLIMITED_CANVAS)).toEqual({
      width: 2000,
      height: 1500
    });
  });

  it("maxCanvasArea 比档位更紧时以探测面积为准", () => {
    const out = resolveOutputSize(8000, 6000, "original", 4_194_304);
    expect(out.width * out.height).toBeLessThanOrEqual(4_194_304);
  });

  it("1×100000 长条图不超配额时原样输出", () => {
    expect(resolveOutputSize(1, 100_000, "medium", UNLIMITED_CANVAS)).toEqual({
      width: 1,
      height: 100_000
    });
  });

  it("1×N 极端长条超配额时短边钉在 1、长边复核收敛且不越界", () => {
    // 1×30M:短边 floor 后被 Math.max(1, …) 反弹,复核必须把长边压回配额内
    const out = resolveOutputSize(1, 30_000_000, "original", UNLIMITED_CANVAS);
    expect(out.width).toBe(1);
    expect(out.height).toBe(24_000_000);
    expect(out.width * out.height).toBeLessThanOrEqual(SIZE_TIERS.original.maxPixels);
  });

  it("极端非整除缩放(4033×3023 中档)乘积不越界", () => {
    const out = resolveOutputSize(4033, 3023, "medium", UNLIMITED_CANVAS);
    expect(out.width * out.height).toBeLessThanOrEqual(SIZE_TIERS.medium.maxPixels);
    expect(out.width).toBeLessThan(4033);
    expect(out.height).toBeLessThan(3023);
  });

  it("源尺寸非法(0/负数/NaN/Infinity)返回 {0,0} 且不抛错", () => {
    const invalid: readonly number[] = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const width of invalid) {
      expect(resolveOutputSize(width, 400, "medium", UNLIMITED_CANVAS)).toEqual({
        width: 0,
        height: 0
      });
      expect(resolveOutputSize(600, width, "medium", UNLIMITED_CANVAS)).toEqual({
        width: 0,
        height: 0
      });
    }
  });

  it("未知 tier 回落 medium,非法 maxCanvasArea 视作无上限", () => {
    const unknownTier = "bogus" as SizeTierKey;
    expect(resolveOutputSize(8000, 6000, unknownTier, UNLIMITED_CANVAS)).toEqual(
      resolveOutputSize(8000, 6000, "medium", UNLIMITED_CANVAS)
    );
    for (const badCap of [Number.NaN, 0, -5]) {
      const out = resolveOutputSize(8000, 6000, "medium", badCap);
      expect(out.width * out.height).toBeLessThanOrEqual(SIZE_TIERS.medium.maxPixels);
    }
  });
});

// ---------------------------------------------------------------- memoryAwareConcurrency

describe("memoryAwareConcurrency", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubEnvironment = (mobile: boolean): void => {
    vi.stubGlobal(
      "navigator",
      mobile
        ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 }
        : {
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126",
            maxTouchPoints: 0
          }
    );
  };

  it("24MP 输出在桌面 512MB 预算下并发为 2(每任务约 192MB)", () => {
    stubEnvironment(false);
    expect(memoryAwareConcurrency(6000, 4000, 8)).toBe(2);
  });

  it("24MP 输出在移动 128MB 预算下压到 1(容量算出 0 也要留一条通道)", () => {
    stubEnvironment(true);
    expect(memoryAwareConcurrency(6000, 4000, 8)).toBe(1);
  });

  it("3MP 输出容量远超上限,被 MAX_CONCURRENCY 截断", () => {
    stubEnvironment(false);
    const concurrency = memoryAwareConcurrency(2000, 1500, 20);
    expect(concurrency).toBe(MAX_CONCURRENCY);
  });

  it("12MP 输出桌面容量 5,仍被 MAX_CONCURRENCY 截断为 4", () => {
    stubEnvironment(false);
    expect(memoryAwareConcurrency(4000, 3000, 20)).toBe(4);
  });

  it("任务数少于容量时以任务数为准", () => {
    stubEnvironment(false);
    expect(memoryAwareConcurrency(2000, 1500, 1)).toBe(1);
  });

  it("jobCount 为 0 或负数返回 0:没有任务就不该拉起 Worker", () => {
    stubEnvironment(false);
    expect(memoryAwareConcurrency(2000, 1500, 0)).toBe(0);
    expect(memoryAwareConcurrency(2000, 1500, -3)).toBe(0);
  });
});

// ---------------------------------------------------------------- isMobileEnvironment

describe("isMobileEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("iOS Safari UA 命中即 true", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      maxTouchPoints: 5
    });
    expect(isMobileEnvironment()).toBe(true);
  });

  it("iPadOS 桌面模式(UA 是 Macintosh)+ 多点触控 + 窄视口判为移动", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5
    });
    vi.stubGlobal("window", { innerWidth: 390 });
    expect(isMobileEnvironment()).toBe(true);
  });

  it("桌面 Chrome(单点或零触控)为 false", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36",
      maxTouchPoints: 0
    });
    vi.stubGlobal("window", { innerWidth: 1920 });
    expect(isMobileEnvironment()).toBe(false);
  });

  it("navigator/window 缺失(node 环境)返回 false 且不抛 ReferenceError", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("window", undefined);
    expect(isMobileEnvironment()).toBe(false);
  });
});

// ---------------------------------------------------------------- supportsWorkerRendering

describe("supportsWorkerRendering", () => {
  const WORKER_CAPABILITIES = [
    "Worker",
    "OffscreenCanvas",
    "createImageBitmap",
    "FontFace"
  ] as const;

  const stubAllPresent = (): void => {
    for (const key of WORKER_CAPABILITIES) {
      vi.stubGlobal(key, class {});
    }
  };

  beforeEach(() => {
    resetWorkerSupportCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("四项能力齐备返回 true", () => {
    stubAllPresent();
    expect(supportsWorkerRendering()).toBe(true);
  });

  it.each(WORKER_CAPABILITIES)("缺失 %s 时返回 false(缺一不可)", (missing) => {
    stubAllPresent();
    vi.stubGlobal(missing, undefined);
    expect(supportsWorkerRendering()).toBe(false);
  });

  it("结果缓存:环境变化后返回值不变,直到 reset 才重探", () => {
    stubAllPresent();
    expect(supportsWorkerRendering()).toBe(true);
    vi.stubGlobal("Worker", undefined);
    expect(supportsWorkerRendering()).toBe(true); // 缓存生效
    resetWorkerSupportCache();
    expect(supportsWorkerRendering()).toBe(false); // reset 后按新环境重探
  });
});
