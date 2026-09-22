import { Button } from "@arco-design/mobile-react";
import type { ReactNode } from "react";

import "./error-view.css";

interface ErrorViewProps {
  /** 主提示文案(面向用户的人话,通常是 loader 的降级文案)。 */
  message: ReactNode;
  /** 补充说明,可选。 */
  description?: ReactNode;
  /** 重试回调:传入才渲染按钮,无重试能力的场景只展示文案。 */
  onRetry?: () => void;
  /** 重试按钮文案。 */
  retryText?: string;
}

// 错误/降级视图壳:页面失败态的统一展示层(方案 §3)。只做展示与回调透传,
// 错误上报走 core/monitor 接口(业务侧禁止直接引监控 SDK,见方案 §3 依赖方向)。
export default function ErrorView({
  message,
  description,
  onRetry,
  retryText = "重试"
}: ErrorViewProps) {
  return (
    <div className="h5-error-view" role="alert">
      <p className="h5-error-view-message">{message}</p>
      {description ? <p className="h5-error-view-description">{description}</p> : null}
      {onRetry ? (
        <Button className="h5-error-view-action" type="primary" size="medium" onClick={onRetry}>
          {retryText}
        </Button>
      ) : null}
    </div>
  );
}
