# apps/site — CMS 对外站点(Modern.js SSR)

CMS 的对外公开网站(`@monorepo-template/site`),appTools + SSR(`server.ssr: true`),
消费公开契约 [`openapi/site.yaml`](../../openapi/site.yaml)。架构约束见 [AGENTS.md](AGENTS.md)
(壳架构不变量),壳建设全貌见 [docs/site-shell-plan.md](../../docs/site-shell-plan.md)。

## 命令

```bash
pnpm --filter @monorepo-template/site dev         # dev server(默认 18081,PORT 可覆盖)
pnpm --filter @monorepo-template/site build       # 生产构建(NODE_ENV=production 注入 CSP meta)
pnpm --filter @monorepo-template/site serve       # 本地起生产产物
pnpm --filter @monorepo-template/site test        # vitest 单测(-- --coverage 走覆盖率门禁)
pnpm --filter @monorepo-template/site typecheck   # tsc --noEmit
pnpm --filter @monorepo-template/site gen:api     # orval 生成 src/api/generated/ + controllers.gen.ts
```

## 配置项索引

| 配置                       | 端   | 默认                    | 说明                                        |
| -------------------------- | ---- | ----------------------- | ------------------------------------------- |
| `SITE_API_BASE`            | SSR  | `http://127.0.0.1:8080` | 服务端请求 Go server 的绝对地址             |
| `API_PROXY_TARGET`         | dev  | `http://localhost:8080` | dev 代理 /api 目标                          |
| `PORT`                     | dev  | `18081`                 | dev server 端口                             |
| `RUM_ENDPOINT` / `RUM_PID` | 构建 | `""`                    | ARMS RUM 上报;任一缺失不初始化;构建期内联   |
| `TRACK_ENDPOINT`           | 构建 | `""`                    | 自有埋点 HTTP sink;空 = tracking 整体 no-op |
| `ANALYZE`                  | 构建 | 未设                    | `ANALYZE=true` 构建输出产物体积分析         |

- 全量 env 槽位与默认值见 [`.env.example`](.env.example);`.env.*` 已 gitignore,禁止提交真实密钥;
- 客户端可见变量经 `modern.config.ts` 的 `source.define` 构建期内联(浏览器无 process),
  部署时须在构建(CI)阶段注入;
- 主题只改 `src/config/site-theme.ts`;性能预算只改 `config/budgets.json`;特性开关只改
  `src/config/features.ts`(改法约束见 AGENTS.md)。
