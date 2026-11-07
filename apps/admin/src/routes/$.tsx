import NotFoundPage from "../components/not-found";

// 兜底路由:仅渲染 404 异常页。
// 菜单即路由全集(见 config/menu.tsx),不存在动态分发。
export default function NotFoundRoute() {
  return <NotFoundPage />;
}
