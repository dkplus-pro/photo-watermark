// ExposeView 埋点容器(方案 docs/hybrid-capability-plan.md 卡 5.3):
// 生成实例级唯一 id 并交给 useExpose 观测;子内容原样渲染。
import { View } from "@tarojs/components";
import { useMemo, type ReactNode } from "react";

import type { EventProps } from "../core/track";
import { useExpose } from "../hooks/useExpose";

// 实例级唯一 id 序号(模块级递增;无需可读性,只要同会话唯一)
let exposeViewSeq = 0;

export interface ExposeViewProps {
  trackId: string;
  props?: EventProps;
  className?: string;
  children?: ReactNode;
}

export function ExposeView({ trackId, props, className, children }: ExposeViewProps) {
  const id = useMemo(() => `expose-view-${++exposeViewSeq}`, []);
  useExpose({ selector: `#${id}`, trackId, props });
  return (
    <View id={id} className={["expose-view", className].filter(Boolean).join(" ")}>
      {children}
    </View>
  );
}
