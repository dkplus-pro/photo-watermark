import { useEffect, useState } from "react";
import type { JSX } from "react";

import { isInApp } from "@repo/js-bridge";

import PageShell from "../../component/page-shell";

import { initJSBTestBridge } from "./jsb-setup";
import type { JSBTestHandle } from "./jsb-setup";
import MethodCard from "./method-card";
import { JSB_DEMO_EVENT, jsbMethodGroups } from "./method-groups";

import "./page.css";

/** 接收记录保留上限(最新在上)。 */
const EVENT_LOG_LIMIT = 20;

/**
 * JSBridge 联调测试页(client-only 挂载):
 * - SSR/首帧只渲染标题 + 初始化占位,挂载后才初始化 JSB 与读取 isInApp(模块顶层零浏览器 API 访问);
 * - 非 webview 环境降级:徽标「浏览器」+ BRIDGE_NOT_AVAILABLE 横幅,卡片调用 reject 不炸页面;
 * - 方法调用统一经 handle.runtime.bridge.callNative(不用包级 callNative 代理:未 setup 时同步抛)。
 */
export default function JSBridgeTestPage(): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const [handle, setHandle] = useState<JSBTestHandle | null>(null);
  const [eventName, setEventName] = useState(JSB_DEMO_EVENT);
  const [unsubscribeEvent, setUnsubscribeEvent] = useState<(() => void) | null>(null);
  const [eventLogs, setEventLogs] = useState<string[]>([]);

  useEffect(() => {
    const h = initJSBTestBridge();
    setHandle(h);
    setMounted(true);
    return () => h?.dispose();
  }, []);

  const inApp = mounted ? isInApp() : false;

  // 挂载后必有 handle(卡片区仅在 handle 就绪后渲染)
  const callMethod = (method: string, params?: Record<string, unknown>): Promise<unknown> =>
    handle!.runtime.bridge.callNative(method, params);

  // 重复点「订阅」先退订旧记录再订阅;事件名在订阅时固化进 handler 闭包
  const handleSubscribe = (): void => {
    if (!handle) {
      return;
    }
    unsubscribeEvent?.();
    const event = eventName;
    const unsubscribe = handle.runtime.events.on(event, (payload) => {
      const record = `收到事件 ${event}：${
        payload === undefined ? "(无数据)" : JSON.stringify(payload)
      }`;
      setEventLogs((prev) => [record, ...prev].slice(0, EVENT_LOG_LIMIT));
    });
    setUnsubscribeEvent(() => unsubscribe);
  };

  const handleUnsubscribe = (): void => {
    unsubscribeEvent?.();
    setUnsubscribeEvent(null);
  };

  return (
    <>
      <title>JSBridge 联调测试页</title>
      <PageShell>
        <div className="jsb-page">
          <h1 className="jsb-page-title">JSBridge 联调测试页</h1>
          {!mounted || !handle ? (
            <p className="jsb-page-loading">正在初始化…</p>
          ) : (
            <>
              <p className={inApp ? "jsb-badge jsb-badge--app" : "jsb-badge"}>
                {inApp ? "运行环境：App WebView" : "运行环境：浏览器"}
              </p>
              {!inApp ? (
                <p className="jsb-banner">
                  {
                    "当前不在 App WebView 环境中，调用会失败(BRIDGE_NOT_AVAILABLE)。以下功能请在 App 内打开本页验证。"
                  }
                </p>
              ) : null}
              {jsbMethodGroups.map((group) => (
                <section key={group.key} className="jsb-group">
                  <h2 className="jsb-group-title">{group.title}</h2>
                  {group.methods.map((meta) => (
                    <MethodCard key={meta.method} meta={meta} call={callMethod} />
                  ))}
                </section>
              ))}
              <section className="jsb-group">
                <h2 className="jsb-group-title">事件订阅</h2>
                <div className="jsb-event-bar">
                  <input
                    className="jsb-event-input"
                    value={eventName}
                    onChange={(event) => setEventName(event.target.value)}
                    aria-label="事件名"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="jsb-btn jsb-btn--primary"
                    disabled={unsubscribeEvent !== null || eventName.trim().length === 0}
                    onClick={handleSubscribe}
                  >
                    订阅
                  </button>
                  <button
                    type="button"
                    className="jsb-btn"
                    disabled={unsubscribeEvent === null}
                    onClick={handleUnsubscribe}
                  >
                    取消订阅
                  </button>
                </div>
                {eventLogs.length > 0 ? (
                  <ul className="jsb-event-logs">
                    {eventLogs.map((record, index) => (
                      <li key={`${index}-${record}`} className="jsb-event-log">
                        {record}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          )}
        </div>
      </PageShell>
    </>
  );
}
