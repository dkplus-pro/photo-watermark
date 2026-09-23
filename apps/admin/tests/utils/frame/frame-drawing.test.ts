import { describe, expect, it } from "vitest";

import { FRAME_PALETTE, drawFrameComposition } from "../../../src/utils/frame/frame-drawing";
import {
  PLAIN_FRAME_STYLE_ID,
  getFrameStyle,
  listFrameStyleIds
} from "../../../src/utils/frame/style-registry";
import type { FrameFields, LogoRenderInput } from "../../../src/utils/frame/types";

/**
 * 绘制引擎单测(D16):mock 2D 上下文并记录每次绘制指令,断言坐标与比例,
 * 绝不做像素对比 —— canvas 光栅化在 node/jsdom 下不可靠且与机型相关。
 */

interface DrawCall {
  method: string;
  args: unknown[];
}

/** measureText 替身的固定字宽,让「字符数 → 占用宽度」可预测。 */
const CHAR_WIDTH = 8;

interface RecordingContext {
  context: CanvasRenderingContext2D;
  calls: DrawCall[];
  colorStops: DrawCall[];
}

const createRecordingContext = (): RecordingContext => {
  const calls: DrawCall[] = [];
  const colorStops: DrawCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  const gradient = {
    addColorStop: (offset: number, color: string): void => {
      colorStops.push({ method: "addColorStop", args: [offset, color] });
    }
  };
  const target = {
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    lineWidth: 1,
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
    strokeRect: record("strokeRect"),
    fillText: record("fillText"),
    drawImage: record("drawImage"),
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    stroke: record("stroke"),
    fill: record("fill"),
    rect: record("rect"),
    clip: record("clip"),
    translate: record("translate"),
    scale: record("scale"),
    setTransform: record("setTransform"),
    createLinearGradient: (...args: unknown[]) => {
      calls.push({ method: "createLinearGradient", args });
      return gradient;
    },
    measureText: (value: string) => ({ width: String(value).length * CHAR_WIDTH })
  };

  return { context: target as unknown as CanvasRenderingContext2D, calls, colorStops };
};

const makeBitmap = (width = 4000, height = 3000) => ({ width, height }) as unknown as ImageBitmap;

const methodsOf = (calls: DrawCall[], method: string) =>
  calls.filter((call) => call.method === method);

const numbersOf = (values: readonly unknown[]) => values.map((value) => Number(value));

/** 取第 n 次同名调用的参数并转成数值,缺失时抛出可读错误。 */
const argsOf = (calls: DrawCall[], method: string, index = 0) => {
  const entry = methodsOf(calls, method)[index];
  if (!entry) throw new Error(`未记录到第 ${index + 1} 次 ${method} 调用`);
  return entry.args;
};

/** 同上,直接拿到数值化的绘制量,便于断言坐标。 */
const numbersAt = (calls: DrawCall[], method: string, index = 0) =>
  numbersOf(argsOf(calls, method, index));

const textsDrawn = (calls: DrawCall[]) =>
  methodsOf(calls, "fillText").map((call) => String(call.args[0]));

const draw = (
  width: number,
  height: number,
  fields: FrameFields,
  logo?: LogoRenderInput
): RecordingContext => {
  const recorder = createRecordingContext();
  drawFrameComposition(recorder.context, width, height, makeBitmap(), fields, logo);
  return recorder;
};

const FULL_FIELDS: FrameFields = {
  brand: "ACME",
  model: "ACME Z-9",
  lens: "50mm f/1.4 Prime Lens",
  focalLength: "50mm",
  exposure: "f/1.4  1/250s  ISO 100"
};

const FIRST_ROW = "50mm  f/1.4  1/250s  ISO 100";
const SECOND_ROW = "ACME Z-9     50mm f/1.4 Prime Lens";

