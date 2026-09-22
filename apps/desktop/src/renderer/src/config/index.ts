/**
 * 渲染层环境变量唯一读取口(纪律同 site,docs/desktop-shell-plan.md 决策 6):
 * - `import.meta.env` 只允许出现在本文件,且必须按成员访问,禁止在业务代码散读;
 * - 新增 VITE_* 槽位:先在 src/renderer/src/env.d.ts 登记类型,再在本文件补默认值与
 *   语义字段,最后同步 apps/desktop/.env.example(D3 卡交付);
 * - 渲染层禁读 process.env(客户端产物无 Node process),业务代码一律消费下方
 *   rendererEnv 单例,或注入 env 源调用 loadRendererEnv(便于测试)。
 */

// 类型化 env(camelCase 语义名;空串/false 表示未配置或关闭)。
export interface RendererEnv {
  /** API baseURL;留空走同源相对路径(dev 由 electron-vite 代理,生产由网关同域转发),预留坑。 */
  apiBase: string;
  /** 埋点强制关闭;VITE_TRACK_DISABLED=true 时 sdk/track 整体 no-op。 */
  trackDisabled: boolean;
  /** 是否 dev 构建(vite 注入的非 VITE_ 槽位);dev 下埋点默认关闭。 */
  dev: boolean;
}

// 解析 env 为语义字段;默认值在此集中兜底,不依赖调用方传参。
export function loadRendererEnv(env: ImportMetaEnv = import.meta.env): RendererEnv {
  return {
    apiBase: env.VITE_API_BASE ?? "",
    trackDisabled: env.VITE_TRACK_DISABLED === "true",
    dev: env.DEV
  };
}

// 启动即解析的单例:渲染层各模块首次 import 时完成读取。
export const rendererEnv: RendererEnv = loadRendererEnv();
