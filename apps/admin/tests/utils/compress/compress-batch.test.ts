import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 压缩批处理用例。替身只打在模块边界(测试纪律):
 * - compress-core(compressImage):单张执行的成败;
 * - compress-pool(supportsCompressWorker / createCompressPool):Worker 路径开关与池替身;
 * - webp-support(supportsWebpEncoding):格式决策的 WebP 支持度;
 * - frame/image-size-probe(readProbeHeadBytes):头部读取(null → 按保守透明口径)。
 * 池自身的调度与配对逻辑已由 tests/utils/frame/worker-pool.test.ts 覆盖,这里不重复。
 *
 * 六类边界对照:空值(空批次)、零值(0 尺寸条目走保守并发口径)、越界(失败隔离/取消后不回报)、
 * 权限缺失不适用(本站无鉴权)、网络失败(单张抛错收敛为失败记录)、
 * 非法状态迁移(取消后迟到产物不回报、不再派发)。
 */

const h = vi.hoisted(() => ({
  compressImage: vi.fn(),
  supportsCompressWorker: vi.fn(),
  createCompressPool: vi.fn(),
  supportsWebpEncoding: vi.fn(),
  readProbeHeadBytes: vi.fn()
}));

vi.mock("../../../src/utils/compress/compress-core", () => ({ compressImage: h.compressImage }));
vi.mock("../../../src/utils/compress/compress-pool", () => ({
  supportsCompressWorker: h.supportsCompressWorker,
  createCompressPool: h.createCompressPool
}));
vi.mock("../../../src/utils/compress/webp-support", () => ({
  supportsWebpEncoding: h.supportsWebpEncoding
}));
vi.mock("../../../src/utils/frame/image-size-probe", () => ({
  readProbeHeadBytes: h.readProbeHeadBytes
}));

import {
  createCompressCancelToken,
  runCompressBatch
} from "../../../src/utils/compress/compress-batch";
import type {
  CompressBatchItem,
  CompressBatchSettings
} from "../../../src/utils/compress/compress-batch";
import type { CompressRequest } from "../../../src/utils/compress/compress-core";

const settings: CompressBatchSettings = { mode: "smart", qualityPercent: 80 };

const item = (
  name: string,
  mime = "image/jpeg",
  size = 3,
  width = 0,
  height = 0
): CompressBatchItem => ({
  id: name,
  file: new File([new Uint8Array(size)], name, { type: mime }),
  width,
  height
});

const echoResult = (request: CompressRequest) => ({
  blob: new Blob([request.fileName]),
  width: 10,
  height: 10,
  mime: request.mime
});

beforeEach(() => {
  vi.clearAllMocks();
  h.readProbeHeadBytes.mockResolvedValue(null);
  h.supportsWebpEncoding.mockResolvedValue(true);
  h.supportsCompressWorker.mockReturnValue(false);
});

