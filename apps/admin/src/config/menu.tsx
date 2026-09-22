import type { ReactNode } from "react";

import { IconApps, IconPalette } from "@arco-design/web-react/icon";

// 静态菜单声明:本站无服务端、无鉴权,菜单即路由全集,不做任何运行期裁剪。
// 带 children 的节点只作 SubMenu 的 key(如 /watermark-frame),本身不对应路由,无需为其建页面。
// 图标取 @arco-design/web-react/icon 实际导出;折叠态仅显示图标(UI 规范见 docs/admin.md)。
export interface MenuConfig {
  path: string;
  title: string;
  /** 菜单图标;所有菜单项必须声明,禁止裸文字。 */
  icon?: ReactNode;
  children?: MenuConfig[];
}

export const sidebarMenus: MenuConfig[] = [
  {
    path: "/watermark-frame",
    title: "水印相框",
    icon: <IconPalette />,
    children: [{ path: "/frames", title: "相框列表", icon: <IconApps /> }]
  }
];

interface TrailMatch {
  /** 从根到命中节点的菜单链 */
  trail: MenuConfig[];
  /** 命中方式:true 为路径全等,false 为前缀命中 */
  exact: boolean;
}

// 收集全部命中节点:路径全等,或以 `节点路径 + "/"` 开头(子路由归属到该节点)。
function collectTrailMatches(
  pathname: string,
  menus: MenuConfig[],
  ancestors: MenuConfig[]
): TrailMatch[] {
  const matches: TrailMatch[] = [];
  for (const menu of menus) {
    const trail = [...ancestors, menu];
    if (menu.path === pathname) {
      matches.push({ trail, exact: true });
    } else if (pathname.startsWith(`${menu.path}/`)) {
      matches.push({ trail, exact: false });
    }
    if (menu.children?.length) {
      matches.push(...collectTrailMatches(pathname, menu.children, trail));
    }
  }
  return matches;
}

// 面包屑标题链:最长前缀匹配,返回从根到最深命中节点的菜单链
// (如 /frames/silver/export → [水印相框, 相框列表])。
// 全等命中优先于前缀命中,同类命中取路径更长者,避免子目录被父级前缀抢先。
// 未命中返回空数组(404 页等),导出页的尾项由页面经 PageContainer 的 breadcrumb 追加。
export function matchMenuTrail(pathname: string, menus: MenuConfig[] = sidebarMenus): MenuConfig[] {
  const matches = collectTrailMatches(pathname, menus, []);
  if (!matches.length) {
    return [];
  }

  const best = matches.reduce((current, candidate) => {
    if (candidate.exact !== current.exact) {
      return candidate.exact ? candidate : current;
    }
    const currentPath = current.trail[current.trail.length - 1].path;
    const candidatePath = candidate.trail[candidate.trail.length - 1].path;
    return candidatePath.length > currentPath.length ? candidate : current;
  });
  return best.trail;
}

// 面包屑叶子标题:与 matchMenuTrail 同一套匹配逻辑,未命中返回 null。
export function matchMenuTitle(
  pathname: string,
  menus: MenuConfig[] = sidebarMenus
): string | null {
  const trail = matchMenuTrail(pathname, menus);
  return trail.length ? trail[trail.length - 1].title : null;
}
