// @arms/rum-browser 最小类型声明(h5 未将该 SDK 纳入依赖,见 docs/h5-shell-plan.md 阶段 2.B):
// 仅覆盖 arms.ts 实际调用的 API 面(init/sendEvent,与 apps/site/src/config/rum.ts 同口径),
// 完整类型以 SDK 自带 d.ts 为准;若后续收口阶段正式安装依赖,本文件可删除。
declare module "@arms/rum-browser" {
  /** SDK 初始化配置:endpoint 必填,pid/version/spaMode 可选(对齐 site rum.ts 使用面)。 */
  interface ArmsRumInitConfig {
    pid?: string;
    endpoint: string;
    version?: string;
    spaMode?: string;
  }

  const armsRum: {
    init: (config: ArmsRumInitConfig) => unknown;
    sendEvent?: (event: Record<string, unknown>) => void;
  };

  /** 业务自定义事件上报(SDK README「运行时 API」推荐的命名导出)。 */
  function sendEvent(event: Record<string, unknown>): void;

  export default armsRum;
  export { sendEvent };
}
