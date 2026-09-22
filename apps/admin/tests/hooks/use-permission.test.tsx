// use-permission + AuthGate 用例。
// 边界:permissions undefined(登录中态)视为无权限;数组权限任一命中;
// 未命中置灰(disabled)+ Tooltip 提示(Arco Tooltip 弹层在 jsdom 下不渲染,断言以
// disabled 包裹语义为准);服务端中间件才是安全边界,前端只管显隐。
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { UserInfo } from "../../src/api/generated/cMSAdminAPI.schemas";
import AuthGate from "../../src/components/auth-gate";
import { usePermission } from "../../src/hooks/use-permission";
import { useAuthStore } from "../../src/store/auth";

function makeUser(permissions: string[] | null): UserInfo | null {
  if (!permissions) {
    return null; // /auth/me 未返回(登录中)
  }
  return {
    id: 1,
    username: "admin",
    nickname: "管理员",
    status: true,
    roles: ["admin"],
    permissions
  };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: "tok", user: null });
});

describe("usePermission", () => {
  test("命中权限码返回 true", () => {
    useAuthStore.setState({ user: makeUser(["system:user:list"]) });
    const { result } = renderHook(() => usePermission());
    expect(result.current("system:user:list")).toBe(true);
  });

  test("未命中返回 false", () => {
    useAuthStore.setState({ user: makeUser(["system:user:list"]) });
    const { result } = renderHook(() => usePermission());
    expect(result.current("system:user:delete")).toBe(false);
  });

  test("permissions undefined(登录中)返回 false", () => {
    useAuthStore.setState({ user: null });
    const { result } = renderHook(() => usePermission());
    expect(result.current("system:user:list")).toBe(false);
  });
});

describe("AuthGate", () => {
  test("有权限:原样渲染 children,点击生效", async () => {
    useAuthStore.setState({ user: makeUser(["system:user:delete"]) });
    const onClick = vi.fn();
    render(
      <AuthGate permission="system:user:delete">
        <button type="button" onClick={onClick}>
          删除
        </button>
      </AuthGate>
    );
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("数组权限:任一命中即可", async () => {
    useAuthStore.setState({ user: makeUser(["media:image:delete"]) });
    const onClick = vi.fn();
    render(
      <AuthGate permission={["media:image:delete", "media:image:admin"]}>
        <button type="button" onClick={onClick}>
          删除
        </button>
      </AuthGate>
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("无权限:按钮置灰不可点,Tooltip 提示包裹(Arco 弹层 jsdom 不渲染,验证 disabled 语义)", () => {
    useAuthStore.setState({ user: makeUser(["system:user:list"]) });
    const onClick = vi.fn();
    render(
      <AuthGate permission="system:user:delete" tip="缺少删除权限">
        <button type="button" onClick={onClick}>
          删除
        </button>
      </AuthGate>
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  test("permissions undefined(登录中):按无权限处理,按钮置灰", () => {
    useAuthStore.setState({ token: null, user: null });
    render(
      <AuthGate permission="system:user:delete">
        <button type="button">删除</button>
      </AuthGate>
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });
});
