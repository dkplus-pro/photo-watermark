import type { ReactNode } from "react";

import {
  IconBook,
  IconDashboard,
  IconFolder,
  IconHistory,
  IconImage,
  IconSettings,
  IconTool,
  IconUser,
  IconUserGroup,
  IconVideoCamera
} from "@arco-design/web-react/icon";

// 静态菜单声明(阶段 3 修订方案,见 docs/admin.md):
// 菜单结构与路由由前端代码声明,运行期按 /auth/me 下发的权限码过滤显隐。
// 权限码必须与服务端路由注册表(internal/httpapi/permission.go 的 Menu 字段)同名。
// 图标取 @arco-design/web-react/icon 实际导出;折叠态仅显示图标(UI 规范见 docs/admin.md)。
export interface MenuConfig {
  path: string;
  title: string;
  /** 菜单图标;所有菜单项必须声明,禁止裸文字。 */
  icon?: ReactNode;
  /** 所需权限码;未声明 = 登录即可见。 */
  permission?: string;
  children?: MenuConfig[];
}

export const sidebarMenus: MenuConfig[] = [
  { path: "/", title: "仪表盘", icon: <IconDashboard /> },
  {
    path: "/system",
    title: "系统管理",
    icon: <IconSettings />,
    children: [
      {
        path: "/system/users",
        title: "用户管理",
        icon: <IconUser />,
        permission: "menu:system:user"
      },
      {
        path: "/system/roles",
        title: "角色管理",
        icon: <IconUserGroup />,
        permission: "menu:system:role"
      },
      {
        path: "/system/logs",
        title: "操作日志",
        icon: <IconHistory />,
        permission: "menu:system:log"
      },
      {
        path: "/system/configs",
        title: "系统配置",
        icon: <IconTool />,
        permission: "menu:system:config"
      },
      {
        path: "/system/dicts",
        title: "字典管理",
        icon: <IconBook />,
        permission: "menu:system:dict"
      }
    ]
  },
  {
    path: "/media",
    title: "媒体管理",
    icon: <IconFolder />,
    children: [
      {
        path: "/media/images",
        title: "图片管理",
        icon: <IconImage />,
        permission: "menu:media:image"
      },
      {
        path: "/media/videos",
        title: "视频管理",
        icon: <IconVideoCamera />,
        permission: "menu:media:video"
      }
    ]
  }
];

// 菜单可见判定(最小颗粒度):拥有菜单权限点本身,或该模块下任一 api 权限码
// (如 system:user:list)即视为可见,不要求完整勾选 menu:system:user。
export function hasMenuPermission(
  permission: string | undefined,
  permissions: string[] | undefined
): boolean {
  if (!permission) {
    return true;
  }
  if (!permissions?.length) {
    return false;
  }
  const modulePrefix = permission.replace(/^menu:/, "");
  return permissions.some(
    (code) => code === permission || code === modulePrefix || code.startsWith(`${modulePrefix}:`)
  );
}

// 按权限码过滤菜单:叶子按最小颗粒度判定,目录在任一子项可见时保留。
export function filterMenusByPermissions(
  menus: MenuConfig[],
  permissions: string[] | undefined
): MenuConfig[] {
  const result: MenuConfig[] = [];
  for (const menu of menus) {
    if (menu.children?.length) {
      const children = filterMenusByPermissions(menu.children, permissions);
      if (children.length) {
        result.push({ ...menu, children });
      }
      continue;
    }
    if (hasMenuPermission(menu.permission, permissions)) {
      result.push(menu);
    }
  }
  return result;
}

// 面包屑标题链:按当前路径递归查找,返回根到叶的菜单节点(如 [系统管理, 用户管理])。
// 未命中返回空数组(如 404 页、登录后欢迎页无父级时也返回自身)。
export function matchMenuTrail(pathname: string, menus: MenuConfig[] = sidebarMenus): MenuConfig[] {
  for (const menu of menus) {
    if (menu.path === pathname) {
      return [menu];
    }
    if (menu.children) {
      const trail = matchMenuTrail(pathname, menu.children);
      if (trail.length) {
        return [menu, ...trail];
      }
    }
  }
  return [];
}

// 面包屑:按当前路径递归查找菜单标题,未命中返回 null(如 404 页)。
export function matchMenuTitle(
  pathname: string,
  menus: MenuConfig[] = sidebarMenus
): string | null {
  const trail = matchMenuTrail(pathname, menus);
  return trail.length ? trail[trail.length - 1].title : null;
}
