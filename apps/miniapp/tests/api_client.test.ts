// 请求客户端边界(方案 docs/hybrid-capability-plan.md 卡 5.5;
// 六类边界:空值/零值/越界/权限缺失(4xx 与输出门控等价)/网络失败/非法状态迁移)。
// 测试形态:Taro.request 可编程 fake(不起 jsdom)+ monitor spy;取消语义走 signal 鸭子类型。
import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taroMock = vi.hoisted(() => ({ request: vi.fn() }));

const monitorMock = vi.hoisted(() => ({
  captureError: vi.fn(),
  normalizeApiError: vi.fn((input: { endpoint?: string; errMsg?: string; code?: number }) => ({
    kind: "api_error" as const,
    message: `请求失败: ${input.endpoint ?? "[unknown endpoint]"}`,
    extra: { endpoint: input.endpoint, code: input.code ?? 0 }
  }))
}));

vi.mock("@tarojs/taro", () => ({ default: taroMock }));
vi.mock("../src/core/monitor", () => monitorMock);

import {
  customInstance,
  isRequestAbortedError,
  resolveTimeoutMs,
  shouldLogRequests
} from "../src/api/client";

interface RequestOptions {
  url: string;
  method: string;
  data?: unknown;
  header: Record<string, string>;
  timeout: number;
  success: (res: { statusCode: number; data: unknown }) => void;
  fail: (err: { errMsg?: string }) => void;
}

interface ScriptedCall {
  kind: "success" | "fail" | "pending";
  statusCode?: number;
  data?: unknown;
  errMsg?: string;
}

interface AbortSignalLike {
  aborted?: boolean;
  addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
}

let script: ScriptedCall[] = [];
let abortTriggersFail = false;
let calls: RequestOptions[] = [];
let tasks: Array<{ abort: ReturnType<typeof vi.fn> }> = [];

/** 重挂 Taro.request:按脚本逐次应答,并记录调用与返回 task。 */
function installRequestMock(): void {
  vi.mocked(taroMock.request).mockImplementation((raw) => {
    const options = raw as RequestOptions;
    calls.push(options);
    const step = script.shift();
    const task = {
      abort: vi.fn(() => {
        if (abortTriggersFail) options.fail({ errMsg: "request:fail abort" });
      })
    };
    tasks.push(task);
    if (step?.kind === "success") {
      options.success({ statusCode: step.statusCode ?? 200, data: step.data });
    } else if (step?.kind === "fail") {
      options.fail({ errMsg: step.errMsg });
    }
    return task;
  });
}

/** 可外部触发的 signal 鸭子类型(替代 AbortController;小程序运行时可能没有)。 */
function createSignal() {
  const listeners: Array<() => void> = [];
  const signal: AbortSignalLike = {
    aborted: false,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    }
  };
  return {
    signal,
    abort() {
      signal.aborted = true;
      listeners.forEach((listener) => listener());
    }
  };
}

function requestConfig(extra: Partial<AxiosRequestConfig> = {}): AxiosRequestConfig {
  return { url: "/ping", method: "GET", ...extra };
}

