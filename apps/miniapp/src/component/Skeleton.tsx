// 骨架屏占位组件(方案 docs/miniapp-shell-plan.md §5 阶段 4b):
// 行数/头像/圆角可配;样式类名拼接抽出为纯函数便于单测。
import { View } from "@tarojs/components";

import { normalizeRows, rowClassName } from "./skeleton-logic";

export interface SkeletonProps {
  /** 骨架行数,默认 3;非法值(0/负数/NaN)回退 1 */
  rows?: number;
  /** 是否显示圆形头像占位 */
  avatar?: boolean;
}

export function Skeleton({ rows, avatar = false }: SkeletonProps) {
  const total = normalizeRows(rows);
  return (
    <View className="skeleton" aria-busy>
      {avatar ? <View className="skeleton-avatar" /> : null}
      {Array.from({ length: total }, (_, index) => (
        <View key={index} className={rowClassName(index, total)} />
      ))}
    </View>
  );
}
