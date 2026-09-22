// 页面四态组件(方案 docs/hybrid-capability-plan.md 卡 5.2):
// loading 复用 Shell 骨架屏 Skeleton,empty/error 渲染中文文案,error 可选重试,success 透传 children。
import { Text, View } from "@tarojs/components";
import type { ReactNode } from "react";

import { Skeleton } from "./Skeleton";
import { PAGE_STATE_RETRY_LABEL, resolvePageStateCopy, type PageStatus } from "./page-state-logic";

export interface PageStateProps {
  status: PageStatus;
  errorMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  /** success 态内容 */
  children?: ReactNode;
}

export function PageState({
  status,
  errorMessage,
  emptyMessage,
  onRetry,
  children
}: PageStateProps) {
  const copy = resolvePageStateCopy({
    status,
    errorMessage,
    emptyMessage,
    retryable: typeof onRetry === "function"
  });
  if (status === "loading") return <Skeleton />;
  if (status === "empty") {
    return (
      <View className="page-state">
        <Text className="page-state__text">{copy.message}</Text>
      </View>
    );
  }
  if (status === "error") {
    return (
      <View className="page-state">
        <Text className="page-state__text">{copy.message}</Text>
        {copy.showRetry ? (
          <View className="page-state__retry" onClick={onRetry}>
            {PAGE_STATE_RETRY_LABEL}
          </View>
        ) : null}
      </View>
    );
  }
  return <>{children}</>;
}
