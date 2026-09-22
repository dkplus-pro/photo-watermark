import { describe, expect, it, vi } from "vitest";

import {
  createConsoleSink,
  createHttpSink,
  createTransportRuntime,
  createTransportSinks,
  createWechatSink,
  DEFAULT_HTTP_TIMEOUT_MS,
  TRANSPORT_LOG_PREFIX,
  type HttpSinkOptions,
  type Sink,
  type TaroRequestOptions,
  type TransportEvent,
  type TransportLevel,
  type WxLogManagerLike
} from "../src/core/transport/sink";

function createEvent(event: string, level?: TransportLevel): TransportEvent {
  return level === undefined ? { event, timestamp: 1 } : { event, timestamp: 1, level };
}

function createHttpSinkOrThrow(options: HttpSinkOptions): Sink {
  const sink = createHttpSink(options);
  if (sink === null) throw new Error("HTTP sink 未按预期创建");
  return sink;
}

function createConsoleRecorder(): {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  calls: Record<TransportLevel, unknown[][]>;
} {
  const calls: Record<TransportLevel, unknown[][]> = { info: [], warn: [], error: [] };
  return {
    logger: {
      info: (...args: unknown[]) => calls.info.push(args),
      warn: (...args: unknown[]) => calls.warn.push(args),
      error: (...args: unknown[]) => calls.error.push(args)
    },
    calls
  };
}

describe("createConsoleSink", () => {
  it("按事件等级逐条写入 console", async () => {
    const { logger, calls } = createConsoleRecorder();
    const sink = createConsoleSink({
      runtime: createTransportRuntime({ getConsole: () => logger })
    });

    await sink.write([
      createEvent("track.page_view"),
      createEvent("monitor.warn", "warn"),
      createEvent("monitor.error.js", "error")
    ]);

    expect(calls.info).toHaveLength(1);
    expect(calls.warn).toHaveLength(1);
    expect(calls.error).toHaveLength(1);
    expect(calls.info[0][0]).toBe(`${TRANSPORT_LOG_PREFIX} track.page_view`);
    expect(calls.error[0][1]).toEqual({ event: "monitor.error.js", timestamp: 1, level: "error" });
  });

  it("宿主缺少对应等级方法时回退 console.info", async () => {
    const logs: unknown[][] = [];
    const sink = createConsoleSink({
      runtime: createTransportRuntime({
        getConsole: () => ({ info: (...args: unknown[]) => logs.push(args) })
      })
    });

    await sink.write([createEvent("monitor.error.js", "error")]);
    expect(logs).toHaveLength(1);
  });

  it("宿主没有 console 时不抛错", async () => {
    const sink = createConsoleSink({
      runtime: createTransportRuntime({ getConsole: () => undefined })
    });

    await expect(sink.write([createEvent("track.custom")])).resolves.toBeUndefined();
  });
});

