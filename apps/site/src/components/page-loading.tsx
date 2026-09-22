// 路由级骨架屏占位(方案见 docs/site-shell-plan.md 阶段 5.1):纯静态结构 + 样式类,
// 无数据依赖与副作用,SSR/客户端输出一致;由 routes/loading.tsx 作为 Modern.js 路由级
// loading 约定的渲染本体复用。
import "./page-loading.css";

export default function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="页面加载中" aria-busy="true">
      <div className="page-loading-block page-loading-title" />
      <div className="page-loading-block page-loading-line" />
      <div className="page-loading-block page-loading-line page-loading-line-short" />
    </div>
  );
}
