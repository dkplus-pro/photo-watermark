// SafeImage 纯逻辑(与 Taro 渲染解耦,便于 node 环境单测)。

/** 是否应直接渲染兜底:空 src(空串/纯空白)无需发起加载。 */
export function shouldUseFallback(src: string | undefined): boolean {
  return typeof src !== "string" || src.trim() === "";
}
