import { Card, Radio, Slider, Typography } from "@arco-design/web-react";
import { memo } from "react";

import { QUALITY_MAX, QUALITY_MIN } from "../../../utils/compress/format";
import type { CompressOutputMode } from "../../../utils/compress/format";

import "./settings-card.css";

const RadioGroup = Radio.Group;

/**
 * 压缩设置卡:输出模式 + 质量滑杆。状态在 store(偏好,白名单持久化),
 * 本组件只回传用户动作,不做任何决策。
 *
 * 文案口径:「修改只对之后添加的图片生效」必须说清楚——压缩是入队即自动执行的,
 * 改设置不会重跑列表里已有的条目(重跑语义不在 v1 范围)。
 */

export interface SettingsCardProps {
  mode: CompressOutputMode;
  quality: number;
  onModeChange(mode: CompressOutputMode): void;
  onQualityChange(quality: number): void;
}

const MODE_OPTIONS: ReadonlyArray<{ value: CompressOutputMode; label: string }> = [
  { value: "smart", label: "智能" },
  { value: "original", label: "保持原格式" },
  { value: "webp", label: "转 WebP" },
  { value: "jpeg", label: "转 JPEG" }
];

function SettingsCardImpl({ mode, quality, onModeChange, onQualityChange }: SettingsCardProps) {
  return (
    <Card className="compress-settings" title="压缩设置" size="small">
      <div className="compress-settings-row">
        <span className="compress-settings-label">输出格式</span>
        <RadioGroup
          value={mode}
          onChange={(value: string | number | boolean) =>
            onModeChange(String(value) as CompressOutputMode)
          }
        >
          {MODE_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
            </Radio>
          ))}
        </RadioGroup>
      </div>
      <div className="compress-settings-row">
        <span className="compress-settings-label">质量</span>
        <Slider
          className="compress-settings-slider"
          min={QUALITY_MIN}
          max={QUALITY_MAX}
          step={5}
          value={quality}
          formatTooltip={(value) => `${String(value)}%`}
          onChange={(value) => onQualityChange(Number(value))}
        />
        <Typography.Text type="secondary" className="compress-settings-quality">
          {String(quality)}%
        </Typography.Text>
      </div>
      <Typography.Text type="secondary" className="compress-settings-hint">
        质量对 JPEG / WebP
        输出生效;修改设置只对之后添加的图片生效。所有处理都在本机浏览器完成,图片不会上传。
      </Typography.Text>
    </Card>
  );
}

export const SettingsCard = memo(SettingsCardImpl);
export default SettingsCard;
