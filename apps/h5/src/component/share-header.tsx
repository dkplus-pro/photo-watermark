import type { ReactNode } from "react";

import "./share-header.css";

interface ShareHeaderProps {
  /** 页面主标题(活动名/接口返回的业务字段)。 */
  title: ReactNode;
  /** 副标题或说明文案,可选。 */
  description?: ReactNode;
  /** 右侧操作插槽(分享入口占位:微信 JSSDK 不在本期,见 docs/h5-shell-plan.md §7)。 */
  extra?: ReactNode;
}

// 分享头部壳:活动页统一页头(标题 + 说明 + 右侧插槽)。分享能力只留插槽不接 JSSDK,
// 后续接入时改壳一层即可,业务页不用跟着动。
export default function ShareHeader({ title, description, extra }: ShareHeaderProps) {
  return (
    <header className="h5-share-header">
      <div className="h5-share-header-text">
        <h1 className="h5-share-header-title">{title}</h1>
        {description ? <p className="h5-share-header-description">{description}</p> : null}
      </div>
      {extra ? <div className="h5-share-header-extra">{extra}</div> : null}
    </header>
  );
}
