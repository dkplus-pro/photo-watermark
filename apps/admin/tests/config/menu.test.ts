// config/menu.tsx 纯函数全分支用例(纯逻辑,无需 DOM,node 环境)。
// 边界:permissions 为 undefined/空数组;菜单码、模块码、api 前缀码三种命中;
// 子项全不可见时目录消失;未知路径 trail 为空。
// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  filterMenusByPermissions,
  hasMenuPermission,
  matchMenuTitle,
  matchMenuTrail,
  sidebarMenus
} from "../../src/config/menu";

describe("hasMenuPermission", () => {
  test("未声明权限码的菜单登录即可见(即使 permissions 为 undefined)", () => {
    expect(hasMenuPermission(undefined, undefined)).toBe(true);
    expect(hasMenuPermission(undefined, [])).toBe(true);
  });

  test("permissions 为 undefined/空数组(登录中)时需要权限的菜单不可见", () => {
    expect(hasMenuPermission("menu:system:user", undefined)).toBe(false);
    expect(hasMenuPermission("menu:system:user", [])).toBe(false);
  });

  test("三种命中方式:菜单码本身、模块码、api 前缀码", () => {
    expect(hasMenuPermission("menu:system:user", ["menu:system:user"])).toBe(true);
    expect(hasMenuPermission("menu:system:user", ["system:user"])).toBe(true);
    expect(hasMenuPermission("menu:system:user", ["system:user:list"])).toBe(true);
  });

  test("不相关权限码不命中(前缀相近也不行)", () => {
    expect(hasMenuPermission("menu:system:user", ["menu:system:role"])).toBe(false);
    expect(hasMenuPermission("menu:system:user", ["system:role:list"])).toBe(false);
    expect(hasMenuPermission("menu:system:user", ["system:userx:list"])).toBe(false);
  });
});

describe("filterMenusByPermissions", () => {
  test("permissions 为 undefined(登录中):仅保留无权限码的顶级项,目录消失", () => {
    const menus = filterMenusByPermissions(sidebarMenus, undefined);
    expect(menus.map((menu) => menu.path)).toEqual(["/"]);
  });

  test("permissions 为空数组:同 undefined", () => {
    const menus = filterMenusByPermissions(sidebarMenus, []);
    expect(menus.map((menu) => menu.path)).toEqual(["/"]);
  });

  test("仅持有菜单码本身:对应叶子可见,不可见子项的目录整体消失", () => {
    const menus = filterMenusByPermissions(sidebarMenus, ["menu:system:user"]);
    expect(menus.map((menu) => menu.path)).toEqual(["/", "/system"]);
    expect(menus[1].children?.map((child) => child.path)).toEqual(["/system/users"]);
  });

  test("仅持有 api 前缀码(最小颗粒度):叶子同样可见", () => {
    const menus = filterMenusByPermissions(sidebarMenus, ["media:image:list"]);
    expect(menus.map((menu) => menu.path)).toEqual(["/", "/media"]);
    expect(menus[1].children?.map((child) => child.path)).toEqual(["/media/images"]);
  });

  test("持有模块码:叶子可见", () => {
    const menus = filterMenusByPermissions(sidebarMenus, ["system:log"]);
    expect(menus[1].children?.map((child) => child.path)).toEqual(["/system/logs"]);
  });

  test("全部权限码:目录与子项完整保留", () => {
    const menus = filterMenusByPermissions(sidebarMenus, [
      "menu:system:user",
      "menu:system:role",
      "menu:system:log",
      "menu:system:config",
      "menu:system:dict",
      "menu:media:image",
      "menu:media:video"
    ]);
    expect(menus.map((menu) => menu.path)).toEqual(["/", "/system", "/media"]);
    expect(menus[1].children).toHaveLength(5);
    expect(menus[2].children).toHaveLength(2);
  });
});

describe("matchMenuTrail", () => {
  test("叶子路径返回根到叶标题链", () => {
    const trail = matchMenuTrail("/system/users");
    expect(trail.map((menu) => menu.title)).toEqual(["系统管理", "用户管理"]);
  });

  test("顶级路径返回自身", () => {
    expect(matchMenuTrail("/").map((menu) => menu.title)).toEqual(["仪表盘"]);
    expect(matchMenuTrail("/media").map((menu) => menu.title)).toEqual(["媒体管理"]);
  });

  test("未知路径(404 等)trail 为空", () => {
    expect(matchMenuTrail("/nope")).toEqual([]);
    expect(matchMenuTitle("/nope")).toBeNull();
  });
});
