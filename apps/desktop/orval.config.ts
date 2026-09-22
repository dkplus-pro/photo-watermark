// orval 生成配置:由 openapi/app/openapi.yaml 生成桌面端类型与接口函数
// (规范见 docs/multi-audience-contracts.md)。生成物输出到 src/renderer/src/api/generated/,
// 禁止手改;请求统一经 src/renderer/src/api/client.ts 的 mutator。
// 注意:这里用纯对象默认导出,不 import defineConfig——工程未安装依赖时也可用
// `npx orval --config ./orval.config.ts` 直接执行,无需从工程内解析 orval 包。
export default {
  app: {
    input: {
      target: "../../openapi/app/openapi.yaml",
      parserOptions: {
        // openapi/app 是多文件骨架(paths/、components/schemas/ 按文件拆分,入口聚合),
        // orval 默认禁止跨文件 $ref,这里放行全部相对引用。
        externalRefs: {
          allow: ["*"]
        }
      }
    },
    output: {
      target: "./src/renderer/src/api/generated",
      mode: "tags-split",
      client: "axios",
      override: {
        mutator: {
          path: "./src/renderer/src/api/client.ts",
          name: "customInstance"
        }
      },
      clean: true
    }
  }
};
