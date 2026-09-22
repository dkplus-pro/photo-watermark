import { useQuery } from "@tanstack/react-query";

import { MediaController, UsersController } from "../../api/controllers.gen";
import { queryKeys } from "../../api/queryKeys";
import { dashboardMockData, type DashboardMockData, type StorageUsage } from "./mock";

// TODO(契约):当前图表与存储用量数据为 mock(见 ./mock.ts)。
// 待 GET /api/admin/dashboard/summary 落 openapi/admin.yaml 契约后:
// 1. 在 src/api/queryKeys.ts 增加 dashboard 域的 queryKey(集中管理);
// 2. 将下方 queryFn 替换为 DashboardController.summary()(pnpm gen:api 生成),
//    并删除本文件对 ./mock.ts 的依赖;返回结构与 DashboardMockData 对齐,页面结构无需变动。
// 说明:mock 为纯前端占位、非服务端资源,queryKey 暂以内联常量定义于此,
// 落契约时迁移进 queryKeys.ts。
const dashboardMockQueryKey = ["dashboard", "mock"] as const;

// Dashboard mock 数据消费入口:queryFn 返回 mock,接口形状与未来 summary 契约对齐。
export function useDashboardData() {
  return useQuery<DashboardMockData>({
    queryKey: dashboardMockQueryKey,
    queryFn: async () => dashboardMockData
  });
}

export interface DashboardTotals {
  userTotal?: number;
  imageTotal?: number;
  videoTotal?: number;
  storageUsage: StorageUsage;
  /** 统计卡是否处于加载态(真实 total + mock 均就绪才视为完成) */
  isPending: boolean;
}

// 统计卡数据:用户/图片/视频总数走真实列表接口(page=1&pageSize=1 只为取 total),
// 存储用量走 mock(待 summary 契约后替换)。
export function useDashboardTotals(): DashboardTotals {
  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(1, 1, ""),
    queryFn: () => UsersController.listUsers({ page: 1, pageSize: 1 })
  });
  const imagesQuery = useQuery({
    queryKey: queryKeys.media.images(1, 1),
    queryFn: () => MediaController.listImages({ page: 1, pageSize: 1 })
  });
  const videosQuery = useQuery({
    queryKey: queryKeys.media.videos(1, 1),
    queryFn: () => MediaController.listVideos({ page: 1, pageSize: 1 })
  });
  const mockQuery = useDashboardData();

  return {
    userTotal: usersQuery.data?.total,
    imageTotal: imagesQuery.data?.total,
    videoTotal: videosQuery.data?.total,
    storageUsage: mockQuery.data?.storageUsage ?? {
      usedBytes: 0,
      quotaBytes: 0
    },
    isPending:
      usersQuery.isPending || imagesQuery.isPending || videosQuery.isPending || mockQuery.isPending
  };
}
