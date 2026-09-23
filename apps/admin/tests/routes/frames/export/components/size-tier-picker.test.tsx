// 输出档位选择器用例(阶段 11)。
// 六类边界覆盖:
//   空值 —— value 为空串(偏好尚未落定)时三档照常渲染且无选中项;
//   零值 —— 档位键全是字符串,本组件没有数值入参,不适用;
//   越界 —— value 是清单外的档位键(旧版本持久化数据残留)时不崩、不给任何档位上选中态;
//   权限缺失 —— 不适用:本站匿名公开、无鉴权(AGENTS.md 第 3 节);
//   上游失败 —— 不适用:本组件零外部数据源,只读 utils/frame/types 里的编译期清单;
//   非法状态迁移 —— disabled(导出进行中)时点击不产生 onChange。
// 另有一条「文案不写死」守卫:label/hint 逐字等于 SIZE_TIERS 的内容——改 D3 的配额数字即自动跟上,
// 组件里再抄一份尺寸文案就是下一次改档位时必然漂移的第二处事实源。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import SizeTierPicker from "../../../../../src/routes/frames/[styleId]/export/components/size-tier-picker";
import { SIZE_TIERS, SIZE_TIER_KEYS } from "../../../../../src/utils/frame/types";
import type { SizeTierKey } from "../../../../../src/utils/frame/types";

const makeProps = (value: SizeTierKey = "medium") => ({
  value,
  disabled: false,
  onChange: vi.fn()
});

/** 档位按钮的展示文本:label + hint 两个 span 拼起来,顺序即 SIZE_TIER_KEYS 顺序。 */
const optionText = (tier: SizeTierKey): string =>
  `${SIZE_TIERS[tier].label}${SIZE_TIERS[tier].hint}`;

const buttonLabels = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(".arco-radio-button")).map(
    (node) => node.textContent ?? ""
  );

afterEach(cleanup);

describe("档位渲染", () => {
  test("渲染条数 === 清单条数,label 与 hint 逐字取自 SIZE_TIERS(组件里没有第二份文案)", () => {
    const { container } = render(<SizeTierPicker {...makeProps()} />);

    expect(buttonLabels(container)).toEqual(SIZE_TIER_KEYS.map(optionText));
  });

  test("当前档位以 checked 呈现;顺序跟随 SIZE_TIER_KEYS(不按体积重排,保持「原图/中/小」读法)", () => {
    const { container } = render(<SizeTierPicker {...makeProps("small")} />);
    const checked = container.querySelectorAll(".arco-radio-checked");

    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe(optionText("small"));
    expect(buttonLabels(container)[0]).toBe(optionText("original"));
  });
});

describe("选择档位", () => {
  test("点未选中的档位即以该档键回调 onChange", async () => {
    const props = makeProps("medium");
    render(<SizeTierPicker {...props} />);

    await userEvent.click(screen.getByText(SIZE_TIERS.original.label));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith("original");
  });

  test("点已选中的档位不回调(arco 原生语义,页面因此少一次等价 setState)", async () => {
    const props = makeProps("medium");
    const { container } = render(<SizeTierPicker {...props} />);

    await userEvent.click(container.querySelectorAll(".arco-radio-button input")[1]);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  test("越界:value 是清单外的档位键时不崩,也不给任何档位上选中态", () => {
    const { container } = render(<SizeTierPicker {...makeProps("ultra-4k" as SizeTierKey)} />);

    expect(buttonLabels(container)).toHaveLength(SIZE_TIER_KEYS.length);
    expect(container.querySelectorAll(".arco-radio-checked")).toHaveLength(0);
  });

  test("空值:value 为空串时三档仍在且无选中项", () => {
    const { container } = render(<SizeTierPicker {...makeProps("" as SizeTierKey)} />);

    expect(buttonLabels(container)).toHaveLength(SIZE_TIER_KEYS.length);
    expect(container.querySelectorAll(".arco-radio-checked")).toHaveLength(0);
  });

  test("非法状态迁移:disabled 时点击不产生 onChange", async () => {
    const props = { ...makeProps("medium"), disabled: true };
    const { container } = render(<SizeTierPicker {...props} />);

    await userEvent.click(container.querySelectorAll(".arco-radio-button input")[2]);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
