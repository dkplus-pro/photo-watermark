// PageState 纯逻辑(与 Taro 渲染解耦,便于 node 环境单测):
// 四态文案解析 + 重试入口派生。对齐 mobile 侧 PageStatus 语义。
export type PageStatus = "loading" | "empty" | "error" | "success";

export const PAGE_STATE_DEFAULT_EMPTY_MESSAGE = "暂无数据";
export const PAGE_STATE_DEFAULT_ERROR_MESSAGE = "加载失败,请稍后重试";
export const PAGE_STATE_RETRY_LABEL = "重试";

export interface PageStateCopyInput {
  status: PageStatus;
  errorMessage?: string;
  emptyMessage?: string;
  /** error 态是否有重试入口(组件层由 onRetry 是否存在推导) */
  retryable: boolean;
}

export interface PageStateCopy {
  /** empty/error 态文案;其余态空串 */
  message: string;
  showRetry: boolean;
}

/** 四态文案解析:空串/纯空白回退默认文案;非法 status 兜底为 error 默认文案(不重试)。 */
export function resolvePageStateCopy(input: PageStateCopyInput): PageStateCopy {
  const errorMessage = pickMessage(input.errorMessage, PAGE_STATE_DEFAULT_ERROR_MESSAGE);
  const emptyMessage = pickMessage(input.emptyMessage, PAGE_STATE_DEFAULT_EMPTY_MESSAGE);
  switch (input.status) {
    case "error":
      return { message: errorMessage, showRetry: input.retryable };
    case "empty":
      return { message: emptyMessage, showRetry: false };
    case "loading":
    case "success":
      return { message: "", showRetry: false };
    default:
      // 运行时非法值(强转/JS 调用方):兜底 error 默认文案,不给重试
      return { message: PAGE_STATE_DEFAULT_ERROR_MESSAGE, showRetry: false };
  }
}

function pickMessage(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? fallback : (value as string);
}
