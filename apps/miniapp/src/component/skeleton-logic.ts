// Skeleton 纯逻辑(与 Taro 渲染解耦,便于 node 环境单测)。

/** 行数规范化:非有限数值或 <1 回退 1;上限 12 防误传撑爆布局。 */
export function normalizeRows(rows: number | undefined): number {
  if (typeof rows !== "number" || !Number.isFinite(rows) || rows < 1) {
    return 1;
  }
  return Math.min(Math.floor(rows), 12);
}

/** 生成骨架块类名:基础类 + 首行/尾行的圆角修饰。 */
export function rowClassName(index: number, total: number): string {
  const parts = ["skeleton-row"];
  if (total > 1) {
    if (index === 0) parts.push("skeleton-row--first");
    if (index === total - 1) parts.push("skeleton-row--last");
  }
  return parts.join(" ");
}
