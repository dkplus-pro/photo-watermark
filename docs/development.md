# 开发规范总览

本仓库是一个 pnpm + Turborepo monorepo,包含两个应用:

- `apps/admin` — Modern.js + React 19 + Arco Design 管理后台
- `apps/server` — Go 编写的 API 服务

详细规范按方向拆分:[admin 开发规范](./admin.md) · [server 开发规范](./server.md)。
MVP 版本的功能范围与分阶段交付计划见 [MVP 交付计划](./mvp-plan.md)。
数据库表结构与 SQLite → MySQL 迁移方案见 [数据库设计](./database.md)。
接口与页面的全量核对清单见 [接口与页面清单](./api-pages.md)。
MVP 之后的后台增强分阶段计划见 [后台增强计划](./admin-enhancement-plan.md)。
测试体系与 Site SSR 分阶段计划见 [测试体系与 Site SSR 计划](./quality-and-site-plan.md)。

## 目录结构

```text
apps/
  admin/               管理后台(Modern.js)
  server/              API 服务(Go)
packages/              共享配置(tsconfig / eslint / prettier / commitlint)
docs/                  开发文档
openapi/               前后端接口契约,按受众分文件(admin.yaml;site 见 multi-audience-contracts.md)
scripts/               CI / 部署脚本
tests/                 仓库级测试(jest / playwright)
```

## 常用命令

所有命令都在仓库根执行:

| 命令                           | 作用                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                                         |
| `pnpm dev`                     | 一条命令并行启动全部应用(admin + server)                                         |
| `pnpm gen:api`                 | 由 `openapi/` 下契约生成前端类型与接口函数(orval)、server 接口骨架(oapi-codegen) |
| `pnpm lint` / `pnpm typecheck` | 静态检查                                                                         |
| `pnpm test`                    | 单测 + e2e                                                                       |
| `pnpm verify`                  | 本地提交前完整校验                                                               |

**约定**:每个应用(包括 Go 的 server)都在自己的 `package.json` 里暴露统一的 `dev` / `build` / `gen:api` 脚本,由 turbo 编排。Go 侧通过 npm-script 包装 `go run` 等命令,保证根目录 `pnpm dev` 一条命令即可跑起整个项目。

## OpenAPI 契约工作流

`openapi/` 目录是前后端接口契约的单一事实源,按受众分文件(admin 用 `admin.yaml`),**双方代码都由对应契约生成**:

1. 修改接口时,先改 `openapi/` 下对应受众契约,再执行 `pnpm gen:api`;
2. 生成物位于 `apps/admin/src/api/generated/`(orval:类型 + 接口函数)与 `apps/server/gen/admin/`(oapi-codegen),**禁止手改**;
3. admin 直接调用 orval 生成的接口函数(统一走 `src/api/client.ts` mutator),server 实现 oapi-codegen 生成的 `ServerInterface`,两侧不允许出现与契约不一致的手写类型。

## 测试体系

### 测试金字塔

自下而上,越往下越多、越快:

1. **纯函数 / hooks 状态机 / 组件交互** — Vitest(前端 app 内 `tests/`,jsdom + React Testing Library),覆盖业务逻辑全分支;
2. **关键用户流程** — Playwright(根级 `tests/playwright/`,真实起 server + 前端 app),只覆盖登录、上传等端到端主路径,不追求覆盖率高;
3. **Go 服务端** — `go test`(server 侧 `internal/**/*_test.go`),handler/service/repo 分层各自有单测。

原则:能用下层测试覆盖的逻辑不下沉到 e2e;e2e 断言用户可见行为,不 mock 到实现细节。

### 各端测试栈一览

| 端            | 单元/组件                      | e2e        | 说明                                                                                        |
| ------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------- |
| `apps/admin`  | Vitest + React Testing Library | Playwright | 配置见 `apps/admin/vitest.config.ts` + `tests/setup.ts`                                     |
| `apps/site`   | Vitest + React Testing Library | Playwright | 与 admin 同构(两 app 各持一份小配置,重复可接受)                                             |
| `apps/server` | `go test`                      | —          | e2e 由根级 Playwright 经前端代理真实打到 server                                             |
| 仓库根级      | jest(`jest.config.cjs`)        | Playwright | jest 断言**仓库结构与 CI 脚本**(如 verify.sh/ci.sh 步骤),职责与 app 单测不同,**保留不合并** |

### 根级编排

`pnpm test` = `test:unit`(根 jest)+ `turbo run test`(turbo `test` 任务自动收纳各 app 的 `test` 脚本,如 admin 的 `vitest run`——app 新增测试无需改 turbo.json)+ `test:e2e`(根 Playwright)。`pnpm verify` 依次跑 lint / typecheck / test,是提交前的完整校验口径,与 CI 一致。

### 计划期用例纪律(对 AI 强制)

- **做计划时先写测试用例**:方案/计划文档必须先列出用例清单与边界条件(参考 `docs/quality-and-site-plan.md` 各阶段的"测试用例清单"表格),再开始实现;
- **用例与实现同批交付**:实现提交里必须包含对应测试,不允许"实现先行、用例后补"的独立阶段;
- **六类边界必查**:每个功能设计用例时逐条核对——
  1. **空值**:数据为 null / undefined / 空数组 / 空字符串;
  2. **零值**:0、false、空对象等 falsy 但合法的状态;
  3. **越界**:分页超末页、下标越界、超长输入、超出上限;
  4. **权限缺失**:无权限码时的渲染与接口行为(置灰/401/403);
  5. **网络失败**:请求失败、超时、非 envelope 错误、部分成功;
  6. **非法状态迁移**:状态机收到不属于当前态的操作(如上传已取消后又点完成)、并发/竞态(旧请求返回覆盖新状态)。

## 通用规范

- 代码风格交给仓库统一配置(prettier / eslint / gofmt),不做口头约定;
- **命名语义化**:文件与符号名必须表达其职责(按资源或领域,如 `users.go`、`auth.ts`、`use-file-url.ts`),**禁止 `stage4`、`temp`、`new`、`copy`、`utils2` 这类过程性/序号命名**;新增功能放在既有资源文件中,文件过大时按资源拆分而不是按开发阶段拆分;
- 提交信息遵循 Conventional Commits(commitlint 已配置);
- 单文件不宜过长:admin 侧约 300 行、server 侧约 400 行触顶即拆分,主入口文件永远保持"只做装配"的简单形态;
- 优先复用再新建:改代码前先看 `src/components`、`src/hooks`、`internal/` 里是否已有可复用的实现。
