import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FRAME_FONTS } from "../../src/utils/frame/fonts";
import {
  CatalogError,
  loadCatalogs,
  parseFrameCatalog,
  parseLogoCatalog,
  sortCatalogEntries
} from "../../src/utils/catalog";

/**
 * 清单守卫与装载单测(阶段 6)。
 *
 * 跑在 node 环境:最后一节要读磁盘上的 public/ 真实清单与其引用的资源做自检,
 * 这与 DOM 无关,反而需要 node 的 fs。
 * 权限缺失一类边界本站不适用:纯静态工具,无登录、无鉴权码。
 */

// 清单路径必须经 assetUrl 拼 basePath,这里把前缀固定成可断言的字面量(与 Pages 部署子路径同形)。
const assetUrlSpy = vi.hoisted(() =>
  vi.fn((path: string) => `/photo-watermark/${String(path).replace(/^\/+/gu, "")}`)
);
vi.mock("../../src/utils/asset-url", () => ({ assetUrl: assetUrlSpy }));

// 真实注册表目前只登记了一条样式,而「第 2 项字段非法」「sortOrder 重复」这类用例需要两条不同 id。
// 这里在真实结果之上追加一条虚拟 id(不替换真实 id),未注册 id 的判定用例因此仍然为真。
vi.mock("../../src/utils/frame/style-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/frame/style-registry")>();
  return {
    ...actual,
    listFrameStyleIds: () => [...actual.listFrameStyleIds(), "white-frame"]
  };
});

const VALID_FRAME_CATALOG = {
  version: 1,
  frames: [
    {
      id: "plain-frame",
      name: "基础黑框",
      thumbnail: "assets/thumbs/plain-frame.jpg",
      sortOrder: 10
    }
  ]
};

const VALID_LOGO_CATALOG = {
  version: 1,
  logos: [
    { id: "juzi", name: "芥子科技", source: "assets/logos/juzi.svg", mark: "JUZI" },
    { id: "studio", name: "光影工作室", source: "assets/logos/studio.svg", mark: "STUDIO" }
  ]
};

/** 在合法条目上打补丁,用例只关心被改的那一处。 */
const frameItem = (overrides: Record<string, unknown> = {}) => ({
  ...VALID_FRAME_CATALOG.frames[0],
  ...overrides
});

/** 第二条合法且已登记的条目:双条目用例用它占住第一格,避免撞上重复 id 判定。 */
const SECOND_FRAME_ID = "white-frame";
const secondFrameItem = (overrides: Record<string, unknown> = {}) => ({
  id: SECOND_FRAME_ID,
  name: "基础白框",
  thumbnail: `assets/thumbs/${SECOND_FRAME_ID}.svg`,
  sortOrder: 20,
  ...overrides
});

const fetchMock = vi.fn();

