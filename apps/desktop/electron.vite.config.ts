import { vitePluginForArco } from "@arco-plugins/vite-react";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { PluginOption } from "vite";

// Arco 按需样式开关(可关配置坑,docs/desktop-shell-plan.md 决策 1):true 时组件样式经
// @arco-plugins/vite-react 按需注入,产物不打包全量 arco.css;构建失败或样式异常时置
// false 关闭插件,并在 src/renderer/src/App.tsx 改为全量兜底
// import "@arco-design/web-react/dist/css/arco.css"(两者必须二选一,不可同时关闭插件
// 又不引全量 CSS,否则组件裸奔无样式)。
const enableArcoImportPlugin = true;

// electron-vite 三段配置(main / preload / renderer),默认输出 out/{main,preload,renderer}。
// 渲染层 dev server 端口 18083,并把 /api 同源代理到 Go server(http://127.0.0.1:18085,
// 与 site/h5 的联调方式一致);客户端 axios baseURL 留空,dev 靠该代理、生产靠网关同域转发。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      // 注意:NodeNext 解析下命中该包的 CJS 导出重载(options 为必填),不能以无参形式调用。
      react({}),
      // style: "css" 用预编译样式切片,构建期无需 less;开关语义见上方 enableArcoImportPlugin。
      // 类型收敛:插件 1.3.3 的 d.ts 按其 peer 解析到更高版本 vite 的类型,与本 app 的
      // vite 7 存在类型代差;运行时仅做样式按需注入,故显式断言为本构建的 PluginOption。
      ...(enableArcoImportPlugin
        ? [vitePluginForArco({ style: "css" }) as unknown as PluginOption]
        : [])
    ],
    build: {
      // hidden sourcemap(生产构建生效):产出 .map 文件但产物不引用(用户 DevTools 不可见),
      // 留作主进程崩溃/错误堆栈符号化坑(docs/desktop-shell-plan.md §0 性能)。
      sourcemap: "hidden",
      rollupOptions: {
        output: {
          // 框架/库分桶长效缓存:业务代码改动不影响 react/arco/vendor chunk 指纹;
          // 首屏路由本身经 React.lazy 拆分(见 src/renderer/src/routes/index.tsx)。
          manualChunks: {
            react: ["react", "react-dom"],
            arco: ["@arco-design/web-react"],
            vendor: ["ahooks", "axios", "lodash-es", "react-router-dom", "zustand"]
          }
        }
      }
    },
    server: {
      port: 18083,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:18085",
          changeOrigin: true
        }
      }
    }
  }
});
