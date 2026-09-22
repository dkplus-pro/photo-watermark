import { QueryClient } from "@tanstack/react-query";

// 全局唯一的 QueryClient(规范见 docs/admin.md):
// - staleTime 30s:管理端数据变化低频,避免重复请求;
// - retry 1:失败快速暴露,配合统一的错误 Message;
// - refetchOnWindowFocus 关闭:管理后台不跟随窗口聚焦刷新。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
