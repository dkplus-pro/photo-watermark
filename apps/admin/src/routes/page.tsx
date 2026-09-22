import { Navigate } from "@modern-js/runtime/router";

// 首页不再承载仪表盘:本站只有一个功能,`/` 直接重定向到相框列表(D14)。
export default function HomePage() {
  return <Navigate to="/frames" replace />;
}
