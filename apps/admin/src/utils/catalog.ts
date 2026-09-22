import { FRAMES_CATALOG_PATH, LOGOS_CATALOG_PATH } from "../constants";
import type { FrameCatalog, FrameCatalogEntry, LogoCatalog, LogoCatalogEntry } from "../types";
import { assetUrl } from "./asset-url";
import { listFrameStyleIds } from "./frame/style-registry";

/**
 * 静态清单装载与守卫(阶段 6)。
 *
 * 清单是用户可自行替换的口子,因此「解析失败」必须发生在装载期且给出可定位的中文消息,
 * 而不是让半截数据流到列表页与渲染链路里。守卫全部手写:清单形状稳定且极小,
 * 引入 zod 这类依赖只会给静态站点增加体积与维护面。
 */

/** 失败归类:三种处置方式不同,所以必须机器可读地区分。 */
export type CatalogFailureKind =
  /** 清单文件不存在(404/410):资源没放对地方,或 basePath 与部署路径不一致 */
  | "missing"
  /** 请求本身失败(网络 reject / 其他非 2xx):部署或网络环境问题 */
  | "unreachable"
  /** 内容非法(JSON 语法错、字段缺失、id 重复、id 未注册):JSON 写错了 */
  | "invalid";

/**
 * 清单错误。选择「导出 class」而非 `isCatalogError()` 布尔判定:
 * class 让调用方 `instanceof` 判定与 TS 类型收窄同时成立,还能携带 kind 字段,
 * 布尔判定则要把同样的信息退化成 message 字符串匹配。
 */
export class CatalogError extends Error {
  readonly kind: CatalogFailureKind;

  constructor(message: string, kind: CatalogFailureKind = "invalid") {
    super(message);
    this.name = "CatalogError";
    this.kind = kind;
  }
}

const TYPE_LABELS: Record<string, string> = {
  string: "字符串",
  number: "数字",
  boolean: "布尔值",
  object: "对象",
  function: "函数",
  undefined: "缺失",
  bigint: "整数",
  symbol: "符号"
};

/** 把实际值压成一句人话,非法值消息里必须带上「实际是什么」。 */
const formatActual = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组";
  if (typeof value === "string") return value.trim() === "" ? "空白字符串" : `字符串`;
  return TYPE_LABELS[typeof value] ?? typeof value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 必填文本字段:非字符串、空串、纯空白都算缺失。 */
const requireText = (value: unknown, position: string, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogError(
      `${position}的 ${field} 缺失或不是非空字符串(实际:${formatActual(value)})`
    );
  }
  return value;
};

/** sortOrder:必须是有限正整数。0、负数、小数、NaN、Infinity 一律非法。 */
const requireSortOrder = (value: unknown, position: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new CatalogError(
      `${position}的 sortOrder 缺失或不是正整数(实际:${formatActual(value)}),` +
        `排序值必须是 ≥1 的整数`
    );
  }
  return value;
};

/**
 * 顶层形状 + version 校验。
 * version **只做记录不做判定**(0 与 1 同样通过):本站清单尚未出现第二版格式,
 * 版本号的存在意义是让未来的迁移分支有处可依据。数字本身必须是有限的。
 */
const requireShell = (
  raw: unknown,
  label: string
): Record<string, unknown> & { version: number } => {
  if (!isPlainObject(raw)) {
    throw new CatalogError(`${label}的顶层必须是对象(实际:${formatActual(raw)})`);
  }
  const { version } = raw;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    throw new CatalogError(
      `${label}的 version 缺失或不是数字(实际:${formatActual(version)}),` +
        `值本身不做范围判定,但必须存在`
    );
  }
  // 唯一的类型断言:上面已逐项验过 version 是有限数字,泛化的 Record 表达不出这点。
  return raw as Record<string, unknown> & { version: number };
};

const requireList = (raw: Record<string, unknown>, label: string, listKey: string): unknown[] => {
  const list = raw[listKey];
  if (!Array.isArray(list)) {
    throw new CatalogError(`${label}的 ${listKey} 缺失或不是数组(实际:${formatActual(list)})`);
  }
  return list;
};

/** 重复 id 直接报错:两份同 id 会让样式解析与 React key 产生二义。 */
const requireUniqueId = (id: string, position: string, seen: Set<string>): void => {
  if (seen.has(id)) {
    throw new CatalogError(`${position}的 id "${id}" 与前面的条目重复,同一份清单里的 id 必须唯一`);
  }
  seen.add(id);
};

