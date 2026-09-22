import { useAuthStore } from "../store/auth";

// 权限码判断:基于 /auth/me 返回的 permissions(客户端显隐只是体验,服务端中间件才是安全边界)。
// 用法:const hasPermission = usePermission(); hasPermission("system:user:create")
export function usePermission() {
  const permissions = useAuthStore((state) => state.user?.permissions);
  return (code: string) => permissions?.includes(code) ?? false;
}
