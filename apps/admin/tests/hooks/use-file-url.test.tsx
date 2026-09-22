// use-file-url 用例:记录带 url 直返 CDN 直链;无 url 走 blob+Bearer。
// 边界:fileId 为空不请求;404 错误分支回落 null;卸载后 revoke。
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useAuthStore } from "../../src/store/auth";
import { useFileURL } from "../../src/hooks/use-file-url";

const fetchMock = vi.fn<typeof fetch>();
const createObjectURLMock = vi.fn(() => "blob:mock-url");
const revokeObjectURLMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ token: "tok-1", user: null });
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(URL, {
    createObjectURL: createObjectURLMock,
    revokeObjectURL: revokeObjectURLMock
  });
});

describe("useFileURL", () => {
  test("记录带 url:直接返回 CDN 直链,不发起请求", () => {
    const { result } = renderHook(() => useFileURL(7, "https://cdn.example.com/x.png"));
    expect(result.current).toBe("https://cdn.example.com/x.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("无 url:带 Bearer token 请求内容端点,返回 blob objectURL;卸载后 revoke", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"]))
    } as Response);
    const { result, unmount } = renderHook(() => useFileURL(7, null));

    await waitFor(() => expect(result.current).toBe("blob:mock-url"));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/files/7/content", {
      headers: { Authorization: "Bearer tok-1" }
    });

    unmount();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
  });

  test("无 token:请求不带 Authorization 头", async () => {
    useAuthStore.setState({ token: null, user: null });
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"]))
    } as Response);
    const { result } = renderHook(() => useFileURL(7, undefined));

    await waitFor(() => expect(result.current).toBe("blob:mock-url"));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/files/7/content", { headers: undefined });
  });

  test("404 错误分支:回落 null,不抛出", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    const { result } = renderHook(() => useFileURL(7, null));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // 错误分支置 null 且稳定(等待一个轮询周期确认无 objectURL)
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(result.current).toBeNull();
  });

  test("fileId 为空:不请求,返回 null", () => {
    const { result } = renderHook(() => useFileURL(null, null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
