// api/client.ts 用例(mock 边界:axios adapter 层,横切逻辑全部走真实实现)。
// 覆盖:envelope 解包;非 envelope 透传;envelope 缺 data 字段不误判;
// 错误读取 message + logID 拼接(优先错误体 logID,兜底 X-Log-Id 头);
// 401 清 token(非 login 请求)/ login 请求 401 不清 token;网络错误文案;token 注入。
import { Message } from "@arco-design/web-react";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { axiosInstance, customInstance } from "../../src/api/client";
import { useAuthStore } from "../../src/store/auth";

// axios adapter 层 mock:等价真实传输层(成功 resolve response,失败 reject AxiosError),
// client.ts 的请求/响应拦截器、envelope 解包、401 处理全部走真实代码。
const adapterMock = vi.fn();

function okResponse(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { data, status: 200, statusText: "OK", headers: {}, config } as AxiosResponse;
}

function rejectWith(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
  headers: Record<string, string> = {}
): Promise<never> {
  const response = { data, status, statusText: "", headers, config } as AxiosResponse;
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config,
      {},
      response
    )
  );
}

beforeEach(() => {
  adapterMock.mockReset();
  axiosInstance.defaults.adapter = adapterMock;
  localStorage.clear();
  useAuthStore.setState({ token: null, user: null });
  vi.spyOn(Message, "error").mockImplementation(() => undefined as never);
});

describe("customInstance envelope 处理", () => {
  test("envelope 响应统一解包,业务层直接拿到 data", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      okResponse(config, { code: 0, message: "ok", logID: "log-1", data: { value: 42 } })
    );
    const data = await customInstance<{ value: number }>({
      url: "/api/admin/users",
      method: "GET"
    });
    expect(data).toEqual({ value: 42 });
  });

  test("非 envelope 响应原样透传", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      okResponse(config, { foo: "bar" })
    );
    const data = await customInstance<{ foo: string }>({
      url: "/api/admin/healthz",
      method: "GET"
    });
    expect(data).toEqual({ foo: "bar" });
  });

  test("envelope 缺 data 字段:不视为 envelope,整体透传", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      okResponse(config, { code: 0, message: "ok" })
    );
    const data = await customInstance<unknown>({ url: "/api/admin/healthz", method: "GET" });
    expect(data).toEqual({ code: 0, message: "ok" });
  });
});

describe("请求拦截器 token 注入", () => {
  test("已登录:请求头携带 Bearer token", async () => {
    useAuthStore.setState({ token: "tok-1", user: null });
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      okResponse(config, { code: 0, data: null })
    );
    await customInstance({ url: "/api/admin/auth/me", method: "GET" });
    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.headers?.Authorization).toBe("Bearer tok-1");
  });

  test("未登录:不注入 Authorization 头", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      okResponse(config, { code: 0, data: null })
    );
    await customInstance({ url: "/api/admin/auth/me", method: "GET" });
    const config = adapterMock.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(config.headers?.Authorization).toBeUndefined();
  });
});

describe("错误处理", () => {
  test("错误响应读取 message 并拼接错误体 logID", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      rejectWith(config, 400, { code: 400, message: "参数错误", logID: "log-body-1" })
    );
    await expect(customInstance({ url: "/api/admin/users", method: "POST" })).rejects.toMatchObject(
      { response: { status: 400 } }
    );
    expect(Message.error).toHaveBeenCalledWith("参数错误 (logID: log-body-1)");
  });

  test("错误体无 logID 时兜底 X-Log-Id 响应头;message 缺失时用状态码文案", async () => {
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      rejectWith(config, 500, { code: 500 }, { "x-log-id": "log-hdr-7" })
    );
    await expect(customInstance({ url: "/api/admin/users", method: "GET" })).rejects.toMatchObject({
      response: { status: 500 }
    });
    expect(Message.error).toHaveBeenCalledWith("请求失败(500) (logID: log-hdr-7)");
  });

  test("非 login 请求 401:清空 token 并提示登录过期", async () => {
    useAuthStore.setState({ token: "tok-expired", user: null });
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      rejectWith(config, 401, { code: 401, message: "token invalid", logID: "log-401" })
    );
    await expect(customInstance({ url: "/api/admin/users", method: "GET" })).rejects.toMatchObject({
      response: { status: 401 }
    });
    expect(useAuthStore.getState().token).toBeNull();
    expect(Message.error).toHaveBeenCalledWith("登录已过期,请重新登录 (logID: log-401)");
  });

  test("login 请求自身的 401(凭证错误):不清 token,走通用错误提示", async () => {
    useAuthStore.setState({ token: "tok-old", user: null });
    adapterMock.mockImplementation(async (config: InternalAxiosRequestConfig) =>
      rejectWith(config, 401, { code: 401, message: "用户名或密码错误" })
    );
    await expect(
      customInstance({ url: "/api/admin/auth/login", method: "POST" })
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuthStore.getState().token).toBe("tok-old");
    expect(Message.error).toHaveBeenCalledWith("用户名或密码错误");
  });

  test("无 response 的网络错误:提示统一网络异常文案", async () => {
    adapterMock.mockImplementation((config: InternalAxiosRequestConfig) =>
      Promise.reject(new AxiosError("Network Error", AxiosError.ERR_NETWORK, config))
    );
    await expect(customInstance({ url: "/api/admin/users", method: "GET" })).rejects.toMatchObject({
      code: AxiosError.ERR_NETWORK
    });
    expect(Message.error).toHaveBeenCalledWith("网络异常,请稍后重试");
  });
});