const respondWith = (reply: unknown) => fetchMock.mockResolvedValueOnce(reply);
const respondWithJson = (payload: unknown) =>
  respondWith({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
/** 状态正常但正文不是 JSON —— Pages 误配路由时会退回 index.html。 */
const respondWithText = (body: string, status = 200) =>
  respondWith({ ok: status < 400, status, text: async () => body });
/** 只让第二份(logo)清单成功,便于聚焦第一份的失败分支。 */
const onlyLogosOk = () => respondWithJson(VALID_LOGO_CATALOG);

const catchCatalogError = async (run: () => Promise<unknown>): Promise<CatalogError> => {
  const error = await run().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CatalogError);
  return error as CatalogError;
};

beforeEach(() => {
  fetchMock.mockReset();
  assetUrlSpy.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseFrameCatalog", () => {
  it("合法清单逐字段解析,多余字段被忽略(前向兼容)", () => {
    const parsed = parseFrameCatalog({
      version: 1,
      frames: [frameItem({ authorNote: "未来版本才会用到的键" })],
      unexpectedTopLevelKey: true
    });
    expect(parsed).toEqual({ version: 1, frames: [frameItem()] });
    expect(parsed.frames[0]).not.toHaveProperty("authorNote");
  });

  it("frames 为空数组合法:列表页渲染空态,不是数据错误", () => {
    expect(parseFrameCatalog({ version: 1, frames: [] }).frames).toHaveLength(0);
  });

  it("version 为 0 合法:只做记录,不参与判定", () => {
    expect(parseFrameCatalog({ version: 0, frames: [] }).version).toBe(0);
  });

  it.each([
    ["顶层为 null", null],
    ["顶层为数组", []],
    ["version 缺失", { frames: [] }],
    ["version 为字符串", { version: "1", frames: [] }],
    ["version 为 NaN", { version: NaN, frames: [] }],
    ["version 为 Infinity", { version: Infinity, frames: [] }],
    ["frames 缺失", { version: 1 }],
    ["frames 非数组", { version: 1, frames: {} }],
    ["某项非对象", { version: 1, frames: ["plain-frame"] }]
  ])("非法清单(%s)抛 CatalogError 且 kind = invalid", (_label, raw) => {
    const message = () => parseFrameCatalog(raw);
    expect(message).toThrow(CatalogError);
    try {
      message();
    } catch (error) {
      expect((error as CatalogError).kind).toBe("invalid");
    }
  });

  it("必填字段全空时报错:消息点名第几项哪个字段,取第一个失败字段", () => {
    const raw = {
      version: 1,
      frames: [frameItem(), secondFrameItem({ id: "", name: "", thumbnail: "" })]
    };
    expect(() => parseFrameCatalog(raw)).toThrowError(/相框清单第 2 项的 id 缺失或不是非空字符串/u);
  });

  it.each([
    ["name 为空串", { name: "" }, /相框清单第 2 项的 name 缺失或不是非空字符串/u],
    ["name 为数字", { name: 42 }, /相框清单第 2 项的 name 缺失或不是非空字符串/u],
    ["thumbnail 为纯空白", { thumbnail: " " }, /相框清单第 2 项的 thumbnail/u],
    ["id 为纯空白", { id: "  " }, /相框清单第 2 项的 id/u]
  ])("字段非法(%s)", (_label, overrides, pattern) => {
    expect(() =>
      parseFrameCatalog({ version: 1, frames: [frameItem(), secondFrameItem(overrides)] })
    ).toThrowError(pattern);
  });

  it.each([
    ["零值 0", 0],
    ["负数", -5],
    ["小数", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["缺失", undefined],
    ["字符串", "10"]
  ])("sortOrder %s 非法(必须 ≥1 的整数)", (_label, value) => {
    expect(() =>
      parseFrameCatalog({ version: 1, frames: [frameItem({ sortOrder: value })] })
    ).toThrowError(/sortOrder 缺失或不是正整数/u);
  });

  it("sortOrder 重复合法,顺序由 id 二次排序保证", () => {
    const parsed = parseFrameCatalog({
      version: 1,
      frames: [frameItem({ sortOrder: 10 }), secondFrameItem({ sortOrder: 10 })]
    });
    expect(parsed.frames.map((entry) => entry.sortOrder)).toEqual([10, 10]);
  });

  it("id 重复报错:两份同 id 会让样式解析与 React key 二义", () => {
    expect(() =>
      parseFrameCatalog({ version: 1, frames: [frameItem(), frameItem()] })
    ).toThrowError(/相框清单第 2 项的 id "plain-frame" 与前面的条目重复/u);
  });

  it("id 未在样式注册表登记时报错,消息点名该 id", () => {
    expect(() =>
      parseFrameCatalog({ version: 1, frames: [frameItem({ id: "no-such-style" })] })
    ).toThrowError(/id "no-such-style" 未在样式注册表中登记/u);
  });
});

describe("parseLogoCatalog", () => {
  it("合法清单解析,空数组同样合法", () => {
    expect(parseLogoCatalog(VALID_LOGO_CATALOG).logos).toHaveLength(2);
    expect(parseLogoCatalog({ version: 1, logos: [] }).logos).toHaveLength(0);
  });

  it.each(["id", "name", "source", "mark"])("必填字段 %s 为空串时报错", (field) => {
    const raw = {
      version: 1,
      logos: [VALID_LOGO_CATALOG.logos[0], { ...VALID_LOGO_CATALOG.logos[1], [field]: "" }]
    };
    expect(() => parseLogoCatalog(raw)).toThrowError(
      new RegExp(`第 2 项的 ${field} 缺失或不是非空字符串`, "u")
    );
  });

  it("logo id 重复报错", () => {
    expect(() =>
      parseLogoCatalog({
        version: 1,
        logos: [VALID_LOGO_CATALOG.logos[0], VALID_LOGO_CATALOG.logos[0]]
      })
    ).toThrowError(/logo 清单第 2 项的 id "juzi" 与前面的条目重复/u);
  });
});

describe("sortCatalogEntries", () => {
  it("按 sortOrder 升序、同值按 id,且不改动入参数组", () => {
    const entries = [
      { id: "plain-frame", sortOrder: 20 },
      { id: "white-frame", sortOrder: 10 },
      { id: "amber-frame", sortOrder: 10 }
    ];
    expect(sortCatalogEntries(entries).map((entry) => entry.id)).toEqual([
      "amber-frame",
      "white-frame",
      "plain-frame"
    ]);
    expect(entries[0].id).toBe("plain-frame");
  });

  it("无 sortOrder 字段的清单(logo)退化为按 id 排序", () => {
    expect(sortCatalogEntries([{ id: "studio" }, { id: "juzi" }]).map((entry) => entry.id)).toEqual(
      ["juzi", "studio"]
    );
  });
});

describe("loadCatalogs", () => {
  it("并发取两份清单,路径经 assetUrl 拼前缀", async () => {
    respondWithJson(VALID_FRAME_CATALOG);
    respondWithJson(VALID_LOGO_CATALOG);

    const loaded = await loadCatalogs();

    expect(assetUrlSpy).toHaveBeenCalledWith("frames.json");
    expect(assetUrlSpy).toHaveBeenCalledWith("logos.json");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/photo-watermark/frames.json",
      "/photo-watermark/logos.json"
    ]);
    expect(loaded.frames.frames).toHaveLength(1);
    expect(loaded.logos.logos).toHaveLength(2);
  });

  it("两份清单并发发出,不串行等待", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    respondWith(
      firstGate.then(() => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(VALID_FRAME_CATALOG)
      }))
    );
    respondWithJson(VALID_LOGO_CATALOG);

    const pending = loadCatalogs();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    releaseFirst();
    await expect(pending).resolves.toBeDefined();
  });

  it("fetch 被 reject 时归为 CatalogError(unreachable)且带上 URL", async () => {
    respondWith(Promise.reject(new Error("offline")));
    onlyLogosOk();

    const error = await catchCatalogError(loadCatalogs);
    expect(error.kind).toBe("unreachable");
    expect(error.message).toMatch(/网络中断/u);
    expect(error.message).toMatch(/\/photo-watermark\/frames\.json/u);
  });

  it("404 归为 missing:消息提示资源没放对地方", async () => {
    respondWith({ ok: false, status: 404, text: async () => "" });
    onlyLogosOk();

    const error = await catchCatalogError(loadCatalogs);
    expect(error.kind).toBe("missing");
    expect(error.message).toMatch(/HTTP 404/u);
    expect(error.message).toMatch(/\/photo-watermark\/frames\.json/u);
  });

  it("500 归为 unreachable:运维处置与 404 不同", async () => {
    respondWithJson(VALID_FRAME_CATALOG);
    respondWith({ ok: false, status: 500, text: async () => "" });

    const error = await catchCatalogError(loadCatalogs);
    expect(error.kind).toBe("unreachable");
    expect(error.message).toMatch(/HTTP 500/u);
    expect(error.message).toMatch(/\/photo-watermark\/logos\.json/u);
  });

  it("返回非 JSON 文本时归为 invalid 并指明是哪份清单", async () => {
    respondWithText("<!doctype html><html>");
    onlyLogosOk();

    const error = await catchCatalogError(loadCatalogs);
    expect(error.kind).toBe("invalid");
    expect(error.message).toMatch(/相框清单内容非法/u);
  });

  it("内容非法(清单里的样式画不出来)与文件缺失可区分", async () => {
    respondWithJson({ version: 1, frames: [frameItem({ id: "no-such-style" })] });
    onlyLogosOk();

    const error = await catchCatalogError(loadCatalogs);
    expect(error.kind).toBe("invalid");
    expect(error.message).toMatch(/no-such-style/u);
  });
});