describe("createWechatSink", () => {
  function createManager(info: (...args: unknown[]) => void): WxLogManagerLike {
    return { info };
  }

  it("canIUse 通过时写 wx.getRealtimeLogManager", async () => {
    const logs: unknown[][] = [];
    const runtime = createTransportRuntime({
      getWx: () => ({
        canIUse: (schema) => schema === "getRealtimeLogManager",
        getRealtimeLogManager: () => createManager((...args: unknown[]) => logs.push(args))
      })
    });

    await createWechatSink({ runtime }).write([createEvent("monitor.error.js")]);

    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe(`${TRANSPORT_LOG_PREFIX} monitor.error.js`);
    expect(logs[0][1]).toEqual({ event: "monitor.error.js", timestamp: 1 });
  });

  it("canIUse 判空失败时降级 console", async () => {
    const { logger, calls } = createConsoleRecorder();
    const wechatLogs: unknown[][] = [];
    const runtime = createTransportRuntime({
      getConsole: () => logger,
      getWx: () => ({
        canIUse: () => false,
        getRealtimeLogManager: () => createManager((...args: unknown[]) => wechatLogs.push(args))
      })
    });

    await createWechatSink({ runtime }).write([createEvent("track.page_view")]);

    expect(wechatLogs).toHaveLength(0);
    expect(calls.info).toHaveLength(1);
  });

  it("wx 缺失 getRealtimeLogManager 时降级 console", async () => {
    const { logger, calls } = createConsoleRecorder();
    const runtime = createTransportRuntime({
      getConsole: () => logger,
      getWx: () => ({ canIUse: () => true })
    });

    await createWechatSink({ runtime }).write([createEvent("track.page_view")]);
    expect(calls.info).toHaveLength(1);
  });

  it("getRealtimeLogManager 抛错时降级 console", async () => {
    const { logger, calls } = createConsoleRecorder();
    const runtime = createTransportRuntime({
      getConsole: () => logger,
      getWx: () => ({
        canIUse: () => true,
        getRealtimeLogManager: () => {
          throw new Error("基础库异常");
        }
      })
    });

    await createWechatSink({ runtime }).write([createEvent("track.page_view")]);
    expect(calls.info).toHaveLength(1);
  });

  it("宿主无 wx(空值)时降级 console", async () => {
    const { logger, calls } = createConsoleRecorder();
    const runtime = createTransportRuntime({ getConsole: () => logger, getWx: () => undefined });

    await createWechatSink({ runtime }).write([createEvent("track.page_view")]);
    expect(calls.info).toHaveLength(1);
  });

  it("error / warn 等级走同名方法,方法缺失时回退 info", async () => {
    const infoLogs: unknown[][] = [];
    const errorLogs: unknown[][] = [];
    const runtime = createTransportRuntime({
      getWx: () => ({
        getRealtimeLogManager: () => ({
          info: (...args: unknown[]) => infoLogs.push(args),
          error: (...args: unknown[]) => errorLogs.push(args)
        })
      })
    });
    const sink = createWechatSink({ runtime });

    await sink.write([
      createEvent("monitor.error.js", "error"),
      createEvent("monitor.warn", "warn")
    ]);

    expect(errorLogs).toHaveLength(1);
    // warn 方法缺失 → 回退 info
    expect(infoLogs).toHaveLength(1);
  });

  it("写入中途抛错时剩余事件走降级通道,已写入的不重复", async () => {
    let wechatWriteCount = 0;
    const fallbackBatches: number[][] = [];
    const fallback: Sink = {
      name: "fallback",
      write: async (events) => {
        fallbackBatches.push(events.map((event) => event.timestamp));
      }
    };
    const runtime = createTransportRuntime({
      getWx: () => ({
        getRealtimeLogManager: () => ({
          info: () => {
            wechatWriteCount += 1;
            // 第二条写入时缓冲区异常,此时第一条已落库
            if (wechatWriteCount === 2) throw new Error("实时日志缓冲区异常");
          }
        })
      })
    });

    await createWechatSink({ runtime, fallback }).write([
      createEvent("track.a"),
      createEvent("track.b"),
      createEvent("track.c")
    ]);

    expect(wechatWriteCount).toBe(2);
    // 第 2、3 条走降级通道,第 1 条不重复
    expect(fallbackBatches).toEqual([[1, 1]]);
  });

  it("降级 sink 可注入", async () => {
    const fallback = { name: "custom", write: vi.fn().mockResolvedValue(undefined) };
    const runtime = createTransportRuntime({ getWx: () => undefined });

    await createWechatSink({ runtime, fallback }).write([createEvent("track.page_view")]);
    expect(fallback.write).toHaveBeenCalledTimes(1);
  });
});

