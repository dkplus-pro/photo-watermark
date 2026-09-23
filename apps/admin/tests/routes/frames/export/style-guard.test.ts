// @vitest-environment node
// 样式守卫用例(阶段 13,`src/routes/frames/[styleId]/export/style-guard.ts`)。
// 六类边界落点:空值(styleId 缺失/空白)、零值(清单为空数组)、越界(id 带空格要能 trim 命中)、
// 权限缺失不适用(本站匿名公开、无鉴权,见 apps/admin/AGENTS.md 第 3 节)、
// 上游失败(清单装载失败必须优先于「找不到」报出)、非法状态迁移(不适用:纯映射,无状态)。
import { describe, expect, test } from "vitest";

import { resolveStyleGuard } from "../../../../src/routes/frames/[styleId]/export/style-guard";
import {
  DEFAULT_FRAMES,
  REGISTERED_STYLE_ID,
  UNREGISTERED_STYLE_ID,
  makeFrameEntry
} from "./export-test-harness";
import { listFrameStyleIds } from "../../../../src/utils/frame/style-registry";

const base = {
  frames: DEFAULT_FRAMES,
  catalogLoading: false,
  catalogError: null
};

describe("样式存在性判定", () => {
  test("清单有 + 注册表有 → ready,并带回清单项的展示名", () => {
    expect(resolveStyleGuard({ ...base, styleId: REGISTERED_STYLE_ID })).toEqual({
      kind: "ready",
      styleId: REGISTERED_STYLE_ID,
      name: "基础黑框"
    });
  });

  test("越界:id 前后带空格仍按 trim 后的值命中", () => {
    const guard = resolveStyleGuard({ ...base, styleId: `  ${REGISTERED_STYLE_ID}  ` });
    expect(guard.kind).toBe("ready");
  });

  test("空值:styleId 为 undefined 与空串都判「样式不存在」", () => {
    for (const styleId of [undefined, "", "   "]) {
      const guard = resolveStyleGuard({ ...base, styleId });
      expect(guard.kind).toBe("unknownStyle");
      expect(guard.kind === "unknownStyle" && guard.title).toBe("样式不存在");
    }
  });

  test("零值:清单为空数组时该 id 判「不在清单里」,消息指向 frames.json", () => {
    const guard = resolveStyleGuard({ ...base, frames: [], styleId: REGISTERED_STYLE_ID });
    expect(guard.kind).toBe("unknownStyle");
    expect(guard.kind === "unknownStyle" && guard.message).toMatch(/public\/frames\.json/u);
  });

  test("清单里有、注册表没实现 → 仍判「样式不存在」并点名两处事实源", () => {
    const guard = resolveStyleGuard({
      ...base,
      frames: [makeFrameEntry(UNREGISTERED_STYLE_ID, "宽边白框")],
      styleId: UNREGISTERED_STYLE_ID
    });
    expect(guard.kind).toBe("unknownStyle");
    const message = guard.kind === "unknownStyle" ? guard.message : "";
    expect(message).toMatch(/style-registry/u);
    // 不静默回落:ready 之外的任何分支都不许给出一个可用的 styleId。
    expect(guard.kind).not.toBe("ready");
  });

  test("上游失败优先:清单装载失败时不得把 404 报成「样式不存在」", () => {
    const guard = resolveStyleGuard({
      ...base,
      frames: [],
      catalogError: "frames.json 请求失败",
      styleId: REGISTERED_STYLE_ID
    });
    expect(guard).toEqual({ kind: "catalogError", message: "frames.json 请求失败" });
  });

  test("装载中排在错误之前:首轮请求未回来时不给错误态(避免闪一下红色)", () => {
    const guard = resolveStyleGuard({
      ...base,
      catalogLoading: true,
      catalogError: "frames.json 请求失败",
      styleId: REGISTERED_STYLE_ID
    });
    expect(guard).toEqual({ kind: "loading" });
  });

  test("守卫的 ready 判据与注册表同源:每个已注册 id 都能过", () => {
    for (const id of listFrameStyleIds()) {
      const guard = resolveStyleGuard({
        ...base,
        frames: [makeFrameEntry(id, id)],
        styleId: id
      });
      expect(guard.kind).toBe("ready");
    }
  });
});
