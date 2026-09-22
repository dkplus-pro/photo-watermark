import { useQuery } from "@tanstack/react-query";

import { MediaController } from "../api/controllers.gen";
import type { MediaGroupKind } from "../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../api/queryKeys";
import { usePermission } from "./use-permission";

interface UseMediaGroupsOptions {
  /** 是否发起请求,默认按 media:group:list 权限判定。 */
  enabled?: boolean;
}

// 媒体分组列表(按 kind 过滤,含组内资源计数)。
// 图片页 / 视频页共用:分组栏、移动分组弹窗、上传弹窗都消费同一 queryKey,
// TanStack Query 自动去重缓存。无 media:group:list 权限时不发请求,
// 分组栏整体隐藏,避免界面功能可用的同时接口 403 报错。
export function useMediaGroups(kind: MediaGroupKind, options: UseMediaGroupsOptions = {}) {
  const hasPermission = usePermission();
  const enabled = options.enabled ?? hasPermission("media:group:list");

  return useQuery({
    queryKey: queryKeys.media.groups(kind),
    queryFn: () => MediaController.listMediaGroups({ kind }),
    enabled
  });
}
