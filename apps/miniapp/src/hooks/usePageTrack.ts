// 页面级 page_view 埋点挂钩(方案 docs/miniapp-shell-plan.md §5 阶段 2.2):
// 页面组件调用 usePageTrack(),onShow 时自动上报一次 page_view;
// 只经 core/track 的业务入口消费,公共参数与采样由 core 统一组装,页面不关心。
import Taro, { useDidShow } from "@tarojs/taro";

import { pageView } from "../core/track";

/** 页面曝光埋点:extra 透传为事件附加字段(不可序列化值会被 JSON 串化丢语义,勿传函数)。 */
export function usePageTrack(extra?: Record<string, unknown>): void {
  useDidShow(() => {
    // getCurrentInstance 在页面生命周期内必有值;兜底 "unknown" 保上报链路不抛错
    const path = Taro.getCurrentInstance()?.router?.path ?? "unknown";
    pageView(path, extra);
  });
}
