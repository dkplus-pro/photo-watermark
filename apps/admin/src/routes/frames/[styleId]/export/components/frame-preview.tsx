import { Alert, Button, Card, Empty, Skeleton, Spin, Typography } from "@arco-design/web-react";
import { IconRefresh } from "@arco-design/web-react/icon";
import { useDebounceFn, useMemoizedFn } from "ahooks";
import { useEffect, useRef, useState } from "react";

import { useObjectUrl } from "../../../../../hooks/use-object-url";
import { PREVIEW_LONG_EDGE } from "../../../../../utils/frame/types";
import { renderPreview } from "../../../../../utils/frame/preview-render";
import type { FrameFields } from "../../../../../utils/frame/types";

import "./components.css";

/**
 * 相框实时预览(阶段 11)。
 *
 * 为什么必须自建:arco 没有任何组件能「吃一个 File + 一份绘制参数 → 出一张画好的图」。
 * 本组件因此只做四件事,绘制策略一律留在 `utils/frame/preview-render`(D18 的 1200px 长边
 * 只在那一处生效):
 * 1. 参数变化时**防抖**地发起一次主线程渲染(选图器多选、连续换 logo 都会连击);
 * 2. 处理竞态——慢的那次后到也不能把新参数的画面盖掉;
 * 3. 把产物 Blob 交给 `useObjectUrl` 显示,旧 URL 由 hook 在换图/卸载时回收
 *    (组件自身一次 `URL.revokeObjectURL` 都不写:立即 revoke 正在展示的 URL 就是 Safari
 *    空白图的成因,D22);
 * 4. 失败呈现可读中文错误 + 重试,而不是一张空白图。
 *
 * 内存纪律:状态里恒只有一份产物 Blob(新结果到达即替换旧引用),预览按长边 1200px
 * 出图正是为了让这条链路敢被反复触发。
 */

export interface FramePreviewProps {
  styleId: string;
  /** 取用户选的第一张图做预览；null 显示空态 */
  source: File | null;
  logoMark: string;
  logoBlob: Blob | null;
  /** logo大小滑杆档位 */
  logoSize: number;
  fields: FrameFields;
  /** 页面正在导出时禁止重绘 */
  disabled: boolean;
}

/**
 * 防抖窗口。300ms 是「连续点选」与「等一下就看到」之间的经验值:
 * 一次 1200px 主线程渲染在移动端就是几百毫秒量级,窗口再短也省不掉那几次重绘。
 */
const PREVIEW_DEBOUNCE_MS = 300;

interface PreviewState {
  blob: Blob | null;
  error: string | null;
  rendering: boolean;
}

const EMPTY_STATE: PreviewState = { blob: null, error: null, rendering: false };

const errorTextOf = (cause: unknown): string =>
  cause instanceof Error && cause.message ? cause.message : "预览生成失败: 未知原因。";

export function FramePreview({
  styleId,
  source,
  logoMark,
  logoBlob,
  logoSize,
  fields,
  disabled
}: FramePreviewProps) {
  const [state, setState] = useState<PreviewState>(EMPTY_STATE);
  // 请求序号:每次真正开跑先自增并领号,回来时号不匹配就是「过期的慢请求」,直接丢弃。
  const sequenceRef = useRef(0);
  // `fields` 是页面每次渲染新建的对象,按内容比较才能避免「父组件一渲染就重画一张」。
  const fieldsKey = JSON.stringify(fields);

  const drawNow = useMemoizedFn(() => {
    if (!source) return;
    const token = sequenceRef.current + 1;
    sequenceRef.current = token;
    setState((prev) => ({ ...prev, rendering: true, error: null }));
    renderPreview({ source, styleId, logoMark, logoBlob, logoSize, fields })
      .then((blob) => {
        // 迟到的旧结果:它对应的参数已经不是屏幕上这套,写回去就是画面与选择器错位。
        if (sequenceRef.current !== token) return;
        setState({ blob, error: null, rendering: false });
      })
      .catch((cause: unknown) => {
        if (sequenceRef.current !== token) return;
        setState({ blob: null, error: errorTextOf(cause), rendering: false });
      });
  });

  const { run: scheduleDraw, cancel: cancelScheduledDraw } = useDebounceFn(drawNow, {
    wait: PREVIEW_DEBOUNCE_MS
  });

  const previewUrl = useObjectUrl(state.blob);

  useEffect(() => {
    if (!source) {
      // 换图/清空:在途结果作废,画面立刻回空态(留旧图会让人以为还在预览刚删掉的那张)。
      cancelScheduledDraw();
      sequenceRef.current += 1;
      setState(EMPTY_STATE);
      return;
    }
    if (disabled) {
      // 导出中不重绘:主线程正被流水线占着,再排一次预览只会让用户先看到卡顿。
      cancelScheduledDraw();
      return;
    }
    scheduleDraw();
    return () => {
      cancelScheduledDraw();
    };
  }, [
    source,
    styleId,
    logoMark,
    logoBlob,
    logoSize,
    fieldsKey,
    disabled,
    scheduleDraw,
    cancelScheduledDraw
  ]);

  const hasSource = Boolean(source);

  return (
    <Card
      className="frame-preview"
      title="效果预览"
      extra={
        <Typography.Text type="secondary">
          预览恒按长边 {String(PREVIEW_LONG_EDGE)}px 渲染, 与所选导出档位无关
        </Typography.Text>
      }
    >
      {!hasSource ? (
        <Empty className="frame-preview-empty" description="选择照片后即可看到相框效果" />
      ) : null}

      {hasSource && state.error ? (
        <Alert
          className="frame-preview-error"
          type="error"
          title="预览生成失败"
          content={state.error}
          action={
            <Button size="small" icon={<IconRefresh />} disabled={disabled} onClick={drawNow}>
              重试
            </Button>
          }
        />
      ) : null}

      {hasSource && !state.error && previewUrl ? (
        <img className="frame-preview-image" src={previewUrl} alt="相框预览效果" />
      ) : null}

      {hasSource && !state.error && !previewUrl ? (
        <div className="frame-preview-skeleton">
          {state.rendering ? <Spin loading /> : <Skeleton text={{ rows: 1 }} image={false} />}
        </div>
      ) : null}
    </Card>
  );
}

export default FramePreview;
