import { defineConfig } from "orval";

// orval 生成配置:由 openapi/admin.yaml 生成类型与接口函数(规范见 docs/admin.md)。
// 生成物输出到 src/api/generated/,禁止手改;所有请求统一经 src/api/client.ts 的 mutator。
export default defineConfig({
  cms: {
    input: "../../openapi/admin.yaml",
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
