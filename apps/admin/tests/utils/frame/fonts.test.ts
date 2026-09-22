import { describe, expect, it, vi } from "vitest";

import {
  FIRA_SANS_FAMILY,
  FRAME_FONTS,
  JOST_FAMILY,
  MONO_FONT_STACK,
  PRIMARY_FONT_STACK,
  loadFrameFonts
} from "../../../src/utils/frame/fonts";

/**
 * 字体注册单测。
 * 用注入的假 scope 计数 FontFace 构造次数,不依赖真实 document.fonts
 * (jsdom 无 FontFace 实现,真机字体加载也不该由单测负责)。
 */

// 资源路径必须全部经 assetUrl 拼 basePath,这里把前缀固定成可断言的字面量。
vi.mock("../../../src/utils/asset-url", () => ({
  assetUrl: (path: string) => `/photo-watermark/${String(path).replace(/^\/+/gu, "")}`
}));

interface FakeFontFaceRecord {
  family: string;
  source: string;
  weight: string;
}

interface FakeScopeState {
  failing?: (family: string, weight: string) => boolean;
  throwOnConstruct?: boolean;
  throwOnAdd?: boolean;
}

interface FakeScope {
  scope: Document;
  constructed: FakeFontFaceRecord[];
  added: FakeFontFaceRecord[];
  state: FakeScopeState;
}

const createFakeScope = (shape: "worker" | "document" = "worker"): FakeScope => {
  const constructed: FakeFontFaceRecord[] = [];
  const added: FakeFontFaceRecord[] = [];
  const state: FakeScopeState = {};

  class FakeFontFace {
    readonly family: string;
    readonly source: string;
    readonly weight: string;

    constructor(family: string, source: string, descriptors?: { weight?: string }) {
      if (state.throwOnConstruct) throw new Error("FontFace 构造失败");
      this.family = family;
      this.source = source;
      this.weight = String(descriptors?.weight ?? "");
      constructed.push(this);
    }

    load(): Promise<unknown> {
      if (state.failing?.(this.family, this.weight)) {
        return Promise.reject(new Error(`woff2 取不到: ${this.source}`));
      }
      return Promise.resolve(this);
    }
  }

  const fontSet = {
    add: (font: FakeFontFace): void => {
      if (state.throwOnAdd) throw new Error("fonts.add 失败");
      added.push(font);
    }
  };

  const scope =
    shape === "document"
      ? { defaultView: { FontFace: FakeFontFace }, fonts: fontSet }
      : { FontFace: FakeFontFace, fonts: fontSet };

  return { scope: scope as unknown as Document, constructed, added, state };
};

describe("字体清单(D9)", () => {
  it("三条 webfont 的 family/weight/path 与 public/fonts 落盘文件名逐字一致", () => {
    expect(JOST_FAMILY).toBe("Jost");
    expect(FIRA_SANS_FAMILY).toBe("Fira Sans");
    expect(FRAME_FONTS).toEqual([
      { family: "Jost", weight: 400, path: "fonts/jost-latin-400-normal.woff2" },
      { family: "Jost", weight: 700, path: "fonts/jost-latin-700-normal.woff2" },
      { family: "Fira Sans", weight: 400, path: "fonts/fira-sans-latin-400-normal.woff2" }
    ]);
  });

  it("字体栈首位族名就是被打包的 family,其余为系统回退", () => {
    expect(PRIMARY_FONT_STACK.startsWith(`${JOST_FAMILY},`)).toBe(true);
    expect(MONO_FONT_STACK.startsWith(`"${FIRA_SANS_FAMILY}"`)).toBe(true);
    const families = new Set(FRAME_FONTS.map((font) => font.family));
    expect(families).toEqual(new Set([JOST_FAMILY, FIRA_SANS_FAMILY]));
  });
});

