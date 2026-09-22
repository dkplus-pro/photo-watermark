import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFrameCatalogStore } from "../../src/store/frame-catalog";
import type { FrameCatalog, LogoCatalog } from "../../src/types";

/**
 * 清单 store 状态机单测(阶段 6)。
 *
 * mock 只打在模块边界 `utils/catalog`(本站「服务端」的唯一替身);
 * sortCatalogEntries 保留真实实现,这样「写进 state 的顺序确实排过」才是被真的断言。
 * 权限缺失一类边界本站不适用:无登录、无鉴权码。
 */

const { loadCatalogsMock } = vi.hoisted(() => ({ loadCatalogsMock: vi.fn() }));

vi.mock("../../src/utils/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/catalog")>();
  return { ...actual, loadCatalogs: loadCatalogsMock };
});

/** 故意把 plain-frame 的 sortOrder 写在前面,断言 store 确实重排过。 */
const FRAMES: FrameCatalog = {
  version: 1,
  frames: [
    {
      id: "plain-frame",
      name: "基础黑框",
      thumbnail: "assets/thumbs/plain-frame.svg",
      sortOrder: 20
    },
    {
      id: "amber-frame",
      name: "琥珀边",
      thumbnail: "assets/thumbs/amber-frame.svg",
      sortOrder: 10
    }
  ]
};

const LOGOS: LogoCatalog = {
  version: 1,
  logos: [{ id: "juzi", name: "芥子科技", source: "assets/logos/juzi.svg", mark: "JUZI" }]
};

const catalogPayload = () => ({ frames: FRAMES, logos: LOGOS });

/** 一个由测试手动放行的装载,用来观察 loading 中间态。 */
const gatedCatalogPayload = () => {
  let release: () => void = () => undefined;
  const promise = new Promise<ReturnType<typeof catalogPayload>>((resolve) => {
    release = () => resolve(catalogPayload());
  });
  return { promise, release };
};

/** 把 store 拨回未装载过的初态,用例之间不共享状态。 */
const resetStoreState = () => {
  useFrameCatalogStore.setState({ status: "idle", frames: [], logos: [], error: null });
};

beforeEach(() => {
  loadCatalogsMock.mockReset();
  resetStoreState();
});

describe("useFrameCatalogStore.load 状态机", () => {
  it("idle → loading → ready,写入的清单已按 sortOrder 升序(同值按 id)", async () => {
    loadCatalogsMock.mockResolvedValue(catalogPayload());

    const pending = useFrameCatalogStore.getState().load();
    expect(useFrameCatalogStore.getState().status).toBe("loading");
    await pending;

    const state = useFrameCatalogStore.getState();
    expect(state.status).toBe("ready");
    expect(state.error).toBeNull();
    expect(state.frames.map((entry) => entry.id)).toEqual(["amber-frame", "plain-frame"]);
    expect(state.logos).toEqual(LOGOS.logos);
  });

  it("loading 中重复调用不发第二次请求(in-flight 去重)", async () => {
    const gated = gatedCatalogPayload();
    loadCatalogsMock.mockReturnValue(gated.promise);

    const first = useFrameCatalogStore.getState().load();
    await useFrameCatalogStore.getState().load();
    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);

    gated.release();
    await first;

    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);
    expect(useFrameCatalogStore.getState().status).toBe("ready");
  });

  it("ready 之后再调用不重新发请求", async () => {
    loadCatalogsMock.mockResolvedValue(catalogPayload());
    await useFrameCatalogStore.getState().load();

    await useFrameCatalogStore.getState().load();

    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);
    expect(useFrameCatalogStore.getState().status).toBe("ready");
  });

  it("装载失败进入 error 并保留中文消息", async () => {
    loadCatalogsMock.mockRejectedValueOnce(new Error("相框清单文件不存在(HTTP 404)"));

    await useFrameCatalogStore.getState().load();

    const state = useFrameCatalogStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/HTTP 404/u);
    expect(state.frames).toEqual([]);
  });

  it("error → loading → ready:重试成功后清掉错误", async () => {
    loadCatalogsMock.mockRejectedValueOnce(new Error("网络中断"));
    await useFrameCatalogStore.getState().load();

    loadCatalogsMock.mockResolvedValue(catalogPayload());
    await useFrameCatalogStore.getState().load();

    const state = useFrameCatalogStore.getState();
    expect(state.status).toBe("ready");
    expect(state.error).toBeNull();
    expect(state.frames).toHaveLength(2);
    expect(loadCatalogsMock).toHaveBeenCalledTimes(2);
  });

  it("重试失败时保留上一次的数据,不让已渲染的列表瞬间变空", async () => {
    loadCatalogsMock.mockResolvedValueOnce(catalogPayload());
    await useFrameCatalogStore.getState().load();
    const loadedFrames = useFrameCatalogStore.getState().frames;

    // ready 态不会重新 fetch,这里模拟 reload() 把状态拨回 idle 后再次失败。
    useFrameCatalogStore.setState({ status: "idle" });
    loadCatalogsMock.mockRejectedValueOnce(new Error("清单内容非法"));
    await useFrameCatalogStore.getState().load();

    const state = useFrameCatalogStore.getState();
    expect(state.status).toBe("error");
    expect(state.frames).toBe(loadedFrames);
  });
});
