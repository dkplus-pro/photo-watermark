import { Breadcrumb } from "@arco-design/web-react";
import { useLocation, useNavigate } from "@modern-js/runtime/router";
import type { ReactNode } from "react";

import { matchMenuTrail, type MenuConfig, sidebarMenus } from "../config/menu";
import { APP_BASENAME } from "../constants";

export interface BreadcrumbItem {
  title: string;
  /** 可跳转的应用内路径;缺省即不可点。 */
  path?: string;
}

interface PageContainerProps {
  /** 面包屑;传入则完全采用它,不再按菜单自动推导。导出页等用它追加尾项。 */
  breadcrumb?: BreadcrumbItem[];
  /** 内容区顶部右侧操作区插槽(如"导出"按钮)。 */
  extra?: ReactNode;
  children: ReactNode;
}

// 首页固定项:本站 `/` 只做重定向(D14),故指回相框列表而不是 `/`。
const HOME_CRUMB: BreadcrumbItem = { title: "首页", path: "/frames" };

// 菜单链转面包屑项:带 children 的是目录 key(非路由),不可点;叶子才带路径。
function toCrumbs(trail: MenuConfig[]): BreadcrumbItem[] {
  return trail.map((node) => ({
    title: node.title,
    path: node.children?.length ? undefined : node.path
  }));
}

// 页面骨架(UI 规范见 docs/admin.md):面包屑 + 操作区放内容区顶部一行,不渲染页内标题
// (标题与面包屑叶子重复);顶栏只放应用名。面包屑默认取 config/menu.tsx 的标题链,页面不手写。
export default function PageContainer({ breadcrumb, extra, children }: PageContainerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  // 应用内路径 = 剥离 basename 后的剩余段(与 layout 口径一致);APP_BASENAME 为 "/" 时不剥。
  const appPathname =
    APP_BASENAME !== "/" && location.pathname.startsWith(APP_BASENAME)
      ? location.pathname.slice(APP_BASENAME.length) || "/"
      : location.pathname;

  const items = breadcrumb ?? [HOME_CRUMB, ...toCrumbs(matchMenuTrail(appPathname, sidebarMenus))];

  return (
    <div className="app-page">
      <div className="app-page-header">
        <Breadcrumb className="app-page-breadcrumb">
          {items.map((item, index) => {
            // 末项是当前页,不可点;其余带路径的项点击走路由跳转。
            const target = index < items.length - 1 ? item.path : undefined;
            return (
              <Breadcrumb.Item
                key={`${item.title}-${index}`}
                onClick={target ? () => navigate(target) : undefined}
              >
                {item.title}
              </Breadcrumb.Item>
            );
          })}
        </Breadcrumb>
        {extra ? <div className="app-page-extra">{extra}</div> : null}
      </div>
      {children}
    </div>
  );
}