describe("loadFrameFonts 成功路径", () => {
  it("Worker 全局 scope:注册三个字体并返回 true,URL 带 basePath 前缀", async () => {
    const { scope, constructed, added } = createFakeScope();
    await expect(loadFrameFonts(scope)).resolves.toBe(true);
    expect(constructed).toHaveLength(3);
    expect(added).toHaveLength(3);
    expect(constructed.map((face) => `${face.family}:${face.weight}`)).toEqual([
      "Jost:400",
      "Jost:700",
      "Fira Sans:400"
    ]);
    expect(constructed.map((face) => face.source)).toEqual([
      'url("/photo-watermark/fonts/jost-latin-400-normal.woff2")',
      'url("/photo-watermark/fonts/jost-latin-700-normal.woff2")',
      'url("/photo-watermark/fonts/fira-sans-latin-400-normal.woff2")'
    ]);
  });

  it("Document scope 经 defaultView 取 FontFace 构造器", async () => {
    const { scope, constructed } = createFakeScope("document");
    await expect(loadFrameFonts(scope)).resolves.toBe(true);
    expect(constructed).toHaveLength(3);
  });

  it("同一 scope 连调两次只注册一次(幂等)", async () => {
    const { scope, constructed } = createFakeScope();
    await expect(loadFrameFonts(scope)).resolves.toBe(true);
    await expect(loadFrameFonts(scope)).resolves.toBe(true);
    expect(constructed).toHaveLength(3);
  });

  it("并发调用共享同一次注册", async () => {
    const { scope, constructed } = createFakeScope();
    const [first, second] = await Promise.all([loadFrameFonts(scope), loadFrameFonts(scope)]);
    expect([first, second]).toEqual([true, true]);
    expect(constructed).toHaveLength(3);
  });

  it("不同 scope 各自注册一份", async () => {
    const worker = createFakeScope();
    const page = createFakeScope("document");
    await expect(loadFrameFonts(worker.scope)).resolves.toBe(true);
    await expect(loadFrameFonts(page.scope)).resolves.toBe(true);
    expect(worker.constructed).toHaveLength(3);
    expect(page.constructed).toHaveLength(3);
  });
});

describe("loadFrameFonts 失败降级(绝不抛错)", () => {
  it("单个字重取不到时返回 false,其余字体仍完成注册", async () => {
    const { scope, constructed, added, state } = createFakeScope();
    state.failing = (family, weight) => family === FIRA_SANS_FAMILY && weight === "400";
    await expect(loadFrameFonts(scope)).resolves.toBe(false);
    expect(constructed).toHaveLength(3);
    // add 先于 load 发生:失败的 FontFace 也进了字体集合,只是 load 未完成 → Canvas 按字体栈回退
    expect(added).toHaveLength(3);
    expect(added.map((face) => `${face.family}:${face.weight}`)).toContain("Jost:700");
  });

  it("FontFace 构造抛错时返回 false", async () => {
    const { scope, state } = createFakeScope();
    state.throwOnConstruct = true;
    await expect(loadFrameFonts(scope)).resolves.toBe(false);
  });

  it("document.fonts.add 抛错时返回 false", async () => {
    const { scope, state } = createFakeScope();
    state.throwOnAdd = true;
    await expect(loadFrameFonts(scope)).resolves.toBe(false);
  });

  it("scope 无 FontFace 构造器时返回 false 且不构造字体", async () => {
    const { scope, constructed } = createFakeScope();
    const broken = { fonts: (scope as unknown as { fonts: unknown }).fonts };
    await expect(loadFrameFonts(broken as unknown as Document)).resolves.toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it("scope 无 fonts 集合时返回 false", async () => {
    const { scope } = createFakeScope();
    const broken = {
      FontFace: (scope as unknown as { FontFace: unknown }).FontFace
    };
    await expect(loadFrameFonts(broken as unknown as Document)).resolves.toBe(false);
  });

  it("scope 非对象时返回 false", async () => {
    await expect(loadFrameFonts(null as unknown as Document)).resolves.toBe(false);
    await expect(loadFrameFonts("document" as unknown as Document)).resolves.toBe(false);
  });

  it("失败后清除记录,同一 scope 可重试成功", async () => {
    const { scope, constructed, state } = createFakeScope();
    state.failing = () => true;
    await expect(loadFrameFonts(scope)).resolves.toBe(false);
    state.failing = undefined;
    await expect(loadFrameFonts(scope)).resolves.toBe(true);
    expect(constructed).toHaveLength(6);
  });
});
