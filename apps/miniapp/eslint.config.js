import config from "@repo/eslint-config";

// core 零第三方运行时依赖(AGENTS.md §2-4):src/core/** 只允许相对路径与 Tsar 类型导入,
// 保护主包 2MB 预算——监控/埋点/性能/管道全部自研,引包即红灯。
export default [
  ...config,
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 匹配一切非相对导入(裸包名:react、@tarojs/...);相对路径 ./ ../ 不受限
              regex: "^(?!\\.{1,2}/)",
              message: "core 零第三方运行时依赖:禁止 import 任何第三方包(相对路径导入内部模块不受限)"
            }
          ]
        }
      ]
    }
  }
];
