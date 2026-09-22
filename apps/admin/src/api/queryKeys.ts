import type { ListOperationLogsStatus, MediaGroupKind } from "../api/generated/cMSAdminAPI.schemas";

// TanStack Query 的 queryKey 集中定义(规范见 docs/admin.md):
// 结构为 [模块, 资源, ...参数],与 Controller 模块一一对应,禁止在页面里裸写字符串 key。
export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const
  },
  system: {
    healthz: ["system", "healthz"] as const
  },
  users: {
    list: (page: number, pageSize: number, keyword: string, status?: boolean) =>
      ["users", "list", { page, pageSize, keyword, status }] as const
  },
  roles: {
    list: (page: number, pageSize: number, keyword: string, status?: boolean) =>
      ["roles", "list", { page, pageSize, keyword, status }] as const,
    all: ["roles", "all"] as const
  },
  permissions: {
    tree: ["permissions", "tree"] as const
  },
  logs: {
    list: (
      page: number,
      pageSize: number,
      username: string,
      resource?: string,
      action?: string,
      status?: ListOperationLogsStatus,
      range?: [string, string]
    ) => ["logs", "list", { page, pageSize, username, resource, action, status, range }] as const
  },
  configs: {
    group: (group: string) => ["configs", group] as const
  },
  dicts: {
    list: (keyword: string) => ["dicts", "list", { keyword }] as const,
    items: (code: string) => ["dicts", "items", code] as const
  },
  media: {
    // 媒体模块统一失效前缀:分组增删改会同时影响分组列表与资源列表的 groupName/归属。
    all: ["media"] as const,
    // 分组列表按 kind 过滤(图片/视频各一份)。
    groups: (kind: MediaGroupKind) => ["media", "groups", { kind }] as const,
    // groupId:不传=全部,0=未分组,>0=分组 ID(与契约 ListImagesParams/ListVideosParams 口径一致)。
    images: (page: number, pageSize: number, groupId?: number) =>
      ["media", "images", { page, pageSize, groupId }] as const,
    videos: (page: number, pageSize: number, groupId?: number) =>
      ["media", "videos", { page, pageSize, groupId }] as const
  }
};
