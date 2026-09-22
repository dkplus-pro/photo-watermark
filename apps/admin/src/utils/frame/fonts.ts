import { assetUrl } from "../asset-url";
import type { FontAsset, LoadFrameFonts } from "./types";

/**
 * 相框字体资源(D9):打包 webfont 而非依赖 CDN,主线程与 Worker 内都用 FontFace 注册,
 * 保证 OffscreenCanvas 绘制的文字与预览一致。文件落在 `public/fonts/` 下,路径必须与之逐字一致。
 */

export const JOST_FAMILY = "Jost";
export const FIRA_SANS_FAMILY = "Fira Sans";

/** 信息条第一行与 logo 文字块的主字体栈。 */
export const PRIMARY_FONT_STACK = `Jost, "Futura PT", "Avenir Next", Avenir, ui-sans-serif, system-ui, sans-serif`;

/** 信息条第二行(参数行)的等宽数字字体栈。 */
export const MONO_FONT_STACK = `"Fira Sans", "Fira Code", ui-sans-serif, system-ui, sans-serif`;

export const FRAME_FONTS: readonly FontAsset[] = [
  { family: JOST_FAMILY, weight: 400, path: "fonts/jost-latin-400-normal.woff2" },
  { family: JOST_FAMILY, weight: 700, path: "fonts/jost-latin-700-normal.woff2" },
  { family: FIRA_SANS_FAMILY, weight: 400, path: "fonts/fira-sans-latin-400-normal.woff2" }
];

type FontFaceConstructor = new (
  family: string,
  source: string,
  descriptors?: FontFaceDescriptors
) => FontFace;

interface FontFaceSetLike {
  add?: (font: FontFace) => unknown;
}

/**
 * 字体注册作用域的双端形状:Document 侧 fonts 挂在 document.fonts 上、构造器在 defaultView;
 * WorkerGlobalScope 侧 FontFace 与 fonts 都直接挂在全局对象上。
 * 刻意不从模块作用域裸引用 self/globalThis —— tsconfig 未引入 lib.webworker,
 * 且 jsdom 下的 self 语义与 Worker 不同,只有按 scope 取属性才能保证双端一致。
 */
interface FontScopeLike {
  FontFace?: FontFaceConstructor;
  fonts?: FontFaceSetLike;
  defaultView?: { FontFace?: FontFaceConstructor } | null;
}

const resolveFontFaceConstructor = (scope: FontScopeLike): FontFaceConstructor | null =>
  scope.FontFace ?? scope.defaultView?.FontFace ?? null;

/** 同一 scope 只注册一次;失败时清除记录,允许上层重试。 */
const pendingByScope = new WeakMap<object, Promise<boolean>>();

const loadSingleFont = async (
  constructor: FontFaceConstructor,
  fontSet: FontFaceSetLike,
  asset: FontAsset
): Promise<void> => {
  const face = new constructor(asset.family, `url("${assetUrl(asset.path)}")`, {
    weight: String(asset.weight)
  });
  fontSet.add?.(face);
  await face.load();
};

/**
 * 注册相框所需 webfont。
 *
 * 返回 false 表示字体不可用(Canvas 会退回栈内下一级系统字体,观感降级但导出不失败),
 * 任何异常都在这里吞掉——绘制链路绝不能因为字体拉挂而中断导出。
 * 逐个 allSettled:部分成功也已有价值(命中的字重生效,缺失的按栈回退),
 * 但只有全部成功才返回 true,便于上层决定是否提示字体降级。
 */
export const loadFrameFonts: LoadFrameFonts = (scope) => {
  const key = scope as unknown;
  if (typeof key !== "object" || key === null) {
    return Promise.resolve(false);
  }
  const cached = pendingByScope.get(key);
  if (cached) return cached;

  const task = (async () => {
    const target = scope as unknown as FontScopeLike;
    const constructor = resolveFontFaceConstructor(target);
    const fontSet = target.fonts;
    if (!constructor || !fontSet) return false;
    const settled = await Promise.allSettled(
      FRAME_FONTS.map((asset) => loadSingleFont(constructor, fontSet, asset))
    );
    return settled.every((entry) => entry.status === "fulfilled");
  })();

  pendingByScope.set(key, task);
  return task.then((loaded) => {
    if (!loaded) pendingByScope.delete(key);
    return loaded;
  });
};
