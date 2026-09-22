import config from "@repo/eslint-config";

// @repo/js-bridge 零第三方运行时依赖(hybrid-capability-plan 决策 4):src/** 只允许相对路径导入,
// 规则形态照抄 apps/miniapp 对 src/core/** 的约束;tests/** 不受限(import vitest 属正常)。
export default [
  ...config,
  {
    files: ["src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 匹配一切非相对导入(裸包名);相对路径 ./ ../ 不受限
              regex: "^(?!\\.{1,2}/)",
              message:
                "@repo/js-bridge 零第三方运行时依赖:src/** 禁止 import 任何第三方包(相对路径导入内部模块不受限)"
            }
          ]
        }
      ]
    }
  }
];
