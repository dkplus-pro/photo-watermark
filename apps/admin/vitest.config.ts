import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// admin 单元/组件测试配置(测试纪律见 apps/admin/AGENTS.md):
// 默认 jsdom 环境覆盖组件用例;纯逻辑用例用 `// @vitest-environment node` docblock 覆盖;
// globals 开启供 @testing-library/react 的自动 cleanup(全局 afterEach)生效。
export default defineConfig({
  // src/constants 求值即需要 basePath,构建期由 modern.config.ts 的 source.define 内联,
  // 测试基座必须同步注入,否则任何 import constants 的用例都会 ReferenceError。
  define: { __APP_BASE_PATH__: JSON.stringify("/") },
  resolve: {
    alias: [
      // Semi 组件在构建走 rspack 的 module 字段(lib/es),vitest 的 node 解析不走该条件,
      // 会落到 lib/cjs——cjs 产物里 require css 文件,在 vitest 里必炸。用正则精确锚定
      // 包根与 adapter 子路径(字符串 alias 是前缀匹配,会误伤 react19-adapter 这类子路径)。
      {
        find: /^@douyinfe\/semi-ui$/,
        replacement: fileURLToPath(
          new URL("./node_modules/@douyinfe/semi-ui/lib/es/index.js", import.meta.url)
        )
      },
      {
        find: /^@douyinfe\/semi-ui\/react19-adapter$/,
        replacement: fileURLToPath(
          new URL("./node_modules/@douyinfe/semi-ui/lib/es/react19-adapter.js", import.meta.url)
        )
      },
      {
        find: /^@douyinfe\/semi-icons$/,
        replacement: fileURLToPath(
          new URL("./node_modules/@douyinfe/semi-icons/lib/es/index.js", import.meta.url)
        )
      },
      // Semi 桶文件连带加载 lottie-web,后者模块顶层就操作 canvas、jsdom 必炸;
      // 用例不测 Lottie,直接钉到测试替身(tests/mocks/lottie-web-stub.ts)。
      {
        find: /^lottie-web$/,
        replacement: fileURLToPath(new URL("./tests/mocks/lottie-web-stub.ts", import.meta.url))
      }
    ]
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // 别名指向的 node_modules 内部文件默认仍被外置(native 加载),css import 会原样执行;
    // 把 @douyinfe 全家内联进 vite 管线,css import 才会被 vitest 置空处理。
    server: {
      deps: {
        inline: [/@douyinfe\//]
      }
    }
  }
});
