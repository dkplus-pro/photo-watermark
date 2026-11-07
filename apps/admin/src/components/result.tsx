import {
  IllustrationFailure,
  IllustrationNotFound,
  IllustrationSuccess
} from "@douyinfe/semi-illustrations";
import { Empty } from "@douyinfe/semi-ui";
import type { ReactNode } from "react";

export type ResultStatus = "404" | "error" | "success";

interface ResultProps {
  /** 结果类型:决定插图(404 / 错误 / 成功)。 */
  status: ResultStatus;
  className?: string;
  title?: ReactNode;
  subTitle?: ReactNode;
  /** 操作区(按钮组),渲染在描述下方。 */
  extra?: ReactNode;
}

// Semi 没有结果页组件:
// 以 Empty + @douyinfe/semi-illustrations 封装 status/title/subTitle/extra
// 四件套的结果页,页面用起来与常见 UI 库的 Result 同形。
const STATUS_ILLUSTRATIONS: Record<ResultStatus, typeof IllustrationSuccess> = {
  "404": IllustrationNotFound,
  error: IllustrationFailure,
  success: IllustrationSuccess
};

export default function Result({ status, className, title, subTitle, extra }: ResultProps) {
  const Illustration = STATUS_ILLUSTRATIONS[status];
  return (
    <Empty
      className={
        className
          ? `app-result app-result--${status} ${className}`
          : `app-result app-result--${status}`
      }
      image={<Illustration style={{ width: 160, height: 160 }} />}
      title={title}
      description={subTitle}
    >
      {extra}
    </Empty>
  );
}
