# apps/miniapp — CMS 微信小程序(Taro 4 占位工程)

CMS 的微信小程序端(`@monorepo-template/miniapp`,hello-world 阶段),Taro 4 + React,编译目标 weapp,消费 C 端公开契约 [`openapi/app/openapi.yaml`](../../openapi/app/openapi.yaml) 的 `GET /api/app/ping`:首页请求该端点,把 `data.message`(`pong from app api`)渲染出来;失败时降级展示错误信息。与 `apps/desktop`、`apps/mobile` 共享同一份 C 端契约。

占坑期端点匿名只读;契约预留 `bearerAuth`,C 端用户体系落地前无鉴权逻辑。

## 命令

```bash
pnpm --filter @monorepo-template/miniapp dev         # taro build --type weapp --watch,产物在 dist/
pnpm --filter @monorepo-template/miniapp build       # taro build --type weapp
pnpm --filter @monorepo-template/miniapp test        # vitest 单测
pnpm --filter @monorepo-template/miniapp typecheck   # tsc --noEmit
pnpm --filter @monorepo-template/miniapp gen:api     # orval 生成 src/api/generated/ + controllers.gen.ts
```

- `gen:api` 由 [`openapi/app/openapi.yaml`](../../openapi/app/openapi.yaml) 生成请求函数与类型(orval 以 `externalRefs.allow: ["*"]` 直接解析多文件骨架),生成物禁止手改。

## 微信开发者工具

1. 导入**项目根** `apps/miniapp`(不要直接导入 `dist`),`project.config.json` 的 `miniprogramRoot` 已指向 `./dist`,AppID 占坑期为测试号(`touristappid`);
2. 先执行一次构建(dev watch 或 build)生成 `dist`,再在工具内编译预览;
3. 开发期直连本机接口,需在工具内勾选**「详情 → 本地设置 → 不校验合法域名、web-view(业务域名)、TLS 版本以及 HTTPS 证书」**;接入正式域名后改配合法域名。

## API 接入

- 网络层在 `src/api/client.ts`(orval mutator)内**直桥 `Taro.request`**(即 `wx.request`):小程序运行时无 XMLHttpRequest,axios 默认适配器不可用,社区适配器 `axios-miniprogram-adapter` 与 axios 1.x 不兼容(已实测),因此只复用 axios 的 mutator 签名约定,传输层走 Taro;
- baseURL 固定绝对地址(小程序没有"同源"概念,`wx.request` 只接受绝对地址),写在 `src/config/index.ts`,当前为 `http://localhost:18085`;Go server 监听端口由 `SERVER_PORT` 控制(默认 8080),联调时保持与 `API_BASE_URL` 一致;
- 匿名受众无会话:`client.ts` 只做 `{code, message, data}` 信封解包与错误提示,无 token 注入与 401 跳转逻辑。

## 目录约定

与其他 JS 新端统一:`src/` 下 `api/`(orval 生成物 + `client.ts` mutator + `controllers.gen.ts`)、`component/`、`config/`、`consts/`、`hooks/`、`store/`(zustand)、`pages/`(Taro 页面);壳基础设施在 `src/core/`(transport/monitor/track/perf)。架构约束见 [AGENTS.md](AGENTS.md)。

## 配置坑清单

全部收敛在 `src/config/index.ts` 环境表(dev / test / prod 三份)+ `project.config.json`:

| 配置项                                      | 默认                     | 说明                                                        |
| ------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| `API_BASE_URL`                              | `http://localhost:18085` | 生产接入网关后改正式域名,并在微信后台配合法域名             |
| `MONITOR_ENDPOINT` / `TRACK_ENDPOINT`       | `""`                     | 空 = 禁用 HTTP sink;server 端点落地后填入即启用             |
| `MONITOR_SAMPLE_RATE` / `TRACK_SAMPLE_RATE` | `1`                      | 采样率 0~1                                                  |
| `MONITOR_ENABLED` / `TRACK_ENABLED`         | `true`                   | 总开关,false 时对应能力整体短路                             |
| `__APP_VERSION__` / `__BUILD_TIME__`        | defineConstants 注入     | 读 package.json version;单测走 `config/index.ts` 兜底读取口 |
| appid                                       | `touristappid`           | `project.config.json`,正式 appid 申请后替换                 |
| subpackages                                 | 空(骨架坑)               | `app.config.ts`,业务页面默认进分包                          |

## 本地 e2e 冒烟(automator)前置条件

- 仅本地运行,不进 CI(开发者工具是 GUI + 登录态依赖,runner 不现实);
- 需安装微信开发者工具并在「设置 → 安全设置」开启**服务端口**;CLI/HTTP 调用方式见 [miniprogram-automator 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/);
- 先 `pnpm --filter @monorepo-template/miniapp build` 产出 `dist`,再跑 e2e 脚本;工具未安装/端口未开时脚本给出明确报错,不算构建失败。
