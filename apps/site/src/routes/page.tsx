import { useLoaderData } from "@modern-js/runtime/router";

import { SiteImage } from "../components/site-image";
import { FALLBACK_SITE_NAME } from "../config/site";
import type { SiteHomeData } from "./page.data";

import "./page.css";

// 首页:服务端 loader 拉站点公开信息,渲染站名/Logo 主视觉。
// 站点信息同样展示在页头(layout.data loader);首页独立加载是为了让页面主视觉
// 自持数据,后续栏目页可按各自 loader 拉内容数据(见 docs/site.md「数据加载」)。
export default function HomePage() {
  const siteInfo = useLoaderData() as SiteHomeData;
  const siteName = siteInfo?.siteName || FALLBACK_SITE_NAME;

  return (
    <main className="site-home">
      {siteInfo?.logoUrl ? (
        <SiteImage className="site-home-logo" src={siteInfo.logoUrl} alt={siteName} width={48} height={48} eager />
      ) : null}
      <h1 className="site-home-title">{siteName}</h1>
      <p className="site-home-subtitle">内容由 CMS 管理后台配置,对外站点公开呈现。</p>
    </main>
  );
}
