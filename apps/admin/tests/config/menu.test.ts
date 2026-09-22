// config/menu.tsx 纯函数用例(纯逻辑,无需 DOM,node 环境)。
// 边界覆盖:空值(menus 缺省)、零值(空菜单树)、越界(未匹配路径 / 畸形路径);
// 本站无鉴权、无网络,权限与网络两类边界不适用。
// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  matchMenuTitle,
  matchMenuTrail,
  sidebarMenus,
  type MenuConfig
} from "../../src/config/menu";

describe("sidebarMenus", () => {
  test("只声明水印相框一个功能:顶级项恰为一项,子项指向 /frames", () => {
    expect(sidebarMenus).toHaveLength(1);
    const root = sidebarMenus[0];
    expect(root.title).toBe("水印相框");
    expect(root.children?.map((child) => child.path)).toEqual(["/frames"]);
    expect(root.children?.map((child) => child.title)).toEqual(["相框列表"]);
  });

  test("每个菜单项都带图标(折叠态只显示图标,禁止裸文字)", () => {
    const walk = (nodes: MenuConfig[]): void => {
      for (const node of nodes) {
        expect(node.icon, `${node.path} 缺图标`).toBeTruthy();
        if (node.children?.length) {
          walk(node.children);
        }
      }
    };
    walk(sidebarMenus);
  });
});

describe("matchMenuTrail 精确匹配", () => {
  test("叶子路径返回根到叶的标题链", () => {
    expect(matchMenuTrail("/frames").map((node) => node.title)).toEqual(["水印相框", "相框列表"]);
  });

  test("目录 key 本身命中时只返回目录链(目录不是路由,只作 SubMenu key)", () => {
    expect(matchMenuTrail("/watermark-frame").map((node) => node.title)).toEqual(["水印相框"]);
  });

  test("未知路径与根路径未声明时链为空", () => {
    expect(matchMenuTrail("/nope")).toEqual([]);
    expect(matchMenuTrail("/")).toEqual([]);
    expect(matchMenuTitle("/nope")).toBeNull();
  });
});

describe("matchMenuTrail 最长前缀匹配", () => {
  test("子路由归到最近的菜单节点,面包屑不断链", () => {
    expect(matchMenuTrail("/frames/silver/export").map((node) => node.title)).toEqual([
      "水印相框",
      "相框列表"
    ]);
    expect(matchMenuTitle("/frames/silver")).toBe("相框列表");
  });

  test("精确命中优先于前缀命中", () => {
    const menus: MenuConfig[] = [
      {
        path: "/frames",
        title: "相框列表",
        children: [{ path: "/frames/export", title: "批量导出" }]
      }
    ];
    expect(matchMenuTrail("/frames/export", menus).map((node) => node.title)).toEqual([
      "相框列表",
      "批量导出"
    ]);
  });

  test("同为前缀命中时取路径最长的节点,不被父级前缀抢先", () => {
    const menus: MenuConfig[] = [
      {
        path: "/frames",
        title: "相框列表",
        children: [{ path: "/frames/export", title: "批量导出" }]
      }
    ];
    expect(matchMenuTrail("/frames/export/zip", menus).map((node) => node.title)).toEqual([
      "相框列表",
      "批量导出"
    ]);
  });

  test("前缀匹配按路径段边界判定,/framesets 不会误归到 /frames", () => {
    expect(matchMenuTrail("/framesets")).toEqual([]);
  });
});

describe("matchMenuTrail 边界", () => {
  test("畸形路径(空段)仍按段前缀归位,不抛错", () => {
    expect(matchMenuTrail("/frames//export").map((node) => node.title)).toEqual([
      "水印相框",
      "相框列表"
    ]);
  });

  test("空菜单树(零值)返回空链,页面据此只剩首页面包屑", () => {
    expect(matchMenuTrail("/frames", [])).toEqual([]);
    expect(matchMenuTitle("/frames", [])).toBeNull();
  });
});