describe("主线程降级路径", () => {
  it("串行逐张压缩,回报 started/done,tally 收口", async () => {
    const order: string[] = [];
    h.compressImage.mockImplementation(async (request: CompressRequest) => {
      order.push(request.fileName);
      return echoResult(request);
    });
    const started: string[] = [];
    const done: string[] = [];
    const tally = await runCompressBatch(
      [item("a.jpg"), item("b.png", "image/png"), item("c.webp", "image/webp")],
      settings,
      { onItemStarted: (id) => started.push(id), onItemDone: (r) => done.push(r.id) }
    );
    expect(order).toEqual(["a.jpg", "b.png", "c.webp"]);
    expect(started).toEqual(["a.jpg", "b.png", "c.webp"]);
    expect(done).toEqual(["a.jpg", "b.png", "c.webp"]);
    expect(tally).toEqual({ succeeded: 3, failed: 0, cancelled: false });
    expect(h.createCompressPool).not.toHaveBeenCalled();
  });

  it("请求携带格式决策:png+透明 走 webp 不垫底,jpeg 显式模式垫白底", async () => {
    const requests: CompressRequest[] = [];
    h.compressImage.mockImplementation(async (request: CompressRequest) => {
      requests.push(request);
      return echoResult(request);
    });
    await runCompressBatch([item("a.png", "image/png")], settings);
    await runCompressBatch([item("b.png", "image/png")], { mode: "jpeg", qualityPercent: 80 });
    expect(requests[0].mime).toBe("image/webp");
    expect(requests[0].flattenAlpha).toBe(false);
    expect(requests[1].mime).toBe("image/jpeg");
    expect(requests[1].flattenAlpha).toBe(true);
  });

  it("产物文件名 = 消毒主名 + 实际 MIME 扩展名", async () => {
    h.compressImage.mockImplementation(async (request: CompressRequest) => echoResult(request));
    const done: string[] = [];
    await runCompressBatch([item("我的 照片?.png", "image/png")], settings, {
      onItemDone: (r) => done.push(r.fileName)
    });
    expect(done).toEqual(["我的 照片_.webp"]);
  });

  it("单张失败不中断批次(D7):失败带翻译后的人话,其余照常", async () => {
    h.compressImage.mockImplementation(async (request: CompressRequest) => {
      if (request.fileName === "bad.png") {
        throw new Error("无法解码该图片: 浏览器不支持此编码(HEIC/RAW)或文件已损坏 (xx)");
      }
      return echoResult(request);
    });
    const failed: string[] = [];
    const tally = await runCompressBatch(
      [item("good.jpg"), item("bad.png", "image/png"), item("last.jpg")],
      settings,
      { onItemFailed: (f) => failed.push(f.message) }
    );
    expect(tally.succeeded).toBe(2);
    expect(tally.failed).toBe(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("浏览器可能不支持此编码");
  });

  it("预决策阶段抛错同样收敛为单张失败", async () => {
    h.readProbeHeadBytes.mockRejectedValue(new Error("读取失败"));
    const failed: string[] = [];
    const tally = await runCompressBatch([item("a.jpg")], settings, {
      onItemFailed: (f) => failed.push(f.id)
    });
    expect(tally.failed).toBe(1);
    expect(failed).toEqual(["a.jpg"]);
    expect(h.compressImage).not.toHaveBeenCalled();
  });
});

describe("取消", () => {
  it("空批次不建任何资源,直接零账返回", async () => {
    const tally = await runCompressBatch([], settings);
    expect(tally).toEqual({ succeeded: 0, failed: 0, cancelled: false });
    expect(h.compressImage).not.toHaveBeenCalled();
  });

  it("派发前已取消:不压缩、不回报", async () => {
    const token = createCompressCancelToken();
    token.cancel();
    const tally = await runCompressBatch([item("a.jpg")], settings, {}, token);
    expect(tally).toEqual({ succeeded: 0, failed: 0, cancelled: true });
    expect(h.compressImage).not.toHaveBeenCalled();
  });

  it("在途完成时已取消:该张不回报,后续不再派发,池照常销毁", async () => {
    h.supportsCompressWorker.mockReturnValue(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pool = {
      // 第一张钉在门上等取消:第二张是否派发,取决于取消后槽位是否继续。
      run: vi.fn(async (request: CompressRequest) => {
        if (request.fileName === "a.jpg") await gate;
        return echoResult(request);
      }),
      cancel: vi.fn(),
      terminate: vi.fn(),
      size: 1
    };
    h.createCompressPool.mockReturnValue(pool);

    const token = createCompressCancelToken();
    const done: string[] = [];
    // 已知 48MP 尺寸把并发预算钉到 1(内存预算口径),单槽位下「取消停派发」才可断言。
    const huge = [8000, 6000] as const;
    const running = runCompressBatch(
      [
        item("a.jpg", "image/jpeg", 3, huge[0], huge[1]),
        item("b.jpg", "image/jpeg", 3, huge[0], huge[1])
      ],
      settings,
      { onItemDone: (r) => done.push(r.id) },
      token
    );

    // 等第一张真正派发进 pool.run 再取消:取消只停后续派发,不回滚已产出的字节。
    await vi.waitFor(() => expect(pool.run).toHaveBeenCalledTimes(1));
    token.cancel();
    release();
    const tally = await running;

    expect(done).toEqual([]);
    expect(tally).toEqual({ succeeded: 0, failed: 0, cancelled: true });
    expect(pool.run).toHaveBeenCalledTimes(1);
    expect(pool.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("Worker 路径", () => {
  it("支持 Worker 时走池派发,finally 里 terminate(漏一次就是泄漏一批 Worker)", async () => {
    h.supportsCompressWorker.mockReturnValue(true);
    const pool = {
      run: vi.fn(async (request: CompressRequest) => echoResult(request)),
      cancel: vi.fn(),
      terminate: vi.fn(),
      size: 0
    };
    h.createCompressPool.mockReturnValue(pool);
    const tally = await runCompressBatch([item("a.jpg"), item("b.jpg")], settings);
    expect(h.createCompressPool).toHaveBeenCalledTimes(1);
    const concurrency = h.createCompressPool.mock.calls[0]?.[0] as number;
    expect(Number.isInteger(concurrency)).toBe(true);
    expect(concurrency).toBeGreaterThanOrEqual(1);
    expect(pool.run).toHaveBeenCalledTimes(2);
    expect(tally.succeeded).toBe(2);
    expect(pool.terminate).toHaveBeenCalledTimes(1);
  });

  it("并发数按内存预算:未知尺寸走保守口径,小批次不会被放大", async () => {
    h.supportsCompressWorker.mockReturnValue(true);
    const pool = {
      run: vi.fn(async (request: CompressRequest) => echoResult(request)),
      cancel: vi.fn(),
      terminate: vi.fn(),
      size: 0
    };
    h.createCompressPool.mockReturnValue(pool);
    await runCompressBatch([item("a.jpg")], settings);
    // 1 张任务,内存预算再大并发也只有 1
    expect(h.createCompressPool.mock.calls[0]?.[0]).toBe(1);
  });

  it("WebP 编不出:smart 模式下带透明的 png 退 PNG 而不是 JPEG(保透明优先)", async () => {
    h.supportsWebpEncoding.mockResolvedValue(false);
    const requests: CompressRequest[] = [];
    h.compressImage.mockImplementation(async (request: CompressRequest) => {
      requests.push(request);
      return echoResult(request);
    });
    await runCompressBatch([item("a.png", "image/png")], settings);
    expect(requests[0]?.mime).toBe("image/png");
    expect(requests[0]?.flattenAlpha).toBe(false);
  });
});
