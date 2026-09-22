// @arms/rum-browser 最小类型声明(h5 依赖未安装期间供 tsc 通过,见 docs/h5-shell-plan.md 阶段 2.A):
// 仅覆盖 core/monitor/arms.ts 实际调用的 API 面(init/sendException/sendCustom,
// 完整模型见 @arms/rum-core 的 Shell/RumExceptionEvent/RumCustomEvent),
// 收口阶段正式安装依赖后,本文件可删除。
//
// 注意:core/track/arms.d.ts 已声明同名 ambient module(含 default 导出),两份声明按
// namespace 合并;ambient module 的 default 导出重复声明会报 Duplicate identifier,
// 因此本文件只补 monitor 侧具名成员,不重复声明 default。
declare module "@arms/rum-browser" {
  /** SDK 异常事件载荷(monitor 转发 captureError 用,完整模型见 RumExceptionEvent)。 */
  export interface ArmsRumExceptionPayload {
    source?: string;
    type?: string;
    name?: string;
    message?: string;
    file?: string;
    stack?: string;
    line?: number;
    column?: number;
  }

  /** SDK 自定义事件载荷(monitor 转发 captureMessage 用,完整模型见 RumCustomEvent)。 */
  export interface ArmsRumMessagePayload {
    type: string;
    name: string;
    group?: string;
    value: number;
  }

  /** monitor 侧扩展调用面:default 实例除 init 外还暴露 sendException/sendCustom。 */
  export interface ArmsRumMonitorSdk {
    init: (config: { pid: string; endpoint: string; version?: string; spaMode?: string }) => unknown;
    sendException?: (payload: ArmsRumExceptionPayload | Error) => void;
    sendCustom?: (payload: ArmsRumMessagePayload) => void;
  }
}
