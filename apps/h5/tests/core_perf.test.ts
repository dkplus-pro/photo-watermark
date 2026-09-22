// core/perf 用例:noop 实现幂等不抛错、measure 未 mark 返回 undefined。
// 边界:空值(空串 name)、越界(超长 name)、未 mark 先 measure。

import { describe, expect, it } from "vitest";

import { noopPerf } from "../src/core/perf";

// noop 实现与 env 无关,静态 import 即可。
describe("noopPerf(幂等不抛错)", () => {
  it("mark 后 measure 恒返回 undefined(noop 不记录里程碑)", () => {
    expect(() => noopPerf.mark("app-boot")).not.toThrow();
    expect(noopPerf.measure("app-boot")).toBeUndefined();
    expect(noopPerf.measure("not-marked")).toBeUndefined();
  });

  it("重复 mark/measure 多次调用结果一致(幂等)", () => {
    noopPerf.mark("app-boot");
    noopPerf.mark("app-boot");
    expect(noopPerf.measure("app-boot")).toBeUndefined();
    expect(noopPerf.measure("app-boot")).toBeUndefined();
  });

  it.each([
    ["空串 name", ""],
    ["超长 name", "x".repeat(1000)]
  ])("%s 不抛错(空值/越界边界)", (_name, value) => {
    expect(() => {
      noopPerf.mark(value);
      noopPerf.measure(value);
    }).not.toThrow();
  });
});
