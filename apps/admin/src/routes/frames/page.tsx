import { Alert, Button, Empty, Grid, Typography } from "@arco-design/web-react";
import type { ReactNode } from "react";

import PageContainer from "../../components/page-container";
import { useFrameCatalog } from "../../hooks/use-frame-catalog";
import { useIsMobile, useIsTablet } from "../../hooks/use-responsive";
import type { FrameCatalogEntry } from "../../types";
import FrameCard, { FrameCardPlaceholder } from "./components/frame-card";

import "./index.css";

const { Row, Col } = Grid;

// arco 栅格总列数,span 换算用。
const ARCO_GRID_COLUMNS = 24;

// 列数口径:桌面 4 / 平板 3 / 手机单列。
// 这里存 span(24 栅格)而不是列数,渲染时不必每处再除一次。
const COLUMN_SPAN = {
  desktop: 6,
  tablet: 8,
  mobile: 24
} as const;

type Viewport = keyof typeof COLUMN_SPAN;

const GRID_GUTTER: [number, number] = [16, 16];

// useIsTablet 只在 768~1024 为 true,两个 hook 不可能同真;同假即桌面(≥1024)。
function resolveViewport(isMobile: boolean, isTablet: boolean): Viewport {
  if (isMobile) {
    return "mobile";
  }
  return isTablet ? "tablet" : "desktop";
}

const PAGE_HINT = <Typography.Text type="secondary">选择一种相框样式,进入批量导出</Typography.Text>;

// 文案常量而不是 JSX 内联:prettier 会折行,折行处会给中文句子塞进一个 ASCII 空格。
const EMPTY_HINT =
  "在 public/frames.json 的 frames 数组里添加条目,缩略图放到 public/assets/thumbs/,刷新页面生效。";

interface PageBodyProps {
  error: string | null;
  loading: boolean;
  frames: FrameCatalogEntry[];
  viewport: Viewport;
  onRetry: () => Promise<void>;
}

/**
 * 装载状态 → 页面主体。判定顺序即优先级:错误 > 加载中 > 空清单 > 列表。
 * 反过来写会在首轮请求未回来时闪一帧「暂无可用相框」。
 */
function PageBody({ error, loading, frames, viewport, onRetry }: PageBodyProps) {
  const colSpan = COLUMN_SPAN[viewport];

  if (error) {
    return (
      <Alert
        className="frames-error"
        type="error"
        title="相框清单装载失败"
        content={
          // 装载错误本身就是人话(见 utils/catalog 的 CatalogError),原样展出,不再二次拼接句子。
          <>
            <div>{error}</div>
            <div className="frames-error-detail">
              清单是随包的 public/frames.json,确认它没被改坏后点重试。
            </div>
          </>
        }
        action={
          <Button type="primary" size="small" onClick={() => void onRetry()}>
            重试
          </Button>
        }
      />
    );
  }

  if (loading) {
    // 占位卡按当前列数铺满一行:只放一个 spinner 会在清单到位时整版跳动。
    const placeholderCells: ReactNode[] = [];
    for (let index = 0; index < ARCO_GRID_COLUMNS / colSpan; index += 1) {
      placeholderCells.push(
        <Col key={`placeholder-${index}`} span={colSpan}>
          <FrameCardPlaceholder />
        </Col>
      );
    }
    return (
      <Row gutter={GRID_GUTTER} className={`frame-grid frame-grid--${viewport}`}>
        {placeholderCells}
      </Row>
    );
  }

  if (!frames.length) {
    return (
      <Empty
        className="frames-empty"
        description={
          <div>
            <div>暂无可用相框</div>
            <div className="frames-empty-hint">{EMPTY_HINT}</div>
          </div>
        }
      />
    );
  }

  return (
    <Row gutter={GRID_GUTTER} className={`frame-grid frame-grid--${viewport}`}>
      {frames.map((entry) => (
        <Col key={entry.id} span={colSpan}>
          <FrameCard entry={entry} />
        </Col>
      ))}
    </Row>
  );
}

/**
 * 相框列表(阶段 12):清单一行一条,加样式即加卡片,本页结构不随样式数量变。
 *
 * 只消费静态清单(hooks/use-frame-catalog 已排好序,这里不再排),不碰渲染引擎。
 */
export default function FramesListPage() {
  const { frames, loading, error, reload } = useFrameCatalog();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  return (
    <PageContainer extra={PAGE_HINT}>
      <PageBody
        error={error}
        loading={loading}
        frames={frames}
        viewport={resolveViewport(isMobile, isTablet)}
        onRetry={reload}
      />
    </PageContainer>
  );
}
