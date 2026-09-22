# Admin 开发规范

技术栈:Modern.js + React 19 + TypeScript + Arco Design(`@arco-design/web-react`)。

## 目录结构

分区必须一目了然,公共代码按类型归档,页面私有代码留在页面目录内:

```text
apps/admin/src/
  api/
    client.ts            手写:axios 实例 + orval mutator(唯一含横切逻辑的文件)
    controllers.gen.ts   生成物:Controller 绑定层(gen:api 从契约 tags 自动生成,勿手改)
    queryKeys.ts         手写:TanStack Query 的 queryKey 集中定义
    generated/           orval 生成物(类型 + 接口函数,勿手改)
  components/          公共组件(跨页面复用)
  hooks/               公共 hooks(跨页面复用的状态逻辑;useAuthMenus 提供动态菜单树)
  routes/              页面层(Modern.js 约定路由;$.tsx 仅作 404 兜底)
  store/               客户端全局状态(zustand,每个领域一个 useXxxStore)
  utils/               公共工具函数
  constants/           公共常量
  config/              公共配置(主题、路由菜单、queryClient 等)
```

页面内部同样分区(领域一个目录):

```text
src/routes/article/
  page.tsx             列表页主入口
  detail.page.tsx      详情页
  components/          页面私有组件(编辑弹窗等)
  hooks/               页面私有 hooks(useArticleList 等)
```

命名:组件文件 PascalCase;hooks 以 `use` 开头;常量 SCREAMING_SNAKE;其余 camelCase。

## UI 规范

- **组件优先级**:一律优先使用 Arco Design 基础组件,确实不满足再自定义,以降低维护成本;
- 主题色、圆角等走 Arco 的 `ConfigProvider` token 定制,组件内不写死颜色;
- 布局(侧边栏 + 顶栏 + 内容区)在全局 layout 中实现一次,页面只写内容区。

### 布局与菜单

- **侧边栏整栏可折叠**:折叠触发器在侧边栏顶部(`IconMenuFold`/`IconMenuUnfold`),折叠宽度 60;折叠态菜单项仅显示图标,悬停经 Tooltip/弹出层显示标题;折叠只影响整栏显隐,不重置受控 `openKeys`(目录展开状态保留);
- **菜单项必须声明图标**:`config/menu.tsx` 的 `MenuConfig` 带 `icon` 字段(取 `@arco-design/web-react/icon` 实际导出),layout 渲染时挂到 `Menu.Item`/`SubMenu`;**新增菜单禁止裸文字**;
- **顶栏只保留用户区**(当前用户/退出登录),不放面包屑;
- **菜单是静态声明 + 权限过滤**(阶段 3 修订):`config/menu.tsx` 声明菜单树(路径/名称/图标/所需权限码),layout 按 `/auth/me` 的权限码过滤显隐;**最小颗粒度判定**:拥有菜单权限点本身,或该模块下任一 api 权限码(如仅有 `system:user:list`)即显示菜单,见 `hasMenuPermission`;路由是 Modern.js 约定式静态路由;页面新增 = 契约 + routes 页面 + menu.tsx 一行声明。**不使用服务端下发菜单或动态路由**,管理端也不提供菜单管理界面(使用方为非技术人员,不允许配置路径/组件 key);
- **权限码一致性**:menu.tsx 的权限码必须与服务端路由注册表(`internal/httpapi/permission.go` 的 Menu 字段)同名,由代码评审保证。

### 页面骨架(PageContainer)

- 面包屑与操作区放**内容区顶部**(PageContainer 模式),不放顶栏;新页面必须套 `src/components/page-container.tsx`:
  - 面包屑自动取 `config/menu.tsx` 的标题链(首页 / 系统管理 / 用户管理),页面不手写;
  - PageContainer **不再渲染页内标题**(标题与面包屑叶子重复),只保留面包屑 + `extra` 右侧操作区插槽(如"新建"按钮),页面标题以面包屑为准;
- 详情类内容可继续用 `Descriptions` 等组件,但外层同样套 PageContainer。

### 布局宽度与页脚

- **列表/网格页铺满内容区;分组表单页窄栏居中**:表单页容器统一 `.form-page { max-width: 720px; margin: 0 auto }`,吸底操作栏 `.form-footer-bar` 在容器内 sticky、宽度跟随容器(不做全宽负边距),落地范例见系统配置页(`routes/system/configs/page.tsx`);
- **公共页脚**:全局 layout 在内容区之后渲染 `src/components/app-footer.tsx`(Arco `Layout.Footer`,居中、次要文字色),版权文案来自 `constants` 的 `COPYRIGHT_TEXT`(占位,上线替换真实主体);登录页不渲染页脚。

### 分页(统一全量)

