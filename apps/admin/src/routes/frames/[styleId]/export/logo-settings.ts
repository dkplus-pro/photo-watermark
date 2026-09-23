import { useEffect, useState } from "react";

import { CUSTOM_LOGO_ID, NO_LOGO_ID } from "../../../../store/export";
import type { LogoCatalogEntry } from "../../../../types";
import { assetUrl } from "../../../../utils/asset-url";
import { displayNameOf } from "../../../../utils/file-name";
import type { FrameRenderSettings } from "../../../../utils/frame/types";

/**
 * logo 三态 → 渲染入参 `{ logoMark, logoBlob }` 的映射(阶段 13)。
 *
 * | store 状态 | logoMark | logoBlob |
 * | --- | --- | --- |
 * | `NO_LOGO_ID`("none") | `""` | `null` |
 * | `CUSTOM_LOGO_ID`("custom") | 自定义图的主名(文件名兜底) | 用户选的 File(0 字节按无图处理) |
 * | 预设 id | 清单的 `mark` | 同源取回的 Blob,取不到则 `null` |
 * | 清单里没有的 id | `""` | `null` |
 *
 * 「预设图取不到不整页失败」是硬要求:绘制端(render-core)在 bitmap 解码失败/缺位图时
 * 会退回画 `mark` 文字块,所以 blob 给 null 只是观感降级,产物仍然正确。
 * 反过来,0 字节的图必须挡在这里——它会喂给解码器一个必然失败的输入,
 * 让**每一张**照片都进失败列表(D7 的单张失败会波及整批),比不画 logo 坏得多。
 *
 * 依赖纪律:本模块只做「清单条目 → 渲染入参」的映射,不 import 流水线与 store 动作。
 */

export type LogoSettings = Pick<FrameRenderSettings, "logoMark" | "logoBlob">;

export const EMPTY_LOGO_SETTINGS: LogoSettings = { logoMark: "", logoBlob: null };

/**
 * 预设 logo 的一次性缓存(键为清单里的相对路径)。
 * 预设图是随包静态资源,内容在会话内不变,故缓存不按 logoId 失效;
 * 用户来回切 logo 选择时因此不重复请求(每次切换都重取一遍是白耗 connect-src 配额)。
 */
const presetBlobCache = new Map<string, Blob>();

const isUsableBlob = (blob: Blob | null): blob is Blob => blob !== null && blob.size > 0;

/** 取预设图;任何失败(网络 reject / 非 2xx / 空文件)都降级为 `blob: null`。 */
const fetchPresetBlob = async (source: string): Promise<Blob | null> => {
  const cached = presetBlobCache.get(source);
  if (cached) return cached;
  try {
    // 本站唯一允许的 fetch:同源 public 资源(D10),URL 必须经 assetUrl 拼 basePath。
    const response = await fetch(assetUrl(source));
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!isUsableBlob(blob)) return null;
    presetBlobCache.set(source, blob);
    return blob;
  } catch {
    return null;
  }
};

export async function resolveLogoSettings(
  logos: readonly LogoCatalogEntry[],
  logoId: string,
  customLogoFile: File | null
): Promise<LogoSettings> {
  if (logoId === NO_LOGO_ID) {
    return EMPTY_LOGO_SETTINGS;
  }
  if (logoId === CUSTOM_LOGO_ID) {
    if (!customLogoFile) return EMPTY_LOGO_SETTINGS;
    return {
      logoMark: displayNameOf(customLogoFile),
      logoBlob: isUsableBlob(customLogoFile) ? customLogoFile : null
    };
  }
  const entry = logos.find((logo) => logo.id === logoId);
  if (!entry) return EMPTY_LOGO_SETTINGS;
  return {
    logoMark: entry.mark,
    logoBlob: await fetchPresetBlob(entry.source)
  };
}

/**
 * 把 logo 选择解析成渲染入参,供实时预览与导出共用同一份结果。
 *
 * 这里用 effect 不是「useEffect 手动拉接口」(AGENTS 第 6 节禁的是请求库式的取数):
 * 它读的是一次性静态资源,且必须在 React 生命周期外可取消 —— 用户快速来回切 logo 时,
 * 先发的请求后回来不能覆盖新选择,故 `active` 标志 + 卸载后不再 setState。
 */
export function useLogoSettings(
  logos: readonly LogoCatalogEntry[],
  logoId: string,
  customLogoFile: File | null
): LogoSettings {
  const [settings, setSettings] = useState<LogoSettings>(EMPTY_LOGO_SETTINGS);

  useEffect(() => {
    let active = true;
    void resolveLogoSettings(logos, logoId, customLogoFile).then((next) => {
      if (active) setSettings(next);
    });
    return () => {
      active = false;
    };
  }, [logos, logoId, customLogoFile]);

  return settings;
}
