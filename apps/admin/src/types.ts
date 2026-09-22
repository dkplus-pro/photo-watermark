/**
 * 运行时数据形状:public/ 下静态清单 JSON 的解析结果。
 *
 * 与 `utils/frame/types.ts`(渲染契约)是两个层次,互不 import:
 * 本文件描述「清单里写了什么」,渲染契约描述「画布上怎么画」。
 * 清单条目的 `id` 必须能在 `utils/frame/style-registry.ts` 里查到,这条约束由
 * `utils/catalog.ts` 的守卫强制,不靠约定。
 */

/** frames.json 的一条相框清单项。 */
export interface FrameCatalogEntry {
  /** 样式 id,必须命中 style-registry 已注册项 */
  id: string;
  /** 列表页展示名 */
  name: string;
  /** 相对 public 根的缩略图路径(不含前导 `/`),消费侧经 assetUrl() 拼前缀 */
  thumbnail: string;
  /** 升序展示;同值按 id 稳定二次排序 */
  sortOrder: number;
}

export interface FrameCatalog {
  /** 清单格式版本,只做记录不参与判定(0 也合法) */
  version: number;
  frames: FrameCatalogEntry[];
}

/** logos.json 的一条 logo 预设。 */
export interface LogoCatalogEntry {
  id: string;
  /** 表单展示名 */
  name: string;
  /** 相对 public 根的预设图路径(不含前导 `/`),自定义上传项不出现在清单里 */
  source: string;
  /** 文字兜底:预设图缺失或用户上传自定义图失败时,绘制端按 mark 画文字块 */
  mark: string;
}

export interface LogoCatalog {
  version: number;
  logos: LogoCatalogEntry[];
}
