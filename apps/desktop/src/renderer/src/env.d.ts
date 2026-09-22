/// <reference types="vite/client" />

// 渲染层 import.meta.env 类型登记(与 src/config 的唯一读取口配套,纪律同 site):
// 新增 VITE_* 槽位先在此声明类型,再在 src/renderer/src/config/index.ts 加默认值与
// 语义字段,最后同步 apps/desktop/.env.example(D3 卡交付)。
interface ImportMetaEnv {
  /** API baseURL:dev/prod 均留空走同源(dev 由 dev server 代理,生产由网关同域转发),预留坑。 */
  readonly VITE_API_BASE?: string;
  /** 埋点强制关闭:置 "true" 时 sdk/track 整体 no-op。 */
  readonly VITE_TRACK_DISABLED?: string;
}
