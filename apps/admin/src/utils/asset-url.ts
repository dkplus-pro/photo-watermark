import { APP_BASENAME } from "../constants";
import type { AssetUrl } from "./frame/types";

/**
 * 静态资源 URL 拼接(D10/D11):public 下的资源在 Pages 子路径部署时带 basePath 前缀,
 * 任何 `public/` 引用都必须经本函数,硬编码 `/frames.json` 会在子路径部署下 404。
 */
export const assetUrl: AssetUrl = (path) => {
  const normalizedPath = path.replace(/^\/+/gu, "");
  if (APP_BASENAME === "/") {
    return `/${normalizedPath}`;
  }
  return `${APP_BASENAME}/${normalizedPath}`;
};
