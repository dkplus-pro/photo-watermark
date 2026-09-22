import config from "@repo/eslint-config";

// 在共享配置之上追加桌面端特有忽略:
// 1. orval 生成物路径为 src/renderer/src/api/generated(共享规则的 **/src/api/generated/**
//    模式面向 admin/site 的 src/api 路径,覆盖不到渲染层嵌套路径),生成物禁止手改、不参与 lint;
// 2. out/ 是 electron-vite 构建产物目录(根规则的 dist/build 模式覆盖不到)。
export default [
  ...config,
  {
    ignores: ["src/renderer/src/api/generated/**", "out/**"]
  }
];
