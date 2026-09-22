import { PropsWithChildren, useEffect } from "react";
import Taro, { useError, useLaunch, usePageNotFound, useUnhandledRejection } from "@tarojs/taro";

import { ErrorBoundary } from "./component/ErrorBoundary";
import {
  captureError,
  captureMessage,
  flushMonitor,
  normalizeJsError,
  normalizePageNotFound,
  normalizeUnhandledRejection
} from "./core/monitor";
import { mark } from "./core/perf";
import { flushTrack } from "./core/track";
import { refreshNetworkType } from "./core/track/params";
import { checkUpdate } from "./core/update";

import "./app.css";

function App({ children }: PropsWithChildren) {
  // 启动打点(N2.3)+ 更新检查(N5.4):dev 环境 checkUpdate 内部自动跳过
  useLaunch(() => {
    mark("app.launch");
    checkUpdate({
      onUpdateFailed: () => captureMessage("js_error", "小程序新版本下载失败")
    });
  });

  // 全局错误收口一行接线(N3,保持原样)
  useError((errorMessage) => captureError(normalizeJsError(errorMessage)));
  useUnhandledRejection((res) => captureError(normalizeUnhandledRejection(res)));
  usePageNotFound((res) => captureError(normalizePageNotFound(res)));

  // 生命周期与网络接线(N5.4):
  // - 网络变化 → 刷新 core/track 公共参数缓存(埋点 network 字段保鲜);
  // - app 回前台 → 刷新网络缓存;
  // - app 退后台 → 显式 flush track/monitor(transport 队列自身也有 hide flush,此为语义补接线)。
  useEffect(() => {
    const networkHandler = (res: { networkType?: string }) => {
      if (typeof res?.networkType === "string" && res.networkType !== "") {
        refreshNetworkType(undefined, res.networkType);
      }
    };
    const onShow = () => refreshNetworkType();
    const onHide = () => {
      void flushTrack();
      void flushMonitor();
    };
    Taro.onNetworkStatusChange(networkHandler);
    Taro.onAppShow(onShow);
    Taro.onAppHide(onHide);
    return () => {
      Taro.offNetworkStatusChange(networkHandler);
      Taro.offAppShow(onShow);
      Taro.offAppHide(onHide);
    };
  }, []);

  // 渲染异常根兜底(N5.1)
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default App;
