import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 副作用导入:模块加载即把消息循环挂到 Worker 全局(scope)的 onmessage 上。
import "../../../src/utils/frame/frame.worker";
import { FrameWorkerPool, createFrameWorkerPool } from "../../../src/utils/frame/worker-pool";
import { JPEG_QUALITY } from "../../../src/utils/frame/types";
import type {
  FrameRenderRequest,
  FrameWorkerMessage,
  FrameWorkerResult
} from "../../../src/utils/frame/types";

// Worker 入口的测试只需要「渲染内核会成功/抛错」这两种结局,内核本身由 render-core.test.ts 覆盖。
const { renderFrameDouble } = vi.hoisted(() => ({ renderFrameDouble: vi.fn() }));
vi.mock("../../../src/utils/frame/render-core", () => ({ renderFrame: renderFrameDouble }));

/**
 * Worker 池单测(阶段 9)。
 *
 * jsdom 没有真 Worker,`Worker` 全局被换成 FakeWorker:它记录构造参数与 postMessage 内容,
 * 回报由用例**手动触发** `onmessage`/`onerror`。回报时机完全握在用例手里,乱序、串台、
 * 重复、取消后迟到、崩溃这些真实竞态才能被确定地复现。
 *
 * 六类边界对照:空值与零值(并发数 0/负数/NaN)、越界(排队任务多于并发)、
 * 网络失败(Worker 脚本加载失败即 onerror、消息通道断开即 postMessage 抛错)、
 * 非法状态迁移(cancel/terminate 之后仍有回报、resolve 之后重复回报、cancel 后再 render)。
 * 权限缺失不适用:本站无鉴权。
 */

type RenderMessage = Extract<FrameWorkerMessage, { type: "render" }>;

/** Worker 全局的最小形状:入口只用到 onmessage,测试只读它。 */
interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
}

/** 产物 blob 的文本 = 文件名,用来证明「谁的结果回到谁手里」。 */
const createResult = (fileName: string): FrameWorkerResult => ({
  blob: new Blob([fileName]),
  width: 100,
  height: 100,
  exifInjected: false
});

const createRequest = (fileName: string): FrameRenderRequest => ({
  fileName,
  blob: new Blob([`${fileName}-source`]),
  target: { width: 100, height: 100 },
  jpegQuality: JPEG_QUALITY,
  styleId: "plain-frame",
  fields: {},
  exifHead: null,
  logoMark: "PH",
  logoBlob: null,
  fonts: []
});

// ---------------------------------------------------------------- Worker 替身

class FakeWorker {
  static readonly created: FakeWorker[] = [];
  static readonly constructorArgs: { url: unknown; options: unknown }[] = [];
  /** 让下一个被创建的 Worker 的 postMessage 抛错,模拟消息通道已断。 */
  static failNextPost = false;

