// orval 生成配置:由 openapi/h5/openapi.yaml 生成活动 H5 类型与接口函数
// (规范见 docs/multi-audience-contracts.md)。生成物输出到 src/api/generated/,禁止手改;
// h5 为匿名受众无鉴权,请求统一经 src/api/client.ts 的 mutator。
// 注意:这里用纯对象默认导出而非 defineConfig()——工程未 install 时 npx orval 无法从
// 工程内解析 orval 包,纯对象是 orval 支持的等价形态(与 apps/miniapp 一致)。
export default {
  h5: {
    input: {
      target: "../../openapi/h5/openapi.yaml",
      parserOptions: {
        // openapi/h5 是多文件骨架(paths/、components/schemas/ 按文件拆分,入口聚合),
        // orval 默认禁止跨文件 $ref,这里放行全部相对引用。
        externalRefs: {
          allow: ["*"]
        }
      }
    },
    output: {
      target: "./src/api/generated",
      mode: "tags-split",
      client: "axios",
      override: {
        mutator: {
          path: "./src/api/client.ts",
          name: "customInstance"
        }
      },
      clean: true
    }
  }
};
