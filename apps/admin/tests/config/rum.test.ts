// src/config/rum 的初始化守卫用例:环境门禁、最小采集面、幂等与失败降级。
// SDK 一律 mock 在模块边界(vi.mock "aegis-web-sdk"),不真联网。
import { beforeEach, describe, expect, test, vi } from "vitest";

import Aegis from "aegis-web-sdk";

vi.mock("aegis-web-sdk", () => ({ default: vi.fn() }));

const mockedAegis = vi.mocked(Aegis);

beforeEach(() => {
  // 重置模块注册表:rum.ts 的 initialized 是模块级状态,每个用例拿全新实例。
  vi.resetModules();
  mockedAegis.mockReset();
});

const loadRum = () => import("../../src/config/rum");

describe("initRum", () => {
  test("非生产环境不初始化,dev/单测不污染线上数据", async () => {
    const { initRum } = await loadRum();
    await expect(initRum({ nodeEnv: "development" })).resolves.toBe(false);
    await expect(initRum({ nodeEnv: "test" })).resolves.toBe(false);
    // 不传 env 时读 process.env.NODE_ENV,vitest 下恒为 test,同样不初始化。
    await expect(initRum()).resolves.toBe(false);
    expect(mockedAegis).not.toHaveBeenCalled();
  });

  test("生产环境按最小采集面初始化:只留 PV(spa)与 JS 错误", async () => {
    const { initRum } = await loadRum();
    await expect(initRum({ nodeEnv: "production" })).resolves.toBe(true);
    expect(mockedAegis).toHaveBeenCalledTimes(1);
    expect(mockedAegis.mock.calls[0]?.[0]).toMatchObject({
      id: "mZqg2ULvmmagqX9nYP",
      spa: true,
      reportApiSpeed: false,
      reportAssetSpeed: false,
      pagePerformance: false,
      webVitals: false,
      gzip: false
    });
  });

  test("重复调用幂等,不重复初始化", async () => {
    const { initRum } = await loadRum();
    await initRum({ nodeEnv: "production" });
    await expect(initRum({ nodeEnv: "production" })).resolves.toBe(false);
    expect(mockedAegis).toHaveBeenCalledTimes(1);
  });

  test("SDK 构造异常不外抛,返回 false 只记日志", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAegis.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { initRum } = await loadRum();
    await expect(initRum({ nodeEnv: "production" })).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("RUM 初始化失败", expect.any(Error));
    // 失败后不算已初始化,下次调用允许重试。
    await expect(initRum({ nodeEnv: "production" })).resolves.toBe(true);
  });
});