beforeEach(() => {
  script = [];
  calls = [];
  tasks = [];
  abortTriggersFail = false;
  vi.clearAllMocks();
  installRequestMock();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("customInstance(信封解包与重试回归)", () => {
  it("CL1 成功:200 + 信封解包为 data", async () => {
    script = [
      {
        kind: "success",
        statusCode: 200,
        data: { code: 0, message: "ok", data: { message: "pong" } }
      }
    ];
    await expect(customInstance<{ message: string }>(requestConfig())).resolves.toEqual({
      message: "pong"
    });
  });

  it("CL2 GET 瞬时失败重试一次后成功(网络失败)", async () => {
    script = [
      { kind: "fail", errMsg: "request:fail timeout" },
      { kind: "success", statusCode: 200, data: { code: 0, data: "ok" } }
    ];
    await expect(customInstance(requestConfig())).resolves.toBe("ok");
    expect(taroMock.request).toHaveBeenCalledTimes(2);
  });

  it("CL3 POST 不重试:失败即抛出并上报一次(网络失败)", async () => {
    script = [
      { kind: "fail", errMsg: "request:fail" },
      { kind: "success", statusCode: 200, data: "unused" }
    ];
    await expect(customInstance(requestConfig({ method: "POST" }))).rejects.toThrow("request:fail");
    expect(taroMock.request).toHaveBeenCalledTimes(1);
    expect(monitorMock.captureError).toHaveBeenCalledTimes(1);
    expect(monitorMock.captureError.mock.calls[0][0]).toMatchObject({ kind: "api_error" });
  });

  it("CL4 4xx 不重试(权限缺失)", async () => {
    script = [{ kind: "success", statusCode: 403, data: { message: "forbidden" } }];
    await expect(customInstance(requestConfig())).rejects.toThrow("forbidden");
    expect(taroMock.request).toHaveBeenCalledTimes(1);
  });

  it("CL5 5xx GET 重试后仍失败:上报一次(网络失败)", async () => {
    script = [
      { kind: "success", statusCode: 500, data: { message: "boom" } },
      { kind: "success", statusCode: 500, data: { message: "boom" } }
    ];
    await expect(customInstance(requestConfig())).rejects.toThrow("boom");
    expect(taroMock.request).toHaveBeenCalledTimes(2);
    expect(monitorMock.captureError).toHaveBeenCalledTimes(1);
  });
});

describe("超时规范化", () => {
  it("CL6 单请求超时覆盖生效", async () => {
    script = [{ kind: "success", statusCode: 200, data: "ok" }];
    await customInstance(requestConfig({ timeout: 5000 }));
    expect(calls[0].timeout).toBe(5000);
  });

  it("CL7 非法超时回退默认 10s(零值/越界)", async () => {
    for (const timeout of [0, -1, Number.NaN, undefined]) {
      script = [{ kind: "success", statusCode: 200, data: "ok" }];
      await customInstance(requestConfig({ timeout: timeout as number | undefined }));
      expect(calls[calls.length - 1].timeout).toBe(10_000);
    }
    expect(resolveTimeoutMs(0)).toBe(10_000);
    expect(resolveTimeoutMs(1)).toBe(1);
  });
});

describe("请求取消(RequestTask abort)", () => {
  it("CL8 预取消:signal 已 aborted 时不上发请求(空值)", async () => {
    await expect(
      customInstance(
        requestConfig({
          signal: { aborted: true } as AbortSignalLike as AxiosRequestConfig["signal"]
        })
      )
    ).rejects.toSatisfy(isRequestAbortedError);
    expect(taroMock.request).not.toHaveBeenCalled();
  });

  it("CL9 飞行中取消:abort 触发 task.abort,reject 取消错误且不二次 settle(非法状态迁移)", async () => {
    script = [{ kind: "pending" }];
    abortTriggersFail = true;
    const controller = createSignal();
    const promise = customInstance(
      requestConfig({
        signal: controller.signal as AbortSignalLike as AxiosRequestConfig["signal"]
      })
    );

    controller.abort();
    await expect(promise).rejects.toSatisfy(isRequestAbortedError);
    expect(tasks[0].abort).toHaveBeenCalledTimes(1);
    expect(taroMock.request).toHaveBeenCalledTimes(1);
  });

  it("CL10 取消不重试不上报(网络失败)", async () => {
    script = [{ kind: "pending" }, { kind: "success", statusCode: 200, data: "unused" }];
    const controller = createSignal();
    const promise = customInstance(
      requestConfig({
        signal: controller.signal as AbortSignalLike as AxiosRequestConfig["signal"]
      })
    );

    controller.abort();
    await expect(promise).rejects.toSatisfy(isRequestAbortedError);
    expect(taroMock.request).toHaveBeenCalledTimes(1);
    expect(monitorMock.captureError).not.toHaveBeenCalled();
  });

  it("CL11 settle 后 abort 静默:无二次 settle 且不再 abort task(非法状态迁移)", async () => {
    script = [{ kind: "success", statusCode: 200, data: "ok" }];
    const controller = createSignal();
    await expect(
      customInstance(
        requestConfig({
          signal: controller.signal as AbortSignalLike as AxiosRequestConfig["signal"]
        })
      )
    ).resolves.toBe("ok");

    controller.abort();
    expect(tasks[0].abort).not.toHaveBeenCalled();
    expect(monitorMock.captureError).not.toHaveBeenCalled();
  });
});

describe("dev 请求日志", () => {
  it("CL12 dev 环境:成功与失败各输出一条 [api] 日志", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const devClient = await import("../src/api/client");

    installRequestMock();
    script = [
      { kind: "success", statusCode: 200, data: "ok" },
      { kind: "fail", errMsg: "request:fail" }
    ];
    await devClient.customInstance(requestConfig());
    await expect(devClient.customInstance(requestConfig({ method: "POST" }))).rejects.toThrow(
      "request:fail"
    );

    const messages = debug.mock.calls.filter((args) => args[0] === "[api]");
    expect(messages).toHaveLength(2);
    expect(messages[0][3]).toMatchObject({ ok: true });
    expect(messages[1][3]).toMatchObject({ ok: false, statusCode: undefined });
  });

  it("CL13 非 dev 环境静默(权限缺失等价)", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    script = [
      { kind: "success", statusCode: 200, data: "ok" },
      { kind: "fail", errMsg: "request:fail" }
    ];
    await customInstance(requestConfig());
    await expect(customInstance(requestConfig({ method: "POST" }))).rejects.toThrow("request:fail");

    expect(shouldLogRequests("test")).toBe(false);
    expect(debug).not.toHaveBeenCalled();
  });
});

describe("错误文案", () => {
  it("CL14 非 2xx:信封 message 原样,缺失时回退「请求失败(500)」(网络失败)", async () => {
    script = [{ kind: "success", statusCode: 500, data: { message: "boom" } }];
    await expect(customInstance(requestConfig({ method: "POST" }))).rejects.toThrow("boom");

    script = [{ kind: "success", statusCode: 500, data: {} }];
    await expect(customInstance(requestConfig({ method: "POST" }))).rejects.toThrow(
      "请求失败(500)"
    );
  });
});