  readonly posted: RenderMessage[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminateCount = 0;
  private readonly failPost: boolean;

  constructor(url: unknown, options: unknown) {
    this.failPost = FakeWorker.failNextPost;
    FakeWorker.failNextPost = false;
    FakeWorker.created.push(this);
    FakeWorker.constructorArgs.push({ url, options });
  }

  postMessage(message: RenderMessage): void {
    if (this.failPost) throw new Error("Message port closed");
    this.posted.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  /** 本 Worker 最近收到的派发指令(池保证一个 Worker 同时只跑一张)。 */
  lastDispatch(): RenderMessage {
    const message = this.posted[this.posted.length - 1];
    if (!message) throw new Error("FakeWorker 尚未收到任何 render 指令");
    return message;
  }

  reply(id: number, fileName: string): void {
    this.fire({ type: "result", id, result: createResult(fileName) });
  }

  replyError(id: number, message: string): void {
    this.fire({ type: "error", id, message });
  }

  /** 手动投递一条回报——可以是不属于本 Worker 的 id,用来验证配对严格性。 */
  fire(data: FrameWorkerMessage): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

/**
 * 收集每个 render() 的终态:
 * `all` 按派发顺序给出结果名/错误消息,`outcome.resolved` 按完成顺序记录——
 * 后者正是「乱序回报」用例要看的维度。
 */
const track = (promises: readonly Promise<FrameWorkerResult>[]) => {
  const outcome = { resolved: [] as string[], rejected: [] as string[] };
  const all = Promise.all(
    promises.map(async (promise) => {
      try {
        const result = await promise;
        const name = await result.blob.text();
        outcome.resolved.push(name);
        return name;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome.rejected.push(message);
        return message;
      }
    })
  );
  return { outcome, all };
};

beforeEach(() => {
  FakeWorker.created.length = 0;
  FakeWorker.constructorArgs.length = 0;
  FakeWorker.failNextPost = false;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FrameWorkerPool:懒创建与打包契约", () => {
  it("构造后 size 为 0,一个 Worker 都不建", () => {
    const pool = new FrameWorkerPool(3);

    expect(pool.size).toBe(0);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("连续三个任务才建三个 Worker,每个只拿到自己那张的请求", async () => {
    const pool = createFrameWorkerPool(3);
    const tasks = track([
      pool.render(createRequest("a")),
      pool.render(createRequest("b")),
      pool.render(createRequest("c"))
    ]);

    expect(pool.size).toBe(3);
    expect(FakeWorker.created.map((worker) => worker.posted.map((m) => m.id))).toEqual([
      [1],
      [2],
      [3]
    ]);
    expect(FakeWorker.created[2]?.lastDispatch().request.fileName).toBe("c");

    // 回报顺序刻意打乱
    FakeWorker.created[2]?.reply(3, "c");
    FakeWorker.created[0]?.reply(1, "a");
    FakeWorker.created[1]?.reply(2, "b");
    expect(await tasks.all).toEqual(["a", "b", "c"]);
  });

  it("并发 1 时三个任务串行,第二个 Worker 永不创建", async () => {
    const pool = new FrameWorkerPool(1);
    const tasks = track([
      pool.render(createRequest("a")),
      pool.render(createRequest("b")),
      pool.render(createRequest("c"))
    ]);

    expect(FakeWorker.created).toHaveLength(1);
    const [only] = FakeWorker.created;
    expect(only?.posted).toHaveLength(1);

    only?.reply(1, "a");
    expect(only?.posted).toHaveLength(2);
    expect(only?.lastDispatch().request.fileName).toBe("b");
    only?.reply(2, "b");
    expect(only?.lastDispatch().request.fileName).toBe("c");
    only?.reply(3, "c");

    expect(await tasks.all).toEqual(["a", "b", "c"]);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("并发数 0 / 负数 / NaN 收敛到 1:任务立刻可用而不是永远排队", async () => {
    for (const concurrency of [0, -3, Number.NaN]) {
      FakeWorker.created.length = 0;
      const pool = new FrameWorkerPool(concurrency);
      const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);

      expect(FakeWorker.created).toHaveLength(1);

      FakeWorker.created[0]?.reply(1, "a");
      FakeWorker.created[0]?.reply(2, "b");
      expect(await tasks.all).toEqual(["a", "b"]);
    }
  });

  it("new URL + import.meta.url 是打包器契约,不能退化成字符串路径", () => {
    const pool = new FrameWorkerPool(1);
    pool.render(createRequest("a")).catch(() => undefined);
    const [entry] = FakeWorker.constructorArgs;

    expect(entry?.url).toBeInstanceOf(URL);
    expect((entry?.url as URL).href).toContain("frame.worker.ts");
    expect(entry?.options).toEqual({ type: "module" });
    expect(pool.size).toBe(1);
  });
});

describe("FrameWorkerPool:回报按 id 配对", () => {
  it("乱序回报各自 settle 自己的任务", async () => {
    const pool = new FrameWorkerPool(2);
    const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);
    const [first, second] = FakeWorker.created;

    second?.reply(2, "b");
    first?.reply(1, "a");

    expect(await tasks.all).toEqual(["a", "b"]);
    expect(tasks.outcome.resolved).toEqual(["b", "a"]);
  });

  it("串台回报(回了不属于自己的 id)被丢弃,不会把别人的产物交出去", async () => {
    const pool = new FrameWorkerPool(2);
    const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);
    const [first, second] = FakeWorker.created;

    first?.reply(2, "ghost");
    second?.reply(1, "ghost");
    expect(tasks.outcome.resolved).toEqual([]);

    second?.reply(2, "b");
    first?.reply(1, "a");
    expect(await tasks.all).toEqual(["a", "b"]);
  });

  it("resolve 之后再回同一个 id 被忽略:不重复 settle、也不影响后续派发", async () => {
    const pool = new FrameWorkerPool(1);
    const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);
    const [only] = FakeWorker.created;

    only?.reply(1, "a");
    only?.reply(1, "ghost");
    expect(only?.posted).toHaveLength(2);

    only?.reply(2, "b");
    expect(await tasks.all).toEqual(["a", "b"]);
    expect(tasks.outcome.resolved).toHaveLength(2);
  });

  it("Worker 回报 error 只 reject 那一张,池与其他任务照常", async () => {
    const pool = new FrameWorkerPool(2);
    const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);
    const [first, second] = FakeWorker.created;

    first?.replyError(1, "无法解码该图片");
    second?.reply(2, "b");

    expect(await tasks.all).toEqual(["无法解码该图片", "b"]);
    expect(tasks.outcome.resolved).toEqual(["b"]);
    expect(pool.size).toBe(2);
  });

  it("排队任务多于并发时在途不超过并发,队列随空闲逐个放行", async () => {
    const pool = new FrameWorkerPool(2);
    const names = ["a", "b", "c", "d", "e"];
    const tasks = track(names.map((name) => pool.render(createRequest(name))));
    const [first, second] = FakeWorker.created;

    expect(pool.size).toBe(2);
    expect([first?.posted.length, second?.posted.length]).toEqual([1, 1]);

    second?.reply(2, "b");
    expect([first?.posted.length, second?.posted.length]).toEqual([1, 2]);
    expect(second?.lastDispatch().request.fileName).toBe("c");

    first?.reply(1, "a");
    expect(first?.lastDispatch().request.fileName).toBe("d");
    second?.reply(3, "c");
    expect(second?.lastDispatch().request.fileName).toBe("e");
    first?.reply(4, "d");
    second?.reply(5, "e");

    expect(await tasks.all).toEqual(names);
    expect(FakeWorker.created).toHaveLength(2);
  });
});

describe("FrameWorkerPool:取消与终止", () => {
  it("cancel 后在途与排队全部 reject「已取消」,Worker 不销毁、迟到产物被丢弃", async () => {
    const pool = new FrameWorkerPool(2);
    const names = ["a", "b", "c", "d"];
    const tasks = track(names.map((name) => pool.render(createRequest(name))));
    const [first, second] = FakeWorker.created;

    pool.cancel();

    expect(await tasks.all).toEqual(["已取消", "已取消", "已取消", "已取消"]);
    expect(pool.size).toBe(2);
    expect([first?.terminateCount, second?.terminateCount]).toEqual([0, 0]);

    // 迟到的产物:配对表已清空,既不 settle 也不会把队列里剩下的两张派出去
    first?.reply(1, "a");
    expect(second?.posted).toHaveLength(1);
  });

  it("cancel 之后再 render 明确 reject,不会偷偷起新 Worker", async () => {
    const pool = new FrameWorkerPool(2);
    pool.cancel();

    await expect(pool.render(createRequest("late"))).rejects.toThrow(/已取消/);
    expect(FakeWorker.created).toHaveLength(0);
    expect(pool.size).toBe(0);
  });

  it("terminate 后 size 归零、Worker 销毁、handler 解绑,再 render 明确 reject", async () => {
    const pool = new FrameWorkerPool(1);
    const tasks = track([pool.render(createRequest("a"))]);
    const [only] = FakeWorker.created;

    pool.terminate();
    pool.terminate();

    expect(await tasks.all).toEqual(["Worker 池已销毁, 无法继续渲染。"]);
    expect(pool.size).toBe(0);
    expect(only?.terminateCount).toBe(1);
    expect(only?.onmessage).toBeNull();
    expect(only?.onerror).toBeNull();

    await expect(pool.render(createRequest("b"))).rejects.toThrow(/已销毁/);
  });

  it("terminate 之后迟到的回报无人认领:handler 已解绑,不会复活任何任务", async () => {
    const pool = new FrameWorkerPool(1);
    const tasks = track([pool.render(createRequest("a"))]);
    const [only] = FakeWorker.created;
    pool.terminate();

    // onmessage 已被置空,即便有人手动投递也不进池
    expect(only?.onmessage).toBeNull();
    only?.fire({ type: "result", id: 1, result: createResult("ghost") });

    expect(await tasks.all).toEqual(["Worker 池已销毁, 无法继续渲染。"]);
  });
});

describe("FrameWorkerPool:Worker 崩溃", () => {
  it("onerror 摘除坏 Worker:它手上那张 reject、后续任务不再派给它、其余照常", async () => {
    const pool = new FrameWorkerPool(2);
    const tasks = track([pool.render(createRequest("a")), pool.render(createRequest("b"))]);
    const [first, second] = FakeWorker.created;

    second?.crash("Failed to construct worker script.");
    expect(pool.size).toBe(1);

    // 存活 1 < 并发 2 → 下一张补建新 Worker,坏的那个不会再被选中
    const later = track([pool.render(createRequest("c"))]);
    const replacement = FakeWorker.created[2];
    expect(FakeWorker.created).toHaveLength(3);
    expect(second?.posted).toHaveLength(1);
    expect(replacement?.lastDispatch().request.fileName).toBe("c");

    replacement?.reply(3, "c");
    first?.reply(1, "a");
    // 崩溃只作废 id=2 那一张:其余两张照常完成
    expect(await tasks.all).toEqual(["a", "Failed to construct worker script."]);
    expect(await later.all).toEqual(["c"]);
  });

  it("postMessage 投递即抛等同崩溃:该张 reject 且 Worker 被摘除,不把并发吃光", async () => {
    FakeWorker.failNextPost = true;
    const pool = new FrameWorkerPool(1);
    const tasks = track([pool.render(createRequest("a"))]);

    const [delivered] = await tasks.all;
    expect(delivered).toContain("渲染任务投递失败");
    expect(pool.size).toBe(0);

    const retry = track([pool.render(createRequest("b"))]);
    expect(FakeWorker.created).toHaveLength(2);
    FakeWorker.created[1]?.reply(2, "b");
    expect(await retry.all).toEqual(["b"]);
  });
});

describe("frame.worker 入口:一张任务必有一条回报", () => {
  const posted: FrameWorkerMessage[] = [];
  const successResult = createResult("done");

  /** 读回入口挂在 Worker 全局上的消息处理器(jsdom 下 globalThis 即那个全局)。 */
  const handleMessage = (data: unknown): void => {
    const handler = (globalThis as unknown as WorkerScope).onmessage;
    if (typeof handler !== "function") {
      throw new Error("frame.worker 没有绑定 onmessage, Worker 永远收不到任务");
    }
    handler({ data } as MessageEvent);
  };

  /** 回报发生在 async 链尾部,用一个宏任务把微任务全部冲干净。 */
  const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    posted.length = 0;
    renderFrameDouble.mockReset();
    vi.stubGlobal("postMessage", (message: unknown) => {
      posted.push(message as FrameWorkerMessage);
    });
  });

  it("渲染成功回报 result,id 与请求一致", async () => {
    renderFrameDouble.mockResolvedValue(successResult);

    handleMessage({ type: "render", id: 7, request: createRequest("a") });
    await flush();

    expect(posted).toEqual([{ type: "result", id: 7, result: successResult }]);
  });

  it("渲染抛错回报 error 并带原因,绝不静默(不回报会让池永久挂住这个 Worker)", async () => {
    renderFrameDouble.mockRejectedValue(new Error("无法解码该图片: 浏览器不支持此编码"));

    handleMessage({ type: "render", id: 9, request: createRequest("a") });
    await flush();

    expect(posted).toEqual([
      { type: "error", id: 9, message: "无法解码该图片: 浏览器不支持此编码" }
    ]);
  });

  it("认不出的消息不回任何东西:主线程没有对应在途任务,乱回反而会 settle 掉别人的", async () => {
    handleMessage({ type: "result", id: 1, result: successResult });
    handleMessage({ type: "render" });
    handleMessage(null);
    await flush();

    expect(posted).toEqual([]);
    expect(renderFrameDouble).not.toHaveBeenCalled();
  });

  it("产物无法克隆导致 postMessage 抛错时降级回 error 回报", async () => {
    vi.stubGlobal("postMessage", (message: FrameWorkerMessage) => {
      if (message.type === "result") throw new Error("DataCloneError");
      posted.push(message);
    });
    renderFrameDouble.mockResolvedValue(successResult);

    handleMessage({ type: "render", id: 11, request: createRequest("a") });
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "error", id: 11 });
  });
});
