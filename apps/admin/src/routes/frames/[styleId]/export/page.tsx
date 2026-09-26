import { Alert, Button, Grid, Result, Skeleton, Space, Typography } from "@arco-design/web-react";
import type { BreadcrumbItem } from "../../../../components/page-container";
import { IconDownload, IconRefresh } from "@arco-design/web-react/icon";
import { useNavigate, useParams } from "@modern-js/runtime/router";
import { useMemoizedFn } from "ahooks";
import { useEffect, useMemo } from "react";

import PageContainer from "../../../../components/page-container";
import { useFrameCatalog } from "../../../../hooks/use-frame-catalog";
import { useIsMobile } from "../../../../hooks/use-responsive";
import { MOBILE_SOFT_LIMIT, useExportStore } from "../../../../store/export";
import { frameFieldsFromExif } from "../../../../utils/frame/fields";
import ExportProgressModal from "./components/export-progress-modal";
import FramePreview from "./components/frame-preview";
import ImagePicker from "./components/image-picker";
import LogoPicker from "./components/logo-picker";
import SizeTierPicker from "./components/size-tier-picker";
import { useLogoSettings } from "./logo-settings";
import { useFilePreparation } from "./use-file-preparation";
import { useExportFlow } from "./use-export-flow";
import { resolveStyleGuard } from "./style-guard";

import "./index.css";

const { Row, Col } = Grid;

// arco 栅格总列数,span 换算用(与相框列表同一口径)。
const ARCO_GRID_COLUMNS = 24;

/**
 * 导出页(阶段 13)——只做装配:样式守卫 → 表单四件套 + 实时预览 → 导出流程 → 进度弹框。
 * 绘制与打包全在 utils/frame 里,状态与守卫全在 store 里,本文件的每一行都属于「编排」。
 */

// 子路由 PageContainer 认不出菜单尾项(matchMenuTrail 走的是菜单声明),故显式给全链。
// 首页与相框列表都指 /frames:本站 `/` 只做重定向(D14),列表页就是事实上的首页。
const BREADCRUMB: BreadcrumbItem[] = [
  { title: "首页", path: "/frames" },
  { title: "水印相框" },
  { title: "相框列表", path: "/frames" },
  { title: "相框导出" }
];

const BACK_TO_LIST_LABEL = "返回相框列表";

interface GateProps {
  onBack(): void;
  onRetry?(): void;
}

/** 清单装载失败:与列表页同一口径,给重试而不是让用户自己刷新。 */
function CatalogErrorGate({ onBack, onRetry, message }: GateProps & { message: string }) {
  return (
    <Result
      className="export-gate"
      status="error"
      title="相框清单装载失败"
      subTitle={message}
      extra={
        <Space>
          <Button type="primary" onClick={onRetry}>
            重试
          </Button>
          <Button onClick={onBack}>{BACK_TO_LIST_LABEL}</Button>
        </Space>
      }
    />
  );
}

/**
 * 样式不存在(清单没有这个 id / 清单有但注册表没实现)。
 * 这里刻意不做任何「就近回落到默认样式」:回落等于拿另一款产物骗用户。
 */
function UnknownStyleGate({ onBack, message }: GateProps & { message: string }) {
  return (
    <Result
      className="export-gate"
      status="404"
      title="样式不存在"
      subTitle={message}
      extra={
        <Button type="primary" onClick={onBack}>
          {BACK_TO_LIST_LABEL}
        </Button>
      }
    />
  );
}

