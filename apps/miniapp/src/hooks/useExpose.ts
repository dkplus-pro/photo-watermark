// 曝光 hook:Taro.createIntersectionObserver 观测 + core/track/expose-logic 决策。
// 决策/去重全部在 expose-logic(纯函数,已单测);本文件只做宿主接线。
import Taro from "@tarojs/taro";
import { useEffect } from "react";

import { captureMessage } from "../core/monitor";
import { expose, type EventProps } from "../core/track";
import { createExposeSession } from "../core/track/expose-logic";

/** Taro.createIntersectionObserver 首参类型(页面/组件实例)。 */
type ObserverHost = Parameters<typeof Taro.createIntersectionObserver>[0];

export interface UseExposeOptions {
  /** 观测目标选择器(ExposeView 生成的唯一 id,形如 "#expose-view-3") */
  selector: string;
  trackId: string;
  props?: EventProps;
}

export function useExpose({ selector, trackId, props }: UseExposeOptions): void {
  useEffect(() => {
    let observer: ReturnType<typeof Taro.createIntersectionObserver> | undefined;
    try {
      // Taro 4 类型要求首参为页面/组件实例(运行时等价 wx.createIntersectionObserver(component, options));
      // 组件侧观测当前页面,故取页面实例传参,取不到时按页面级调用(失败进 catch 降级)。
      observer = Taro.createIntersectionObserver(
        Taro.getCurrentInstance().page as unknown as ObserverHost
      );
    } catch {
      // 降级(风险表):观测器创建失败 → 直接上报一次 + 记 monitor
      captureMessage("js_error", "曝光观测器创建失败,已降级直接上报", { trackId });
      expose(trackId, props);
      return;
    }
    const session = createExposeSession({
      trackId,
      report: (id) => expose(id, props)
    });
    try {
      observer.relativeToViewport().observe(selector, (res) => {
        const ratio = typeof res?.intersectionRatio === "number" ? res.intersectionRatio : 0;
        session.onVisible(ratio);
      });
    } catch {
      captureMessage("js_error", "曝光观测器挂载失败,已降级直接上报", { trackId });
      expose(trackId, props);
      session.dispose();
      return;
    }
    return () => {
      session.dispose();
      try {
        observer?.disconnect();
      } catch {
        // disconnect 失败静默
      }
    };
    // props 取首帧值:变更不重建观测(曝光语义以挂载时刻上下文为准)
  }, [selector, trackId]);
}
