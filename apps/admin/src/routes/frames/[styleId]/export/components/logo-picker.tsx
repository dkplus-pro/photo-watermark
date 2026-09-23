import { Button, Card, Radio, Skeleton, Space, Typography, Upload } from "@arco-design/web-react";
import type { UploadProps } from "@arco-design/web-react";
import { IconDelete, IconImage } from "@arco-design/web-react/icon";
import { useMemoizedFn } from "ahooks";
import { useMemo } from "react";

import { useObjectUrl } from "../../../../../hooks/use-object-url";
import { CUSTOM_LOGO_ID, NO_LOGO_ID } from "../../../../../store/export";
import type { LogoCatalogEntry } from "../../../../../types";
import { assetUrl } from "../../../../../utils/asset-url";

import "./components.css";

/**
 * logo 选择器(阶段 11)。
 *
 * 它是三件事的组合,任何一条 arco 现成组件都不覆盖:
 * 1. 选项集合是「不添加 + 清单项 + 自定义上传」的合成列表,其中「自定义 logo」**恒为末项**
 *    (需求原文的位置约定)且不在 `logos.json` 里,所以清单本身给不出这个顺序;
 * 2. 选中自定义项后要就地长出一个图片选择器与预览/移除,这一段是纯自定义交互;
 * 3. 预设 logo 图是为相框底部**黑色信息条**做的浅色图,直接铺在浅色卡片上等于看不见,
 *    所以预览必须垫深底(见 `.logo-picker-preview` 的 `--color-black`)。
 *
 * 装载中/装载失败由页面呈现,本组件仍要能独立活下来:清单为空、条目字段缺失、id 撞上哨兵值
 * 都不能让它崩或让两个 radio 用同一个 value(value 相同会让 Radio.Group 的选中态互相顶掉)。
 */

export interface LogoPickerProps {
  logos: LogoCatalogEntry[];
  loading: boolean;
  /** 预设 id / CUSTOM_LOGO_ID / NO_LOGO_ID 三选一 */
  value: string;
  customFile: File | null;
  disabled: boolean;
  onChange(id: string): void;
  onCustomFile(file: File | null): void;
}

/** 与图片选择器同一口径:原生 `accept` 只做选图器筛选,不在组件里判死用户选的东西。 */
const IMAGE_ACCEPT: UploadProps["accept"] = { type: "image/*", strict: false };

/** arco 的 `UploadItem` 未从包根导出,按 props 派生。 */
type UploadItem = NonNullable<UploadProps["fileList"]>[number];

const NO_LOGO_LABEL = "不添加";
const CUSTOM_LOGO_LABEL = "自定义 logo";
const CUSTOM_LOGO_MISSING_HINT = "还没有选择自定义图片, 相框会退回用文字标识绘制。";

/** 清单条目的最低可渲染形状:id 必须存在且不与两个哨兵值撞车,展示名缺失时回落 mark/id。 */
interface LogoOption {
  id: string;
  label: string;
  source: string;
  mark: string;
}

const toLogoOption = (entry: LogoCatalogEntry | null | undefined): LogoOption | null => {
  if (!entry || typeof entry.id !== "string" || !entry.id) return null;
  if (entry.id === NO_LOGO_ID || entry.id === CUSTOM_LOGO_ID) return null;
  const mark = typeof entry.mark === "string" ? entry.mark : "";
  return {
    id: entry.id,
    label: entry.name || mark || entry.id,
    source: typeof entry.source === "string" ? entry.source : "",
    mark
  };
};

/** 预设项的图:浅色调的 logo 必须有深底才看得见,`source` 缺失/为空时退化为 mark 文字块。 */
function LogoOptionPreview({ option }: { option: LogoOption }) {
  if (!option.source) {
    return <span className="logo-picker-preview logo-picker-preview--mark">{option.mark}</span>;
  }
  // 资源路径必须经 assetUrl:Pages 子路径部署下裸 `/assets/...` 必 404(AGENTS.md 第 9 节)。
  return (
    <img className="logo-picker-preview" src={assetUrl(option.source)} alt="" loading="lazy" />
  );
}

export function LogoPicker({
  logos,
  loading,
  value,
  customFile,
  disabled,
  onChange,
  onCustomFile
}: LogoPickerProps) {
  const options = useMemo(
    () =>
      (Array.isArray(logos) ? logos : [])
        .map(toLogoOption)
        .filter((option): option is LogoOption => option !== null),
    [logos]
  );
  const allowedIds = [NO_LOGO_ID, ...options.map((option) => option.id), CUSTOM_LOGO_ID];
  const customUrl = useObjectUrl(customFile);
  const isCustomChosen = value === CUSTOM_LOGO_ID;

  // arco 的 `disabled` 只把触发按钮变灰,隐藏 input 仍在 DOM 里:实测直接对它派发 change
  // 依旧会走到 onChange。导出进行中必须守住这条不变量,所以在自己的回调里再判一次。
  const handleCustomPick = useMemoizedFn((_fileList: UploadItem[], file: UploadItem) => {
    if (disabled) return;
    if (file.originFile) onCustomFile(file.originFile);
  });

  return (
    <Card className="logo-picker" title="logo">
      {loading ? (
        <Skeleton text={{ rows: 3, width: ["60%", "70%", "50%"] }} />
      ) : (
        <Radio.Group
          className="logo-picker-group"
          value={value}
          disabled={disabled}
          // Radio.Group 的值域是 string | number,这里只有落在合成列表里的 id 才写回 store。
          onChange={(next) => {
            if (typeof next === "string" && allowedIds.includes(next)) onChange(next);
          }}
        >
          <Radio className="logo-picker-option" value={NO_LOGO_ID}>
            {NO_LOGO_LABEL}
          </Radio>
          {options.map((option) => (
            <Radio key={option.id} className="logo-picker-option" value={option.id}>
              <Space>
                <LogoOptionPreview option={option} />
                <span className="logo-picker-option-name">{option.label}</span>
              </Space>
            </Radio>
          ))}
          {/* 自定义项恒为末项:清单怎么改都不影响它的位置(需求原文约定)。 */}
          <Radio className="logo-picker-option" value={CUSTOM_LOGO_ID}>
            {CUSTOM_LOGO_LABEL}
          </Radio>
        </Radio.Group>
      )}

      {isCustomChosen ? (
        <div className="logo-picker-custom">
          {customFile ? (
            <>
              {customUrl ? (
                <img className="logo-picker-preview" src={customUrl} alt="" loading="lazy" />
              ) : (
                <span className="logo-picker-preview logo-picker-preview--mark">
                  {CUSTOM_LOGO_LABEL}
                </span>
              )}
              <Typography.Text className="logo-picker-custom-name" ellipsis={{ showTooltip: true }}>
                {customFile.name}
              </Typography.Text>
              <Button
                size="small"
                icon={<IconDelete />}
                disabled={disabled}
                onClick={() => onCustomFile(null)}
              >
                移除
              </Button>
            </>
          ) : (
            <>
              <Upload
                accept={IMAGE_ACCEPT}
                autoUpload={false}
                showUploadList={false}
                disabled={disabled}
                onChange={handleCustomPick}
              >
                <Button icon={<IconImage />} disabled={disabled}>
                  选择 logo 图片
                </Button>
              </Upload>
              <Typography.Text type="secondary" className="logo-picker-custom-hint">
                {CUSTOM_LOGO_MISSING_HINT}
              </Typography.Text>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export default LogoPicker;
