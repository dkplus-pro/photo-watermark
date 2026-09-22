import { Skeleton } from "@arco-design/web-react";
import { IconRight } from "@arco-design/web-react/icon";
import { useNavigate } from "@modern-js/runtime/router";
import type { MouseEvent } from "react";

import { APP_BASENAME } from "../../../constants";
import type { FrameCatalogEntry } from "../../../types";
import { assetUrl } from "../../../utils/asset-url";

// 导出页(/frames/:styleId/export)由后续 Wave 交付,列表页只负责跳过去。
function frameExportPath(styleId: string): string {
  return `/frames/${styleId}/export`;
}

// href 要带 basename(router 之外的浏览器行为不认识 basename),navigate 不带(它自己会叠加)。
function toAbsoluteHref(appPath: string): string {
  return APP_BASENAME === "/" ? appPath : `${APP_BASENAME}${appPath}`;
}

interface FrameCardProps {
  entry: FrameCatalogEntry;
}

/**
 * 相框缩略图卡片:整卡可点,点击进入该样式的批量导出页。
 *
 * 可点实现选真 `<a href>` 而非 `role="link"` + `tabIndex` + 键盘事件:链接天然自带 Tab 聚焦、
 * Enter 激活与焦点可见样式,还白拿中键/修饰键「新标签打开」——role 方案这几样都得手写,容易漏。
 */
export default function FrameCard({ entry }: FrameCardProps) {
  const navigate = useNavigate();
  const appPath = frameExportPath(entry.id);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 非主键或带修饰键的点击交给浏览器(新标签/新窗口),不劫持成 SPA 跳转。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    navigate(appPath);
  };

  return (
    <a className="frame-card" href={toAbsoluteHref(appPath)} onClick={handleClick}>
      <div className="frame-card-media">
        {/* thumbnail 是相对 public 根的路径,必须经 assetUrl 拼 basePath,裸路径在 Pages 子路径下必 404。
            样式名已由下方文本给出,图按装饰性处理(alt 空),免得链接可及名把名字念两遍。 */}
        <img className="frame-card-thumb" src={assetUrl(entry.thumbnail)} alt="" loading="lazy" />
      </div>
      <div className="frame-card-name">{entry.name}</div>
      {/* 移动端没有 hover,这一行是常驻可见的进入标记。 */}
      <div className="frame-card-cta">
        <span>去导出</span>
        <IconRight />
      </div>
    </a>
  );
}

/** loading 期间的占位卡:外壳与真实卡片同尺寸,清单到位时不跳版。 */
export function FrameCardPlaceholder() {
  return (
    <div className="frame-card-placeholder" aria-hidden={true}>
      <div className="frame-card-media">
        <Skeleton
          className="frame-card-placeholder-figure"
          image={{ shape: "square" }}
          text={false}
        />
      </div>
      <div className="frame-card-placeholder-name">
        <Skeleton image={false} text={{ rows: 1, width: "60%" }} />
      </div>
    </div>
  );
}
