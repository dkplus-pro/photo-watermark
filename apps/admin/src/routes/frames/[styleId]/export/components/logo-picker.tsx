import {
  Button,
  Card,
  Select,
  Skeleton,
  Slider,
  Space,
  Typography,
  Upload
} from "@arco-design/web-react";
import type { UploadProps } from "@arco-design/web-react";
import { IconDelete, IconImage } from "@arco-design/web-react/icon";
import { useMemoizedFn } from "ahooks";
import { useMemo } from "react";

import { useObjectUrl } from "../../../../../hooks/use-object-url";
import { CUSTOM_LOGO_ID, NO_LOGO_ID } from "../../../../../store/export";
import type { LogoCatalogEntry } from "../../../../../types";
import { assetUrl } from "../../../../../utils/asset-url";
import { LOGO_SIZE_MAX, LOGO_SIZE_MIN } from "../../../../../utils/frame/types";

import "./components.css";

/**
 * logo 选择器(阶段 11,选项集合后来从竖排 radio 收拢成 Select 下拉)。
 *
 * 它是三件事的组合,任何一条 arco 现成组件都不完全覆盖:
 * 1. 选项集合是「不添加 + 自定义上传 + 清单项」的合成列表,其中「自定义 logo」**恒居第二位**
 *    (仅随「不添加」之后)且不在 `logos.json` 里,所以清单本身给不出这个顺序;
 * 2. 选中自定义项后要就地长出一个图片选择器与预览/移除,这一段是纯自定义交互;
 * 3. 预设 logo 图是为相框底部**黑色信息条**做的浅色图,直接铺在浅色卡片上等于看不见,
 *    所以预览必须垫深底(见 `.logo-picker-preview` 的 `--color-black`)。深底预览块放在
 *    下拉选项里;收起后的触发器只回显纯文字(`renderFormat`),不占卡片的宽度预算。
 *    下拉可搜索(`showSearch`),按展示名过滤——预设项是富内容,arco 默认的文本匹配
 *    对它不可靠,所以过滤口径统一走触发器回显的同一段标签逻辑。
 *
 * 装载中/装载失败由页面呈现,本组件仍要能独立活下来:清单为空、条目字段缺失、id 撞上哨兵值
 * 都不能让它崩或让两个 option 用同一个 value(value 相同会让 Select 的选中态互相顶掉)。
 */

export interface LogoPickerProps {
  logos: LogoCatalogEntry[];
  loading: boolean;
  /** 预设 id / CUSTOM_LOGO_ID / NO_LOGO_ID 三选一 */
  value: string;
  customFile: File | null;
  /** logo大小档位(LOGO_SIZE_MIN..LOGO_SIZE_MAX) */
  logoSize: number;
  disabled: boolean;
  onChange(id: string): void;
  onCustomFile(file: File | null): void;
  onLogoSizeChange(size: number): void;
}

/** 与图片选择器同一口径:原生 `accept` 只做选图器筛选,不在组件里判死用户选的东西。 */
const IMAGE_ACCEPT: UploadProps["accept"] = { type: "image/*", strict: false };

/** arco 的 `UploadItem` 未从包根导出,按 props 派生。 */
type UploadItem = NonNullable<UploadProps["fileList"]>[number];

const { Option } = Select;

const NO_LOGO_LABEL = "不添加";
const CUSTOM_LOGO_LABEL = "自定义 logo";
const LOGO_SIZE_LABEL = "logo大小";
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
  logoSize,
  disabled,
  onChange,
  onCustomFile,
  onLogoSizeChange
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

  // 触发器只回显纯文字:富内容(深底预览块)留给下拉选项。value 不在合成列表里
  // (清单换版本后的残留偏好)时回显空串,与「不选中任何项」的旧口径一致。
  const triggerLabelOf = useMemoizedFn((optionValue: string | number | undefined): string => {
    if (optionValue === NO_LOGO_ID) return NO_LOGO_LABEL;
    if (optionValue === CUSTOM_LOGO_ID) return CUSTOM_LOGO_LABEL;
    return options.find((option) => option.id === optionValue)?.label ?? "";
  });

  // arco 的 `disabled` 只把触发器变灰,隐藏 input 仍在 DOM 里:实测直接对它派发 change
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
        <Select
          className="logo-picker-select"
          value={value}
          disabled={disabled}
          showSearch
          // 预设项是富内容(图 + 名),arco 默认按 option 文本匹配对它不可靠:
          // 统一改按「展示名」过滤,两个哨兵项与预设项用同一句人话参与搜索。
          filterOption={(inputValue, option) => {
            const optionValue = (option?.props as { value?: string } | undefined)?.value;
            return triggerLabelOf(optionValue)
              .toLowerCase()
              .includes(inputValue.trim().toLowerCase());
          }}
          // Select 的值域是 string | number,这里只有落在合成列表里的 id 才写回 store。
          onChange={(next) => {
            if (typeof next === "string" && allowedIds.includes(next)) onChange(next);
          }}
          renderFormat={(option) => triggerLabelOf(option?.value)}
        >
          <Option value={NO_LOGO_ID}>{NO_LOGO_LABEL}</Option>
          {/* 自定义项恒居第二位:清单怎么增减都不影响它的位置。 */}
          <Option value={CUSTOM_LOGO_ID}>{CUSTOM_LOGO_LABEL}</Option>
          {options.map((option) => (
            <Option key={option.id} value={option.id}>
              <Space className="logo-picker-option">
                <LogoOptionPreview option={option} />
                <span className="logo-picker-option-name">{option.label}</span>
              </Space>
            </Option>
          ))}
        </Select>
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

      <div className="logo-size-field">
        <Typography.Text className="logo-size-label">{LOGO_SIZE_LABEL}</Typography.Text>
        <Slider
          // range 模式下 arco 回调是二元组,这里只有单值分支会落到 store。
          onChange={(next) => {
            if (typeof next === "number") onLogoSizeChange(next);
          }}
          className="logo-size-slider"
          disabled={disabled}
          max={LOGO_SIZE_MAX}
          min={LOGO_SIZE_MIN}
          step={1}
          // 档位是 5–10 的整数:每档一个刻度线,连续滑杆变成了可对位的档位选择。
          showTicks
          value={logoSize}
        />
        <Typography.Text className="logo-size-value" type="secondary">
          {String(logoSize)}
        </Typography.Text>
      </div>
    </Card>
  );
}

export default LogoPicker;