/** 清单项的原始形状未知,多余字段一律忽略以获得前向兼容。 */
const asItem = (raw: unknown, position: string): Record<string, unknown> => {
  if (!isPlainObject(raw)) {
    throw new CatalogError(`${position} 必须是对象(实际:${formatActual(raw)})`);
  }
  return raw;
};

/** 解析并校验相框清单;任何非法都抛 CatalogError(kind = "invalid")。 */
export const parseFrameCatalog = (raw: unknown): FrameCatalog => {
  const label = "相框清单";
  const shell = requireShell(raw, label);
  const items = requireList(shell, label, "frames");
  const registeredStyleIds = listFrameStyleIds();
  const seen = new Set<string>();

  const frames: FrameCatalogEntry[] = items.map((item, index) => {
    const position = `${label}第 ${index + 1} 项`;
    const entry = asItem(item, position);
    const id = requireText(entry.id, position, "id");
    requireUniqueId(id, position, seen);
    // JSON 只做清单、样式靠代码分支:清单里出现画不出来的 id 必须当场失败。
    if (!registeredStyleIds.includes(id)) {
      throw new CatalogError(
        `${position}的 id "${id}" 未在样式注册表中登记,` +
          `已登记的样式有:${registeredStyleIds.join(", ") || "(无)"}`
      );
    }
    return {
      id,
      name: requireText(entry.name, position, "name"),
      thumbnail: requireText(entry.thumbnail, position, "thumbnail"),
      sortOrder: requireSortOrder(entry.sortOrder, position)
    };
  });

  // 空数组合法:用户删光了清单条目,列表页渲染空态即可,不是数据错误。
  return { version: shell.version, frames };
};

/** 解析并校验 logo 清单;自定义上传项由 UI 层固定追加,不出现在清单里。 */
export const parseLogoCatalog = (raw: unknown): LogoCatalog => {
  const label = "logo 清单";
  const shell = requireShell(raw, label);
  const items = requireList(shell, label, "logos");
  const seen = new Set<string>();

  const logos: LogoCatalogEntry[] = items.map((item, index) => {
    const position = `${label}第 ${index + 1} 项`;
    const entry = asItem(item, position);
    const id = requireText(entry.id, position, "id");
    requireUniqueId(id, position, seen);
    return {
      id,
      name: requireText(entry.name, position, "name"),
      source: requireText(entry.source, position, "source"),
      mark: requireText(entry.mark, position, "mark")
    };
  });

  return { version: shell.version, logos };
};

/**
 * 清单展示顺序:sortOrder 升序,同值按 id 稳定二次排序。
 * sortOrder 允许重复(用户手改 JSON 时很难维持严格递增),所以必须有确定性的第二键,
 * 否则同一份清单在两次装载里可能给出不同顺序。
 */
export const sortCatalogEntries = <T extends { id: string; sortOrder?: number }>(
  entries: readonly T[]
): T[] =>
  [...entries].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id, "en")
  );

/** 取一份清单的 JSON 文本并解析;失败按 kind 归类,消息里带上 URL 便于运维定位。 */
const fetchCatalogJson = async (path: string, label: string): Promise<unknown> => {
  const url = assetUrl(path);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new CatalogError(
      `${label}请求失败(网络中断):${url},原因:${cause instanceof Error ? cause.message : String(cause)}`,
      "unreachable"
    );
  }
  if (response.status === 404 || response.status === 410) {
    throw new CatalogError(
      `${label}文件不存在(HTTP ${response.status}):${url},` +
        `请确认 public/ 下已放置该文件且部署子路径与 basePath 一致`,
      "missing"
    );
  }
  if (!response.ok) {
    throw new CatalogError(`${label}请求失败(HTTP ${response.status}):${url}`, "unreachable");
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new CatalogError(
      `${label}内容非法,不是合法 JSON:${url},原因:${cause instanceof Error ? cause.message : String(cause)}`,
      "invalid"
    );
  }
};

/**
 * 并发装载两份清单。
 * 刻意让 parse 在 fetch 之后统一执行:任一份文件缺失时不必等另一份的解析结果就能失败,
 * 而 Promise.all 保证「先全部拿到、再全部校验」,不会把半套清单写进 store。
 */
export const loadCatalogs = async (): Promise<{
  frames: FrameCatalog;
  logos: LogoCatalog;
}> => {
  const [framesRaw, logosRaw] = await Promise.all([
    fetchCatalogJson(FRAMES_CATALOG_PATH, "相框清单"),
    fetchCatalogJson(LOGOS_CATALOG_PATH, "logo 清单")
  ]);
  return { frames: parseFrameCatalog(framesRaw), logos: parseLogoCatalog(logosRaw) };
};
