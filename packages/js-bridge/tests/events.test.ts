import { afterEach, describe, expect, it, vi } from "vitest";

import { createJSBEvents, type JSBEventHandler } from "../src/events";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("events", () => {
  it("E1 on + dispatch 基本链路(payload 原样引用)", () => {
    const events = createJSBEvents();
    const payload = { a: 1 };
    let received: unknown;
    events.on("e", (p) => {
      received = p;
    });
    events.dispatch("e", payload);
    expect(received).toBe(payload);
  });

  it("E2 dispatch 无 payload → handler 收到 undefined(空值)", () => {
    const events = createJSBEvents();
    let received: unknown = "init";
    events.on("e", (p) => {
      received = p;
    });
    events.dispatch("e");
    expect(received).toBeUndefined();
  });

  it("E3 多 handler 按注册顺序调用", () => {
    const events = createJSBEvents();
    const calls: string[] = [];
    events.on("e", () => {
      calls.push("a");
    });
    events.on("e", () => {
      calls.push("b");
    });
    events.dispatch("e");
    expect(calls).toEqual(["a", "b"]);
  });

  it("E4 unsubscribe 幂等(非法状态)", () => {
    const events = createJSBEvents();
    let count = 0;
    const unsubscribe = events.on("e", () => {
      count += 1;
    });
    events.dispatch("e");
    expect(count).toBe(1);
    unsubscribe();
    events.dispatch("e");
    expect(count).toBe(1);
    // 重复调用 no-op 不抛
    expect(() => unsubscribe()).not.toThrow();
    expect(count).toBe(1);
  });

  it("E5 off 语义:移除指定 handler、其余不受影响、未注册/未知事件 no-op(非法状态)", () => {
    const events = createJSBEvents();
    const calls: string[] = [];
    const h1: JSBEventHandler = () => {
      calls.push("h1");
    };
    const h2: JSBEventHandler = () => {
      calls.push("h2");
    };
    events.on("e", h1);
    events.on("e", h2);
    events.off("e", h1);
    events.dispatch("e");
    expect(calls).toEqual(["h2"]);
    // off 未注册 handler、off 未知事件均 no-op 不抛
    expect(() => events.off("e", h1)).not.toThrow();
    expect(() => events.off("unknown", h1)).not.toThrow();
  });

  it("E6 同一 handler 重复注册去重(Set 语义)", () => {
    const events = createJSBEvents();
    let count = 0;
    const handler: JSBEventHandler = () => {
      count += 1;
    };
    events.on("e", handler);
    events.on("e", handler);
    expect(events.listenerCount("e")).toBe(1);
    events.dispatch("e");
    expect(count).toBe(1);
    // off 一次即完全移除
    events.off("e", handler);
    expect(events.listenerCount("e")).toBe(0);
    events.dispatch("e");
    expect(count).toBe(1);
  });

  it("E7 dispatch 无监听 no-op(空值)", () => {
    const events = createJSBEvents();
    expect(() => events.dispatch("never-registered", { x: 1 })).not.toThrow();
  });

  it("E8 handler 抛错不阻断派发,console.error 一次", () => {
    const events = createJSBEvents();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    events.on("e", () => {
      throw new Error("handler boom");
    });
    events.on("e", () => {
      calls.push("b");
    });
    expect(() => events.dispatch("e")).not.toThrow();
    expect(calls).toEqual(["b"]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('[js-bridge] handler for "e" threw');
    expect(errorSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  it("E9 派发中自注销(快照语义)", () => {
    const events = createJSBEvents();
    const calls: string[] = [];
    const handlerA: JSBEventHandler = () => {
      calls.push("a");
      events.off("e", handlerA);
    };
    const handlerB: JSBEventHandler = () => {
      calls.push("b");
    };
    events.on("e", handlerA);
    events.on("e", handlerB);
    events.dispatch("e");
    expect(calls).toEqual(["a", "b"]);
    // 再次派发只剩 B
    calls.length = 0;
    events.dispatch("e");
    expect(calls).toEqual(["b"]);
  });

  it("E10 listenerCount(零值)", () => {
    const events = createJSBEvents();
    expect(events.listenerCount("unknown")).toBe(0);
    const h1: JSBEventHandler = () => {};
    const h2: JSBEventHandler = () => {};
    events.on("e", h1);
    events.on("e", h2);
    expect(events.listenerCount("e")).toBe(2);
    events.off("e", h1);
    expect(events.listenerCount("e")).toBe(1);
    events.off("e", h2);
    expect(events.listenerCount("e")).toBe(0);
  });

  it("E11 事件名/handler 非法 → 同步 TypeError(空值/非法状态)", () => {
    const events = createJSBEvents();
    const handler: JSBEventHandler = () => {};
    expect(() => events.on("", handler)).toThrow(TypeError);
    expect(() => events.off("", handler)).toThrow(TypeError);
    expect(() => events.dispatch("", {})).toThrow(TypeError);
    expect(() => events.listenerCount("")).toThrow(TypeError);
    expect(() => events.on("x", null as never)).toThrow(TypeError);
  });

  it("E12 事件隔离", () => {
    const events = createJSBEvents();
    let bCalled = false;
    events.on("b", () => {
      bCalled = true;
    });
    events.dispatch("a", 1);
    expect(bCalled).toBe(false);
  });
});
