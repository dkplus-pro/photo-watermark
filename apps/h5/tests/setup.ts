import "@testing-library/jest-dom/vitest";

// h5 当前用例均为纯逻辑/SSR 分支(`// @vitest-environment node`),无需浏览器 API shim;
// 保留 setup 入口与 site 同构,后续组件用例(需 matchMedia 等 shim)在此补齐。