- 所有分页状态经 `src/hooks/use-table-query.ts` 编排(page/pageSize/total/pagination props/重置页码),页面不手写分页 state;
- 分页 props 必须全量:`showTotal`(共 x 条)+ `showPageSize`/`sizeCanChange`(10/20/50/100)+ `showJumper`;切 pageSize 重置回第 1 页(`pageSizeChangeResetCurrent`);
- 无服务端分页的列表(如字典)也配全量分页,用 Arco Table 客户端切片(total 取数据长度);
- 禁止自制"上一页/下一页"按钮替代分页组件。

### 列表页(arco-pro search-table 范式)

照抄 [Arco Design Pro 列表页](https://react-pro.arco.design/list/search-table) 的成熟范式,结构 = `Card` + 查询 `Form` + `Table` + `Pagination`:

- 查询条件入 `Form`(`onSubmit` 触发查询),按钮区含"查询"(primary)与"重置"(清空表单 + 回到第 1 页);新建/上传等主动作放工具栏右侧(或 PageContainer 的 `extra`);
- `Table` 必须有 `loading` 与空态;分页按上一节全量;操作按钮用 `AuthGate` 包裹;
- 网格型列表(如图片)保留网格布局,但查询区与分页同样对齐本节规范。

### 表单(按复杂度二分)

- **简单表单**(单组、字段少):`Modal` + `Form`,不单独开页面;
- **复杂表单**(多分组/长表单):分组表单页,照 [arco-pro form/group](https://react-pro.arco.design/form/group) 范式——`PageContainer` + `.form-page` 窄栏居中容器 + `Card` 分组 + 底部固定操作栏(提交/重置,sticky 吸底、宽度跟随容器);落地范例见系统配置页(`routes/system/configs/page.tsx`),后续新表单页照此;布局范式详见"布局宽度与页脚"一节;
- 详情页 = `Descriptions`。

## 状态管理

- **服务端状态**(接口数据)一律使用 TanStack Query:页面/hooks 里 `useQuery` / `useMutation` + Controller 函数;**禁止手写 `useEffect` + `useState` 拉取接口**;QueryClient 单例在 `src/config/queryClient.ts`,由全局 layout 提供 Provider;
- **queryKey** 集中定义在 `src/api/queryKeys.ts`,结构为 `[模块, 资源, ...参数]`,与 Controller 模块一一对应,禁止在页面里裸写字符串 key;
- **客户端全局状态**(登录用户、token、菜单等)一律使用 **zustand**,集中放 `src/store/`:每个领域一个文件、一个 `useXxxStore`;需要跨会话保留的状态(如 token)用 `persist` 中间件持久化到 localStorage;组件内按需订阅,组件外用 `useXxxStore.getState()` / `.setState()` 读写;
- 可复用的局部状态逻辑抽成 hooks(如 `useTableQuery` 封装"分页 + 筛选 + 请求"),放 `src/hooks/`;
- 允许使用 zustand,但一个项目里只用一种全局方案,不要混用。

## 工具库

- **请求类逻辑统一走 TanStack Query,不用 ahooks 的 `useRequest`**(一个项目只保留一套请求方案);
- **ahooks**:通用 React 逻辑(防抖节流、事件监听、生命周期等)优先使用 ahooks,组件里不手写这些通用逻辑;
- **lodash**:纯数据/集合操作优先使用 lodash;按方法引入控制体积:`import debounce from "lodash/debounce"`;
- ahooks 和 lodash 都覆盖不了的业务逻辑才自写,放 `src/hooks/`(带 React 状态)或 `src/utils/`(纯函数)。

## 接口与类型(orval 生成)

类型**和**接口函数都由 orval 从 `openapi/admin.yaml` 生成,前端不手写请求函数:

- **配置**:`apps/admin/orval.config.ts`,`input` 指向 `../../openapi/admin.yaml`,输出 `src/api/generated/`(`mode: tags-split`,按 tag/模块分文件);生成目录已在 eslint 与 prettier ignore,禁止手改;
- **mutator**:所有生成函数统一经 `src/api/client.ts` 的 `customInstance` 发起请求(配置在 `output.override.mutator`)。底层是 **axios** 实例:token 注入(request 拦截器)、401 处理、`{code, message, data}` 解包与错误 Message(response 拦截器)只写在这一处;若 orval 要求的 mutator 签名与现有函数不一致,在 `client.ts` 内加适配导出,不得把逻辑散落到别处;
- **函数名来自 operationId**:契约中每个接口必须写 operationId(它同时是后端 `ServerInterface` 方法名与前端生成函数名);axios 客户端在 tags-split 下按 tag 生成工厂函数(如 `getSystem().healthz()`),与后端按模块的 handler 结构对应;
- **只生成纯函数客户端**(调用返回 Promise),MVP 不启用 react-query / SWR / mocks 生成;后续若引入 `@tanstack/react-query`,改 orval 的 client 配置重新生成,页面调用方式平滑升级;
- **Controller 直调**:绑定层由 `pnpm gen:api` 从契约 tags 自动生成(`apps/admin/scripts/generate-controllers.mjs`,每个 tag 一行 `XxxController = getXxx()`),页面统一 `SystemController.healthz()` 风格调用;**新增 tag 只需在契约里声明,绑定层零手写**;
- **queryKey 集中管理**:见"状态管理"一节,新增接口在 `src/api/queryKeys.ts` 登记对应 key;
- 页面与 hooks 只 import `src/api` 的 Controller、queryKeys 与 `generated` 类型,**禁止手写与契约重复的接口类型**。

新增接口动作:改 `openapi/admin.yaml` → `pnpm gen:api` → 前端直接调用生成函数(零手写)。

## 复用与拆分

复用判断标准(硬性规则):

| 场景               | 位置                                 |
| ------------------ | ------------------------------------ |
| 2 个及以上页面使用 | `src/components/`、`src/hooks/`      |
| 仅单个页面使用     | 页面目录内的 `components/`、`hooks/` |
| 跨页面全局共享状态 | `src/store/`(zustand)                |
| 接口类型与请求函数 | 一律复用 `src/api/generated/` 生成物 |

拆分规则:

- 单文件超过约 **300 行**必须拆分;
- 页面主入口(`page.tsx`)保持"数据编排"角色,查询表单、表格列渲染、弹窗拆成子文件;
- 为页面拓展留位:列表页的查询条件、表格列以配置数组描述,新增字段改配置而非改结构。

## 测试

admin 的测试栈为 **Vitest + React Testing Library(jsdom)**,配置在 `vitest.config.ts` + `tests/setup.ts`,`pnpm --filter @monorepo-template/admin test`(即 `vitest run`)执行,turbo `test` 任务自动收纳。既有 e2e(Playwright)继续覆盖关键用户流程。

### 测试分层

| 层           | 工具                                  | 放什么                                             |
| ------------ | ------------------------------------- | -------------------------------------------------- |
| 纯函数       | Vitest(`// @vitest-environment node`) | 权限判定、菜单过滤/面包屑链等无 DOM 逻辑           |
| 状态机 hooks | Vitest + `renderHook`                 | 分页编排、分片上传状态机、断点续传指纹等有状态逻辑 |
| 组件交互     | Vitest + RTL(`render`/`userEvent`)    | AuthGate、ErrorBoundary 等渲染与交互语义           |
| 关键用户流程 | Playwright e2e                        | 登录、列表增删改查、上传等端到端链路               |

用例文件放 `apps/admin/tests/`,与被测对象按目录对应(`tests/hooks/`、`tests/components/`、`tests/api/`、`tests/config/`);`src/api/generated/` 生成物不写用例。jsdom 缺失的浏览器 API(`matchMedia`、`ResizeObserver`、`createObjectURL` 等)统一在 `tests/setup.ts` 补 shim,不在用例内散补。

### mock 边界

- **只 mock 模块边界,不 mock 内部实现细节**:Controller 层用 `vi.mock` mock `src/api/controllers.gen`,axios 传输层用 adapter mock 或 mock `client.ts` 导出的 `axiosInstance` 挂到真实拦截器上;禁止为通过测试而 mock hook/组件内部函数;
- 横切逻辑(token 注入、envelope 解包、401 处理、logID 拼接)属于 `client.ts` 本体,测试必须走真实实现(经 adapter mock 驱动);
- 全局副作用(localStorage、`Message.error`、定时器)在每个用例前后清理或还原,避免用例间串扰。

### 计划期用例纪律

**做计划时先列测试用例清单与边界条件表,实现与用例同批交付**(本仓库各阶段方案文档即按此示范)。不允许"先实现后补测试"或"计划里只有实现点没有边界条件"。

### 六类边界必查清单

写任何用例清单时,以下六类边界逐项过一遍,命中即必须有用例覆盖:

1. **空值** — 参数为 `undefined`/`null`/空数组/空串(如 permissions 未下发、total=0);
2. **零值** — 数值为 0 但语义合法(如 0 字节文件、第 0 页收敛);
3. **越界** — 超出有效范围需收敛(如页码超出 maxPage 回退、末片不足 chunkSize);
4. **权限缺失** — 无权限码/权限未加载(如 AuthGate 置灰、菜单隐藏、登录中态);
5. **网络失败** — 请求失败/超时/404(如重试耗尽、对账失败降级、错误文案);
6. **非法状态迁移** — 状态机不允许的路径不得发生(如取消后旧 complete 返回不得覆盖新状态、暂停中不可误报 failed)。
