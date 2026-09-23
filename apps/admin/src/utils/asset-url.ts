import { APP_BASENAME } from "../constants";
import type { AssetUrl } from "./frame/types";

/** appTools 把 `server.publicDir` 的内容拷到 `dist/public/`,并以 `/public/` 前缀对外提供。 */
const PUBLIC_URL_SEGMENT = "public";

/**
 * 静态资源 URL 拼接(D10/D11):public 下的资源在 Pages 子路径部署时带 basePath 前缀,
 * 任何 `public/` 引用都必须经本函数,硬编码 `/assets/...` 会在子路径部署下 404。
 */
export const assetUrl: AssetUrl = (path) => {
  const normalizedPath = path.replace(/^\/+/gu, "");
  const prefix = APP_BASENAME === "/" ? "" : APP_BASENAME;
  return `${prefix}/${PUBLIC_URL_SEGMENT}/${normalizedPath}`;
};