export default function FrameExportPage() {
  const { styleId } = useParams();
  const navigate = useNavigate();
  const { frames, logos, loading, error: catalogError, reload } = useFrameCatalog();
  const guard = resolveStyleGuard({
    styleId,
    frames,
    catalogLoading: loading,
    catalogError
  });
  const readyStyleId = guard.kind === "ready" ? guard.styleId : null;

  const files = useExportStore((state) => state.files);
  const sizeTier = useExportStore((state) => state.sizeTier);
  const logoId = useExportStore((state) => state.logoId);
  const logoSize = useExportStore((state) => state.logoSize);
  const customLogoFile = useExportStore((state) => state.customLogoFile);
  const status = useExportStore((state) => state.status);
  const done = useExportStore((state) => state.done);
  const failedCount = useExportStore((state) => state.failedCount);
  const total = useExportStore((state) => state.total);
  const failures = useExportStore((state) => state.failures);
  const zipFileName = useExportStore((state) => state.zipFileName);
  const exportError = useExportStore((state) => state.error);
  const setStyleId = useExportStore((state) => state.setStyleId);
  const setSizeTier = useExportStore((state) => state.setSizeTier);
  const setLogoId = useExportStore((state) => state.setLogoId);
  const setLogoSize = useExportStore((state) => state.setLogoSize);
  const setCustomLogo = useExportStore((state) => state.setCustomLogo);
  const addFiles = useExportStore((state) => state.addFiles);
  const removeFile = useExportStore((state) => state.removeFile);
  const clearFiles = useExportStore((state) => state.clearFiles);

  // 地址校验通过才写 store:否则未知样式会把 store 里残留的默认样式当成用户的选择。
  useEffect(() => {
    if (readyStyleId) setStyleId(readyStyleId);
  }, [readyStyleId, setStyleId]);

  useFilePreparation(files);
  const logo = useLogoSettings(logos, logoId, customLogoFile);
  const flow = useExportFlow({ files, styleId: readyStyleId ?? "", sizeTier, logoSize, logo });

  const isMobile = useIsMobile();
  // 两栏模式(桌面/平板)统一预览与表单各占一半;移动端单列且预览排在表单之后(JSX 顺序即视觉顺序)。
  const formSpan = isMobile ? ARCO_GRID_COLUMNS : ARCO_GRID_COLUMNS / 2;
  // 单列时预览仍要占满 24:反算出的 span 0 会被 arco 的 `.arco-col-0{display:none}` 整块藏掉。
  const previewSpan = isMobile ? ARCO_GRID_COLUMNS : ARCO_GRID_COLUMNS - formSpan;

  const goToList = useMemoizedFn(() => navigate("/frames"));
  const handleStart = useMemoizedFn(() => {
    void flow.startExport();
  });
  const handleRetry = useMemoizedFn(() => {
    void reload();
  });

  const firstEntry = files[0];
  const previewFields = useMemo(
    () => frameFieldsFromExif(firstEntry?.exif ?? undefined),
    [firstEntry?.exif]
  );

  const extra = (
    <Space>
      <Button
        type="primary"
        icon={<IconDownload />}
        loading={flow.exporting}
        disabled={readyStyleId === null}
        onClick={handleStart}
      >
        导出
      </Button>
      <Button icon={<IconRefresh />} disabled={flow.exporting} onClick={flow.resetForm}>
        重置
      </Button>
    </Space>
  );

  const renderBody = () => {
    if (guard.kind === "loading") {
      return <Skeleton className="export-gate" text={{ rows: 6 }} />;
    }
    if (guard.kind === "catalogError") {
      return <CatalogErrorGate message={guard.message} onBack={goToList} onRetry={handleRetry} />;
    }
    if (guard.kind === "unknownStyle") {
      return <UnknownStyleGate message={guard.message} onBack={goToList} />;
    }
    return (
      <Row gutter={[16, 16]} className={`export-layout${isMobile ? " export-layout--mobile" : ""}`}>
        <Col span={formSpan}>
          <div className="export-form">
            {flow.noFilesHint ? (
              <Alert
                className="export-hint"
                type="warning"
                title="还没有选择图片"
                content="请先在下面添加至少一张要导出的照片, 再点右上角「导出」。"
              />
            ) : null}
            {isMobile && files.length > MOBILE_SOFT_LIMIT ? (
              // D19:软提示,不拦人 —— 文案必须明说「可以继续」,否则用户会以为这是报错。
              <Alert
                className="export-hint"
                type="warning"
                title="移动端批量导出提示"
                content={`已选 ${String(files.length)} 张。移动端一次导出 ${String(
                  MOBILE_SOFT_LIMIT
                )} 张以上会较慢且占内存, 建议改用「小」档或分批导出; 也可以继续导出。`}
              />
            ) : null}
            <ImagePicker
              files={files}
              disabled={flow.busy}
              softLimit={MOBILE_SOFT_LIMIT}
              onAdd={addFiles}
              onRemove={removeFile}
              onClear={clearFiles}
            />
            <SizeTierPicker value={sizeTier} disabled={flow.busy} onChange={setSizeTier} />
            <LogoPicker
              logos={logos}
              loading={loading}
              value={logoId}
              customFile={customLogoFile}
              logoSize={logoSize}
              disabled={flow.busy}
              onChange={setLogoId}
              onCustomFile={setCustomLogo}
              onLogoSizeChange={setLogoSize}
            />
          </div>
        </Col>
        <Col span={previewSpan}>
          <FramePreview
            styleId={guard.styleId}
            source={firstEntry?.file ?? null}
            logoMark={logo.logoMark}
            logoBlob={logo.logoBlob}
            logoSize={logoSize}
            fields={previewFields}
            disabled={flow.busy}
          />
        </Col>
      </Row>
    );
  };

  return (
    <PageContainer breadcrumb={BREADCRUMB} extra={extra}>
      {guard.kind === "ready" ? (
        // 样式名回显:用户从列表点进来,地址栏被 basename 遮住,页面里得说清是哪一款。
        <Typography.Text className="export-style-name" type="secondary">
          {`相框样式: ${guard.name}`}
        </Typography.Text>
      ) : null}
      {renderBody()}
      <ExportProgressModal
        visible={flow.modalVisible}
        status={status}
        total={total}
        done={done}
        failedCount={failedCount}
        failures={failures}
        zipFileName={zipFileName}
        error={exportError}
        canRedownload={flow.canRedownload}
        onCancelExport={flow.requestCancel}
        onRedownload={flow.redownload}
        onDismiss={flow.dismissModal}
      />
    </PageContainer>
  );
}