describe("drawFrameComposition 绘制顺序", () => {
  it("按黑底 → 原图 → 信息条渐变顺序落笔", () => {
    const { calls } = draw(1200, 900, FULL_FIELDS);
    expect(
      calls
        .slice(0, 5)
        .map((call) => call.method)
        .join(",")
    ).toBe("clearRect,fillRect,drawImage,createLinearGradient,fillRect");
    expect(argsOf(calls, "fillRect", 0)).toEqual([0, 0, 1200, 900]);
    const image = argsOf(calls, "drawImage", 0);
    expect(image[1]).toBe(0);
    expect(image[2]).toBe(0);
    expect(image[3]).toBe(1200);
    expect(image[4]).toBe(900);
  });

  it("信息条渐变自条底色渐入全透明", () => {
    const { calls, colorStops } = draw(1200, 900, FULL_FIELDS);
    expect(argsOf(calls, "createLinearGradient")).toEqual([0, 900, 0, 720]);
    expect(colorStops.map((stop) => stop.args)).toEqual([
      [0, FRAME_PALETTE.strip],
      [1, FRAME_PALETTE.stripFade]
    ]);
  });
});

describe("drawFrameComposition 几何比例(D4:去 clamp 后可缩放一致性)", () => {
  it("信息条高度、内边距与两行基线严格由宽高乘系数导出", () => {
    const { calls } = draw(1000, 800, FULL_FIELDS);
    // 信息条矩形:stripY = height - height*0.2,stripHeight = height*0.2
    expect(numbersOf(argsOf(calls, "fillRect", 1).slice(0, 2))).toEqual([0, 640]);
    expect(argsOf(calls, "fillRect", 1)[2]).toBe(1000);
    expect(argsOf(calls, "fillRect", 1)[3]).toBe(160);
    // 无 logo 时文字起点即左右内边距 = width*0.036
    const [firstX, firstY] = numbersOf(argsOf(calls, "fillText", 0).slice(1, 3));
    expect(firstX).toBeCloseTo(36, 6);
    expect(firstY).toBeCloseTo(640 + 160 * 0.48, 6);
    const [, secondY] = numbersOf(argsOf(calls, "fillText", 1).slice(1, 3));
    expect(secondY).toBeCloseTo(640 + 160 * 0.7, 6);
  });

  it("600 宽与 6000 宽的相对几何完全一致", () => {
    const normalized = (width: number, height: number) => {
      const { calls } = draw(width, height, FULL_FIELDS);
      const stripRect = numbersAt(calls, "fillRect", 1);
      const firstRowPoint = numbersAt(calls, "fillText", 0);
      const secondRowPoint = numbersAt(calls, "fillText", 1);
      const ratios = [
        stripRect[1] / height,
        stripRect[3] / height,
        firstRowPoint[1] / width,
        firstRowPoint[2] / height,
        secondRowPoint[2] / height
      ];
      return ratios.map((value) => Number(value.toFixed(6)));
    };
    expect(normalized(600, 400)).toEqual(normalized(6000, 4000));
    expect(normalized(600, 400)).toEqual([0.8, 0.2, 0.036, 0.896, 0.94]);
  });

  it("300×400 极小输入下所有绘制量仍为有限非负数", () => {
    const { calls } = draw(300, 400, FULL_FIELDS, { mark: "ACME", bitmap: makeBitmap(120, 40) });
    const numeric = ["clearRect", "fillRect", "fillText", "drawImage", "moveTo", "lineTo"];
    const relevant = calls.filter((call) => numeric.includes(call.method));
    expect(relevant.length).toBeGreaterThan(0);
    for (const call of relevant) {
      const values = call.args.filter((value) => typeof value === "number");
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    // 无下限兜底后信息条仍然落在画布内
    const [x, y, w, h] = numbersOf(argsOf(calls, "fillRect", 1));
    expect([x, y, w, h]).toEqual([0, 320, 300, 80]);
  });

  it("分隔竖线线宽是全表唯一保留的极值:窄画布兜到 1px", () => {
    expect(draw(300, 400, FULL_FIELDS, { mark: "ACME" }).context.lineWidth).toBe(1);
    expect(draw(1000, 800, FULL_FIELDS, { mark: "ACME" }).context.lineWidth).toBe(1.2);
    expect(draw(6000, 4000, FULL_FIELDS, { mark: "ACME" }).context.lineWidth).toBeCloseTo(7.2, 6);
  });
});

describe("drawFrameComposition 空值边界", () => {
  it("fields 全空时不产生任何 fillText,信息条仍然绘制", () => {
    const { calls } = draw(1200, 900, {});
    expect(methodsOf(calls, "fillText")).toHaveLength(0);
    expect(methodsOf(calls, "fillRect")).toHaveLength(2);
    expect(methodsOf(calls, "stroke")).toHaveLength(0);
  });

  it("两行全空时即便有 logo 也不画分隔竖线", () => {
    const { calls } = draw(1200, 900, {}, { mark: "ACME" });
    expect(methodsOf(calls, "moveTo")).toHaveLength(0);
    expect(methodsOf(calls, "stroke")).toHaveLength(0);
    expect(methodsOf(calls, "fillText")).toHaveLength(1);
  });

  it("仅第二行有值时只画一行并落在第二行基线", () => {
    const { calls } = draw(1000, 800, { lens: "50mm f/1.4" });
    expect(textsDrawn(calls)).toEqual(["50mm f/1.4"]);
    expect(numbersAt(calls, "fillText", 0)[2]).toBeCloseTo(640 + 160 * 0.7, 6);
  });

  it("第一行由焦距与曝光拼接,缺字段则不留间隔", () => {
    expect(textsDrawn(draw(1000, 800, { focalLength: "50mm", exposure: "f/2.8" }).calls)).toEqual([
      "50mm  f/2.8"
    ]);
    expect(textsDrawn(draw(1000, 800, { exposure: "f/2.8" }).calls)).toEqual(["f/2.8"]);
  });

  it("仅一行时落在单行基线 0.56", () => {
    const { calls } = draw(1000, 800, { focalLength: "50mm" });
    expect(numbersAt(calls, "fillText", 0)[2]).toBeCloseTo(640 + 160 * 0.56, 6);
  });

  it("mark 为空白串时视为无 logo", () => {
    const { calls } = draw(1000, 800, FULL_FIELDS, { mark: "   " });
    expect(methodsOf(calls, "fillText")).toHaveLength(2);
    expect(methodsOf(calls, "moveTo")).toHaveLength(0);
  });
});

describe("drawFrameComposition logo 分支", () => {
  it("无位图时走文字块:浅色底板 fillRect + 一条 fillText", () => {
    const { calls } = draw(1200, 900, FULL_FIELDS, { mark: "ACME" });
    expect(methodsOf(calls, "fillRect")).toHaveLength(3);
    const [plateX, plateY, plateWidth, plateHeight] = numbersAt(calls, "fillRect", 2);
    expect(plateX).toBeCloseTo(1200 * 0.036, 6);
    expect(plateHeight).toBeCloseTo(900 * 0.2 * 0.45, 6);
    expect(plateY).toBeCloseTo(720 + 180 * 0.56 - plateHeight / 2, 6);
    // 底板宽 = 文字实测宽 + 两侧 logo 高×0.42
    expect(plateWidth).toBeCloseTo(4 * CHAR_WIDTH + plateHeight * 0.42 * 2, 6);
    expect(plateWidth).toBeGreaterThan(plateHeight);
    expect(textsDrawn(calls)).toHaveLength(3);
    expect(textsDrawn(calls)[0]).toBe("ACME");
  });

  it("文字块按 logo 高的 2.4 倍截断", () => {
    const { calls } = draw(1200, 900, {}, { mark: "A".repeat(200) });
    const mark = textsDrawn(calls)[0] ?? "";
    expect(mark.endsWith("…")).toBe(true);
    // logo 高 = 900*0.2*0.45 = 81,可用文字宽 = 81*2.4 = 194.4,每字 8px → 含省略号 24 字
    expect(mark.length).toBe(24);
  });

  it("有位图时 drawImage 两次(原图 + logo),不画文字块底板", () => {
    const { calls } = draw(1200, 900, FULL_FIELDS, { mark: "ACME", bitmap: makeBitmap(400, 200) });
    expect(methodsOf(calls, "drawImage")).toHaveLength(2);
    expect(methodsOf(calls, "fillRect")).toHaveLength(2);
    expect(textsDrawn(calls)).toEqual([FIRST_ROW, SECOND_ROW]);
    const [, logoX, logoY, logoWidth, logoHeight] = numbersAt(calls, "drawImage", 1);
    const maxHeight = 900 * 0.2 * 0.45;
    expect(logoHeight).toBeCloseTo(maxHeight, 6);
    expect(logoWidth).toBeCloseTo((400 * maxHeight) / 200, 6);
    expect(logoX).toBeCloseTo(1200 * 0.036, 6);
    expect(logoY).toBeCloseTo(720 + 180 * 0.56 - maxHeight / 2, 6);
  });

  it("超宽位图受画布宽 0.2 的外接框约束并保持宽高比", () => {
    const { calls } = draw(1000, 800, FULL_FIELDS, {
      mark: "ACME",
      bitmap: makeBitmap(2000, 100)
    });
    const [, , , logoWidth, logoHeight] = numbersAt(calls, "drawImage", 1);
    expect(logoWidth).toBeCloseTo(1000 * 0.2, 6);
    expect(logoHeight).toBeCloseTo((1000 * 0.2 * 100) / 2000, 6);
  });

  it("有 logo 且有文字时:分隔线落在 logo 右外侧,文字起点再右移一个间隔", () => {
    const { calls } = draw(1000, 800, FULL_FIELDS, {
      mark: "ACME",
      bitmap: makeBitmap(200, 100)
    });
    const paddingX = 1000 * 0.036;
    const gap = paddingX * 0.54;
    const logoHeight = 800 * 0.2 * 0.45;
    const logoWidth = 200 * Math.min((1000 * 0.2) / 200, logoHeight / 100);
    const [dividerX, dividerTop] = numbersAt(calls, "moveTo");
    expect(dividerX).toBeCloseTo(paddingX + logoWidth + gap, 6);
    expect(dividerTop).toBeCloseTo(640 + 160 * 0.4, 6);
    const [lineX, lineBottom] = numbersAt(calls, "lineTo");
    expect(lineX).toBeCloseTo(dividerX, 6);
    expect(lineBottom).toBeCloseTo(640 + 160 * 0.7, 6);
    expect(methodsOf(calls, "save")).toHaveLength(1);
    expect(methodsOf(calls, "restore")).toHaveLength(1);
    expect(numbersAt(calls, "fillText", 0)[1]).toBeCloseTo(paddingX + logoWidth + gap * 2, 6);
  });
});

describe("fitText 越界截断", () => {
  it("超出可用宽度时逐字截断并以省略号结尾", () => {
    const { calls } = draw(600, 400, { focalLength: "X".repeat(1000) });
    const text = textsDrawn(calls)[0] ?? "";
    expect(text.endsWith("…")).toBe(true);
    // 可用宽 = 600 - 2*600*0.036 = 556.8,每字 8px → 含省略号 69 字
    expect(text.length).toBe(69);
  });

  it("宽度充裕时不截断", () => {
    const { calls } = draw(6000, 4000, { focalLength: "35mm", lens: "sigma 30mm" });
    expect(textsDrawn(calls)).toEqual(["35mm", "sigma 30mm"]);
  });

  it("前后空白被裁掉", () => {
    expect(textsDrawn(draw(2000, 1000, { lens: "  sigma 30mm  " }).calls)).toEqual(["sigma 30mm"]);
  });
});

describe("style-registry(D2 样式注册表)", () => {
  it("已知 id 命中黑底样式,draw 即绘制引擎本身", () => {
    const style = getFrameStyle(PLAIN_FRAME_STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.id).toBe("plain-frame");
    expect(style?.draw).toBe(drawFrameComposition);
  });

  it("未知 id 返回 null 而不是回落第一种样式", () => {
    expect(getFrameStyle("unknown-frame")).toBeNull();
    expect(getFrameStyle("")).toBeNull();
  });

  it("清单当前只登记 plain-frame", () => {
    expect(listFrameStyleIds()).toEqual(["plain-frame"]);
    expect(PLAIN_FRAME_STYLE_ID).toBe("plain-frame");
  });
});
