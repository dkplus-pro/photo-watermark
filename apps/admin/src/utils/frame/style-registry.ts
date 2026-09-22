import { drawFrameComposition } from "./frame-drawing";
import type { FrameStyleDefinition } from "./types";

/**
 * 相框样式注册表(D2):静态 JSON 清单只描述样式 id 与缩略信息,具体绘制实现走代码分支。
 * 新增样式 = 在此处登记一条,其余消费侧按 id 取用,不改渲染链路。
 */

/** 「黑底信息条」样式 id,与后续 frames.json 清单里的 styleId 对齐。 */
export const PLAIN_FRAME_STYLE_ID = "plain-frame";

const frameStyleRegistry = new Map<string, FrameStyleDefinition>([
  [PLAIN_FRAME_STYLE_ID, { id: PLAIN_FRAME_STYLE_ID, draw: drawFrameComposition }]
]);

/**
 * 按 id 取样式;未注册返回 null。
 * 刻意不静默回落到第一种样式——回落会把用户的错误配置伪装成正确产物。
 */
export const getFrameStyle = (styleId: string): FrameStyleDefinition | null =>
  frameStyleRegistry.get(styleId) ?? null;

/** 已注册样式 id 列表,注册顺序即展示顺序。 */
export const listFrameStyleIds = (): string[] => [...frameStyleRegistry.keys()];
