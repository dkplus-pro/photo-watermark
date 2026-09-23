import { getFrameStyle } from "../../../../utils/frame/style-registry";
import type { FrameCatalogEntry } from "../../../../types";

/**
 * 导出页的样式守卫(阶段 13)。
 *
 * 校验链两级,顺序即优先级:清单装载中 → 清单装载失败 → 清单里有没有这个 id → 注册表里有没有实现。
 * 为什么「装载失败」必须排在「找不到」之前:装载失败时 `frames` 是空数组,
 * 反过来写会把一次 JSON 404 误报成「用户输错了样式 id」,让人去改地址而不是改清单。
 *
 * 绝不在校验失败时回落到默认样式(D2):`store/export` 的初始 styleId 就是 `plain-frame`,
 * 静默回落会让用户以为自己在导出「宽边白框」,实际拿到另一款产物。
 */

export interface StyleGuardInput {
  /** 路由参数,`useParams()` 在地址缺段时给 undefined;空串按缺失处理。 */
  styleId: string | undefined;
  frames: readonly FrameCatalogEntry[];
  catalogLoading: boolean;
  catalogError: string | null;
}

export type StyleGuard =
  | { kind: "loading" }
  | { kind: "catalogError"; message: string }
  | { kind: "unknownStyle"; title: string; message: string }
  | { kind: "ready"; styleId: string; name: string };

/** 清单有、注册表没有:两份事实源漂移,是仓库自带的清单被改坏才会出现。 */
export const UNREGISTERED_STYLE_TITLE = "样式不存在";

export function resolveStyleGuard(input: StyleGuardInput): StyleGuard {
  const { styleId, frames, catalogLoading, catalogError } = input;

  if (catalogLoading) {
    return { kind: "loading" };
  }
  if (catalogError) {
    return { kind: "catalogError", message: catalogError };
  }
  const id = styleId?.trim() ?? "";
  if (!id) {
    return {
      kind: "unknownStyle",
      title: UNREGISTERED_STYLE_TITLE,
      message: "地址里没有相框样式, 请回到相框列表选择一款。"
    };
  }
  const entry = frames.find((frame) => frame.id === id);
  if (!entry) {
    return {
      kind: "unknownStyle",
      title: UNREGISTERED_STYLE_TITLE,
      message: `相框清单里没有 id 为 "${id}" 的样式, 可能地址手输错了或 public/frames.json 被改动了。`
    };
  }
  if (!getFrameStyle(entry.id)) {
    return {
      kind: "unknownStyle",
      title: UNREGISTERED_STYLE_TITLE,
      message:
        `相框清单里登记了 "${entry.id}", 但样式注册表里没有它的绘制实现。` +
        "新增样式必须同时改 utils/frame/style-registry.ts 与 public/frames.json, 不允许只改清单。"
    };
  }
  return { kind: "ready", styleId: entry.id, name: entry.name };
}
