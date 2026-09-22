import { describe, expect, it } from "vitest";

import {
  JPEG_EXTENSION,
  SIZE_UNAVAILABLE,
  ZIP_FILE_PREFIX,
  buildZipFileName,
  displayNameOf,
  formatByteSize,
  outputNameOf,
  sanitizeBaseName,
  uniqueName
} from "../../src/utils/file-name";

/**
 * 文件命名工具单测。
 *
 * 「权限缺失」与「网络失败」两类边界不适用:本模块是纯字符串运算 + 本地 File 读名,
 * 不触碰网络与浏览器授权;「非法状态迁移」同样不适用(无状态),
 * 对应的守卫换成「不修改入参 Set」这类纯函数契约断言。
 */

const makeFile = (name: string): File => new File(["image-bytes"], name, { type: "image/jpeg" });

const pad2 = (value: number): string => String(value).padStart(2, "0");

describe("sanitizeBaseName", () => {
  it("只剥最后一个点之后的扩展名(日期点必须留在主名里)", () => {
    expect(sanitizeBaseName("photo.2026.01.jpg")).toBe("photo.2026.01");
    expect(sanitizeBaseName("IMG_001.JPG")).toBe("IMG_001");
    expect(sanitizeBaseName("无扩展名文件")).toBe("无扩展名文件");
  });

  it("空串 / 只有扩展名 / 只有空白都退回 untitled", () => {
    expect(sanitizeBaseName("")).toBe("untitled");
    expect(sanitizeBaseName(".jpg")).toBe("untitled");
    expect(sanitizeBaseName("   ")).toBe("untitled");
    expect(sanitizeBaseName("...")).toBe("untitled");
  });

  it("三平台非法字符与控制字符统一换成 _", () => {
    expect(sanitizeBaseName('a/b\\c:d*e?f"g<h>i|j.jpg')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeBaseName(`名前${String.fromCharCode(1)}${String.fromCharCode(31)}.jpg`)).toBe(
      "名前__"
    );
  });

  it("首尾空白与结尾点被清掉(Windows 不允许),名字中间的点保留", () => {
    expect(sanitizeBaseName("  my photo  .jpg")).toBe("my photo");
    expect(sanitizeBaseName("photo...jpg")).toBe("photo");
    expect(sanitizeBaseName("a . b .jpg")).toBe("a . b");
  });

  it("81 个字符恰好截到 80", () => {
    const result = sanitizeBaseName(`${"a".repeat(81)}.jpg`);
    expect(result).toBe("a".repeat(80));
    expect(Array.from(result)).toHaveLength(80);
  });

  it("截断按码点走,不把 emoji 切成半个代理对", () => {
    // "a" + 90 个 emoji = 91 码点(181 个 UTF-16 码元),按码元 slice(0,80) 会切出半个 🧪
    const result = sanitizeBaseName(`a${"🧪".repeat(90)}.jpg`);
    expect(Array.from(result)).toHaveLength(80);
    expect(result).toBe(`a${"🧪".repeat(79)}`);
    expect(/\p{Surrogate}/u.test(result)).toBe(false);
  });

  it("50 个 emoji + 主名的文件名原样保留(未越界就不截断)", () => {
    const result = sanitizeBaseName(`${"🧪".repeat(50)}x.jpg`);
    expect(Array.from(result)).toHaveLength(51);
    expect(result).toBe(`${"🧪".repeat(50)}x`);
  });

  it("截断后重新出现的尾随空格再次清掉", () => {
    // 79 个 a + " b" = 81 码点 → 截到 80 位只剩 `aaa…a ` ,尾随空格必须再清一次
    expect(sanitizeBaseName(`${"a".repeat(79)} b.jpg`)).toBe("a".repeat(79));
  });

  it("输出恒不为空、不以点开头、不含任何非法或控制字符", () => {
    const samples = ["", ".", "..", ".jpg", "  ", "///", "***.jpg", "\u0000", "\u0085abc"];
    for (const sample of samples) {
      const result = sanitizeBaseName(sample);
      expect(result).not.toBe("");
      expect(result).not.toMatch(/^\./u);
      // \p{Cc} 覆盖 C0 + C1 两段控制字符,与实现里的消毒口径一致
      expect(result).not.toMatch(/[\\/:*?"<>|\p{Cc}]/u);
    }
  });
});

describe("uniqueName", () => {
  it("未占用时原样返回", () => {
    expect(uniqueName(new Set(), "a.jpg")).toBe("a.jpg");
    expect(uniqueName(new Set(["b.jpg"]), "a.jpg")).toBe("a.jpg");
  });

  it("空串候选:未占用返回空串,占用则给主名兜出序号", () => {
    expect(uniqueName(new Set(), "")).toBe("");
    expect(uniqueName(new Set([""]), "")).toBe("-2");
  });

  it("序号插在扩展名之前而不是追加在末尾", () => {
    expect(uniqueName(new Set(["a.jpg"]), "a.jpg")).toBe("a-2.jpg");
    expect(uniqueName(new Set(["a"]), "a")).toBe("a-2");
    expect(uniqueName(new Set(["photo.2026.01.jpg"]), "photo.2026.01.jpg")).toBe(
      "photo.2026.01-2.jpg"
    );
  });

  it("连续占用 5 次仍能给出唯一名,且 used 不被修改(登记是调用方的职责)", () => {
    const used = new Set(["a.jpg"]);
    const produced: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = uniqueName(used, "a.jpg");
      expect(used.has(result)).toBe(false);
      produced.push(result);
      used.add(result);
    }
    expect(produced).toEqual(["a-2.jpg", "a-3.jpg", "a-4.jpg", "a-5.jpg", "a-6.jpg"]);

    const readOnly = new Set(["a.jpg", "a-2.jpg", "a-3.jpg", "a-4.jpg", "a-5.jpg"]);
    const snapshot = Array.from(readOnly);
    expect(uniqueName(readOnly, "a.jpg")).toBe("a-6.jpg");
    expect(Array.from(readOnly)).toEqual(snapshot);
  });

  it("序号试探 1000 次全被占用时退回时间戳,仍然不撞车且必然返回", () => {
    const used = new Set(["a.jpg"]);
    for (let index = 2; index <= 1001; index += 1) {
      used.add(`a-${String(index)}.jpg`);
    }
    expect(used.size).toBe(1001);

    const result = uniqueName(used, "a.jpg");
    expect(used.has(result)).toBe(false);
    expect(result).toMatch(/^a-\d{10,}\.jpg$/u);

    // 连时间戳名也被占用(同一毫秒再来一次)时走随机/确定性兜底:必须仍不撞车
    const hostile = new Set(used);
    hostile.add(result);
    const second = uniqueName(hostile, "a.jpg");
    expect(hostile.has(second)).toBe(false);
    expect(second.startsWith("a-")).toBe(true);
  });

  it("多点候选按最后一个点分段(序号永远插在扩展名之前)", () => {
    expect(uniqueName(new Set(["报告"]), "报告")).toBe("报告-2");
    expect(uniqueName(new Set(["a.tar.gz"]), "a.tar.gz")).toBe("a.tar-2.gz");
  });

  it("1001 张同名图走完整命名链:全部唯一、必然终止、命名层占用不超 12MB 红线", () => {
    // 越界守卫:用户一次性选了上千张手机导出的同名照片(现实中天天发生)。
    // 序号段可用 -2…-1001 共 1000 格,加上原始名刚好覆盖 1001 张;第 1002 张必然走到时间戳兜底,
    // 所以这里跑 1002 次:既验到规模上限,也验到「序号段耗尽后不往后堆」这条。
    const used = new Set<string>();
    const produced: string[] = [];
    for (let index = 0; index < 1002; index += 1) {
      const next = uniqueName(used, outputNameOf("IMG_0001.JPG"));
      expect(used.has(next)).toBe(false);
      used.add(next);
      produced.push(next);
    }

    // 断言口径落在「实际产出的文件清单」上,而不是 Set.size(两处都数一遍才能同时抓住漏登记与重名)
    expect(produced).toHaveLength(1002);
    expect(new Set(produced).size).toBe(1002);
    expect(produced.every((name) => name.endsWith(".jpg"))).toBe(true);
    expect(produced[0]).toBe("IMG_0001.jpg");
    expect(produced[1000]).toBe("IMG_0001-1001.jpg");
    expect(produced[1001]).toMatch(/^IMG_0001-\d{10,}\.jpg$/u);

    // 12MB 红线按 JS 字符串约 2 字节/码点折算:锁的是「命名层自己攒了多少字节」,
    // 不做堆采样(vitest 里 heapUsed 抖动大,会把用例变成随机红灯);
    // 运行时内存预算(桌面 512MB / 移动 128MB)在 frame/types.ts,由导出流水线把关。
    expect(produced.join("").length * 2).toBeLessThan(12 * 1024 * 1024);
  });
});

describe("buildZipFileName", () => {
  it("按本地时区的年月日拼前缀", () => {
    expect(buildZipFileName(new Date(2026, 8, 22, 23, 59))).toBe("frame-export-2026-09-22.zip");
  });

  it("月份与日期补零(0-based 月份最容易写错)", () => {
    expect(buildZipFileName(new Date(2026, 0, 5, 12, 0))).toBe("frame-export-2026-01-05.zip");
    expect(buildZipFileName(new Date(2026, 11, 31, 0, 0))).toBe("frame-export-2026-12-31.zip");
  });

  it("年月日三段恒等于 Date 的本地 getter(与运行机器时区无关的口径断言)", () => {
    const dates = [
      new Date(2026, 8, 22, 23, 59),
      new Date(2026, 8, 23, 0, 30),
      new Date(2025, 2, 9, 1, 0)
    ];
    for (const date of dates) {
      expect(buildZipFileName(date)).toBe(
        `${ZIP_FILE_PREFIX}-${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(
          date.getDate()
        )}.zip`
      );
    }
  });

  it("钉在两个固定时区上都能拉开本地与 UTC 的日期(不依赖 CI 机器时区)", () => {
    // 改 process.env.TZ 后 Node 的 Date 会重读时区,于是「本地日 ≠ UTC 日」在任何机器上都能复现。
    const originalTz = process.env.TZ;
    try {
      // 东八区:本地 9/22 凌晨 00:30 → UTC 还是 9/21
      process.env.TZ = "Asia/Shanghai";
      const east = new Date(2026, 8, 22, 0, 30);
      expect(east.getTimezoneOffset()).toBe(-480);
      expect(east.toISOString().slice(0, 10)).toBe("2026-09-21");
      expect(buildZipFileName(east)).toBe("frame-export-2026-09-22.zip");

      // 西七区(夏令时):本地 9/22 深夜 23:59 → UTC 已跨到 9/23
      process.env.TZ = "America/Los_Angeles";
      const west = new Date(2026, 8, 22, 23, 59);
      expect(west.getTimezoneOffset()).toBe(420);
      expect(west.toISOString().slice(0, 10)).toBe("2026-09-23");
      expect(buildZipFileName(west)).toBe("frame-export-2026-09-22.zip");
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});

describe("displayNameOf / outputNameOf", () => {
  it("展示主名只剥扩展名,非法字符原样留着(展示不是落盘)", () => {
    expect(displayNameOf(makeFile("IMG_1234.JPG"))).toBe("IMG_1234");
    expect(displayNameOf(makeFile('a:b"c.jpg'))).toBe('a:b"c');
    expect(displayNameOf(makeFile("无扩展名"))).toBe("无扩展名");
  });

  it("没有主名的文件展示回原名,不给空白", () => {
    expect(displayNameOf(makeFile(".jpg"))).toBe(".jpg");
    expect(displayNameOf(makeFile("  .jpg"))).toBe("  .jpg");
  });

  it("输出名 = 消毒主名 + 固定 .jpg", () => {
    expect(JPEG_EXTENSION).toBe(".jpg");
    expect(outputNameOf("IMG_1234.JPG")).toBe("IMG_1234.jpg");
    expect(outputNameOf("a/b:c")).toBe("a_b_c.jpg");
    expect(outputNameOf("")).toBe("untitled.jpg");
    expect(outputNameOf(`${"x".repeat(200)}`)).toBe(`${"x".repeat(80)}.jpg`);
  });
});

describe("formatByteSize", () => {
  it("0 显示 0 B", () => {
    expect(formatByteSize(0)).toBe("0 B");
  });

  it("负数 / NaN / Infinity 降级成占位符且不抛", () => {
    expect(SIZE_UNAVAILABLE).toBe("—");
    expect(formatByteSize(-1)).toBe(SIZE_UNAVAILABLE);
    expect(formatByteSize(Number.NaN)).toBe(SIZE_UNAVAILABLE);
    expect(formatByteSize(Number.POSITIVE_INFINITY)).toBe(SIZE_UNAVAILABLE);
    expect(formatByteSize(Number.NEGATIVE_INFINITY)).toBe(SIZE_UNAVAILABLE);
  });

  it("B 取整、KB/MB 一位小数,阈值 1024 进位", () => {
    expect(formatByteSize(1)).toBe("1 B");
    expect(formatByteSize(1023)).toBe("1023 B");
    expect(formatByteSize(1024)).toBe("1.0 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatByteSize(1024 ** 3)).toBe("1.0 GB");
  });

  it("四舍五入会把 1024.0 KB 这类结果升一格(不给用户看 1024 KB)", () => {
    expect(formatByteSize(1024 * 1024 - 1)).toBe("1.0 MB");
    expect(formatByteSize(1024 ** 3 - 1)).toBe("1.0 GB");
  });

  it("GB 封顶:再大也只到 GB 一档", () => {
    // 50 张 24MP 的 zip 能到 500MB 级别,GB 必须可用
    expect(formatByteSize(500 * 1024 * 1024)).toBe("500.0 MB");
    expect(formatByteSize(1024 ** 4)).toBe("1024.0 GB");
  });
});
