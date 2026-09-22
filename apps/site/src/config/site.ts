// 站点元信息与静态文案配置坑(原 src/constants/ 迁入;目录职责见 docs/site.md「目录结构」)。

// ---- 站点信息兜底 ----

// 站点信息加载失败时的兜底站名(SSR 用例依赖真实站名来自接口,兜底仅保证渲染不空)。
export const FALLBACK_SITE_NAME = "CMS Template";

// ---- 页脚文案 ----

// 公共页脚版权文案(占位;TODO:上线时替换为真实部署主体)。
// 年份固定写入文案而非运行时取当前时间,保证 SSR 渲染结果可测试。
export const COPYRIGHT_TEXT = "© 2026 CMS Template";

// ---- 顶部导航 ----

// 顶部导航项(key 即路由路径;后续栏目随真实业务页面累加,见 docs/site.md)。
export interface NavItem {
  path: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [{ path: "/", label: "首页" }];