describe("createHttpSink", () => {
  function createRequestRecorder(response: { statusCode: number; data?: unknown }) {
    const requests: TaroRequestOptions[] = [];
    const request = (options: TaroRequestOptions): void => {
      requests.push(options);
      options.success?.(response);
    };
    return { requests, request };
  }

  it("endpoint 为空字符串时返回 null(禁用)", () => {
    expect(createHttpSink({ endpoint: "" })).toBeNull();
  });

  it("endpoint 为纯空白时同样禁用", () => {
    expect(createHttpSink({ endpoint: "   " })).toBeNull();
  });

  it("POST { events } 到端点,信封 code 0 视为成功", async () => {
    const { requests, request } = createRequestRecorder({
      statusCode: 200,
      data: { code: 0, message: "ok", data: null }
    });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).resolves.toBeUndefined();

    expect(sink.name).toBe("http");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://example.com/api/app/track");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].timeout).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(requests[0].data).toEqual({ events: [{ event: "track.page_view", timestamp: 1 }] });
  });

  it("2xx 且响应体非信封时按 HTTP 语义视为成功", async () => {
    const { request } = createRequestRecorder({ statusCode: 204 });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).resolves.toBeUndefined();
  });

  it("信封 code 非 0 时按服务端 message 报错", async () => {
    const { request } = createRequestRecorder({
      statusCode: 200,
      data: { code: 40001, message: "参数校验失败", data: null }
    });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow("参数校验失败");
  });

  it("信封 code 非 0 且无 message 时兜底文案", async () => {
    const { request } = createRequestRecorder({ statusCode: 200, data: { code: 500 } });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow(
      "上报失败(code 500)"
    );
  });

  it("非 2xx 状态码报错", async () => {
    const { request } = createRequestRecorder({ statusCode: 502, data: { code: 0 } });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow(
      "上报失败(HTTP 502)"
    );
  });

  it("fail 回调以 errMsg 报错", async () => {
    const request = (options: TaroRequestOptions): void => {
      options.fail?.({ errMsg: "request:fail timeout" });
    };
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow(
      "request:fail timeout"
    );
  });

  it("fail 回调无 errMsg 时兜底文案", async () => {
    const request = (options: TaroRequestOptions): void => {
      options.fail?.({});
    };
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow("上报请求失败");
  });

  it("宿主缺 Taro.request 时抛错", async () => {
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({}) })
    });

    await expect(sink.write([createEvent("track.page_view")])).rejects.toThrow(
      "宿主缺少 Taro.request"
    );
  });

  it("timeoutMs 可覆盖默认超时", async () => {
    const { requests, request } = createRequestRecorder({ statusCode: 200, data: { code: 0 } });
    const sink = createHttpSinkOrThrow({
      endpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime({ getTaro: () => ({ request }) }),
      timeoutMs: 3000
    });

    await sink.write([createEvent("track.page_view")]);
    expect(requests[0].timeout).toBe(3000);
  });
});

describe("createTransportSinks", () => {
  it("dev 只挂 console sink", () => {
    const sinks = createTransportSinks({ dev: true, runtime: createTransportRuntime() });
    expect(sinks.map((sink) => sink.name)).toEqual(["console"]);
  });

  it("非 dev 挂微信实时日志 sink,配了 endpoint 时追加 HTTP sink", () => {
    const sinks = createTransportSinks({
      dev: false,
      httpEndpoint: "https://example.com/api/app/error",
      runtime: createTransportRuntime()
    });
    expect(sinks.map((sink) => sink.name)).toEqual(["wechat", "http"]);
  });

  it("非 dev 且 endpoint 为空时只挂微信实时日志 sink", () => {
    const sinks = createTransportSinks({ runtime: createTransportRuntime() });
    expect(sinks.map((sink) => sink.name)).toEqual(["wechat"]);
  });

  it("dev 配了 endpoint 时 console 与 HTTP sink 并存", () => {
    const sinks = createTransportSinks({
      dev: true,
      httpEndpoint: "https://example.com/api/app/track",
      runtime: createTransportRuntime()
    });
    expect(sinks.map((sink) => sink.name)).toEqual(["console", "http"]);
  });
});