/**
 * 仓库自带清单自检:直接读磁盘上提交的 JSON 与它引用的资源。
 * 这条用例守的是「改了 JSON 忘了改注册表」「删了图没删清单」两类事故,
 * 它们在运行时表现为装载失败或缩略图 404,必须在 CI 里提前红。
 */
describe("仓库 public/ 清单与资源", () => {
  // vitest 的 cwd 恒为 apps/admin(vitest.config.ts 所在目录),清单与资源都相对该目录。
  const publicRoot = resolve(process.cwd(), "public");
  const publicPath = (relativePath: string) => join(publicRoot, relativePath);

  const readCatalog = async (fileName: string) =>
    JSON.parse(await readFile(publicPath(fileName), "utf8"));

  it("frames.json 能通过守卫,且 thumbnail 指向真实文件", async () => {
    const catalog = parseFrameCatalog(await readCatalog("frames.json"));
    expect(catalog.frames.length).toBeGreaterThan(0);
    for (const entry of catalog.frames) {
      await expect(access(publicPath(entry.thumbnail))).resolves.toBeUndefined();
    }
  });

  it("logos.json 能通过守卫,且 source 指向真实文件", async () => {
    const catalog = parseLogoCatalog(await readCatalog("logos.json"));
    expect(catalog.logos.length).toBeGreaterThan(0);
    for (const entry of catalog.logos) {
      await expect(access(publicPath(entry.source))).resolves.toBeUndefined();
    }
  });

  it("FRAME_FONTS 声明的字体与壳层 logo 都已落地", async () => {
    const referenced = [...FRAME_FONTS.map((font) => font.path), "assets/brand/logo.png"];
    for (const path of referenced) {
      await expect(access(publicPath(path))).resolves.toBeUndefined();
    }
  });
});
