import NotFoundPage from "../components/not-found";

// 兜底路由:仅渲染 404 异常页(样式对齐 arco-design-pro)。
// 菜单是静态路由 + 权限过滤(见 docs/admin.md),不存在动态分发。
export default function NotFoundRoute() {
  return <NotFoundPage />;
}
