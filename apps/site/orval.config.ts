import { defineConfig } from "orval";

// orval 生成配置:由 openapi/site.yaml 生成公开站类型与接口函数(规范见 docs/multi-audience-contracts.md)。
// 生成物输出到 src/api/generated/,禁止手改;公开站无鉴权,请求统一经 src/api/client.ts 的 mutator。
export default defineConfig({
  site: {
    input: "../../openapi/site.yaml",
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
});
