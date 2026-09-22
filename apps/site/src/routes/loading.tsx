// Modern.js 路由级 loading 约定:routes 目录下的 loading.tsx 自动作为该层级路由的
// Suspense fallback 生效(方案见 docs/site-shell-plan.md 阶段 5.1);渲染本体复用
// components/page-loading 的统一骨架屏。
import PageLoading from "../components/page-loading";

export default function RouteLoading() {
  return <PageLoading />;
}
