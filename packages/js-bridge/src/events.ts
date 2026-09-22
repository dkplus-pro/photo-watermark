/**
 * 卡 1.3:JSB 事件总线——native→js 事件订阅与派发。零 import(不依赖 protocol)。
 */

export type JSBEventHandler = (payload: unknown) => void;

export interface JSBEventBus {
  /** 订阅;返回幂等 unsubscribe(重复调用 no-op)。同一 handler 对同一事件重复注册只生效一次(Set 语义)。 */
  on(event: string, handler: JSBEventHandler): () => void;
  /** 退订;handler 未注册 / 事件不存在时 no-op。 */
  off(event: string, handler: JSBEventHandler): void;
  /** 派发;无监听 no-op;按注册顺序同步调用;单 handler 抛错 console.error 后继续派发其余。 */
  dispatch(event: string, payload?: unknown): void;
  /** 当前监听数;未知事件返回 0。 */
  listenerCount(event: string): number;
}

export function createJSBEvents(): JSBEventBus {
  const listeners = new Map<string, Set<JSBEventHandler>>();

  const assertEventName = (event: string): void => {
    if (typeof event !== "string" || event.length === 0) {
      throw new TypeError("js-bridge: event name must be a non-empty string");
    }
  };

  const assertHandler = (handler: JSBEventHandler): void => {
    if (typeof handler !== "function") {
      throw new TypeError("js-bridge: event handler must be a function");
    }
  };

  // 移除后空 Set 从 Map 删除(防止 listenerCount 语义漂移与内存驻留)
  const removeHandler = (event: string, handler: JSBEventHandler): void => {
    const set = listeners.get(event);
    if (!set) {
      return;
    }
    set.delete(handler);
    if (set.size === 0) {
      listeners.delete(event);
    }
  };

  return {
    on(event, handler) {
      assertEventName(event);
      assertHandler(handler);
      let set = listeners.get(event);
      if (!set) {
        set = new Set<JSBEventHandler>();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => {
        removeHandler(event, handler);
      };
    },
    off(event, handler) {
      assertEventName(event);
      assertHandler(handler);
      removeHandler(event, handler);
    },
    dispatch(event, payload) {
      assertEventName(event);
      const set = listeners.get(event);
      if (!set) {
        return;
      }
      // 快照遍历:handler 在派发中 off 自己或 on 新 handler,不影响当次派发序列
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[js-bridge] handler for "${event}" threw`, err);
        }
      }
    },
    listenerCount(event) {
      assertEventName(event);
      return listeners.get(event)?.size ?? 0;
    }
  };
}
