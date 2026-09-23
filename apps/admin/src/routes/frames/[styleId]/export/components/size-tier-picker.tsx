import { Card, Radio, Typography } from "@arco-design/web-react";

import { SIZE_TIERS, SIZE_TIER_KEYS } from "../../../../../utils/frame/types";
import type { SizeTierKey } from "../../../../../utils/frame/types";

import "./components.css";

/**
 * 输出档位选择器(阶段 11)。
 *
 * 为什么自建而不是用 arco `Select`:三档之间是**并列且必须全部可见**的取舍(用户要靠对比
 * 「2400 万 / 1200 万 / 300 万」决定移动端选哪档),`Select` 会把没选中的两档折进下拉里,
 * 恰好抹掉了这道题的题干。`Radio.Group type="button"` 是 arco 原生形态,不引新组件。
 *
 * 全部文案(档位名 + 兆数提示)一律从 `SIZE_TIERS` 读,组件里不写死任何尺寸数字:
 * D3 的配额改了、或者有人把「中」调成 8MP,这里要自动跟上——写死就是必然漂移的第二处事实源。
 */

export interface SizeTierPickerProps {
  value: SizeTierKey;
  disabled: boolean;
  onChange(tier: SizeTierKey): void;
}

/** Radio.Group 的回传值是 `string | number`,只有清单里登记过的键才允许写回 store。 */
const toSizeTierKey = (value: string | number): SizeTierKey | null =>
  SIZE_TIER_KEYS.find((tier) => tier === value) ?? null;

export function SizeTierPicker({ value, disabled, onChange }: SizeTierPickerProps) {
  return (
    <Card className="size-tier-picker" title="输出档位">
      <Radio.Group
        type="button"
        value={value}
        disabled={disabled}
        onChange={(next) => {
          const tier = toSizeTierKey(next);
          // 非清单值(被改坏的持久化数据、arco 内部异常回传)不覆盖当前档位。
          if (tier) onChange(tier);
        }}
      >
        {SIZE_TIER_KEYS.map((tier) => (
          <Radio key={tier} value={tier}>
            <span className="size-tier-option">
              <span className="size-tier-option-label">{SIZE_TIERS[tier].label}</span>
              <span className="size-tier-option-hint">{SIZE_TIERS[tier].hint}</span>
            </span>
          </Radio>
        ))}
      </Radio.Group>
      <Typography.Text className="size-tier-picker-note" type="secondary">
        档位只改输出尺寸,不改 JPEG 质量;图片小于档位时按原尺寸输出(只缩不放)。
      </Typography.Text>
    </Card>
  );
}

export default SizeTierPicker;
