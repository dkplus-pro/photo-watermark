# 阶段 1 施工方案：packages/js-bridge（@repo/js-bridge）

> 对应 docs/hybrid-capability-plan.md 阶段 1（任务卡 1.1 / 1.2 / 1.3），决策 3（JSB 协议）与决策 4（包形态）。
> 本文件是给 coding-agent 的完整施工方案：**所有架构决策已做完，执行者不得自行变更 API 形态、文件结构、依赖版本。**
> 目标分支：`refactor/big-infra`。完成后按 §8 验收命令自查。

---

## 1. 范围与边界

**做**：

- 新建 `packages/js-bridge` 包（pnpm workspace 由 `packages/*` glob 自动收录，**不需要改任何根文件**）。
- 实现 6 个源文件（protocol / core / events / adapter / global / index）+ 6 个测试文件。
- ESLint / tsconfig / vitest 三件套配置。

**不做**（明确排除）：

- 不改 `apps/h5`（h5 接入是阶段 3，本阶段只交包）。
- 不改根 `package.json` / `pnpm-workspace.yaml` / `turbo.json`（workspace glob 已覆盖）。
- 不回填 `docs/hybrid-capability-plan.md` §8 执行记录（由 planner 在阶段门禁时回填）。
- 不引入任何运行时依赖（决策 4，见 §6 ESLint 强制）。
- 不实现 AbortSignal 取消、不做请求重试、不做消息队列（协议刻意最小，后续阶段按需再加）。

---

## 2. 仓库既有约定（已核查，照此执行）

| 项                  | 取值                                                                                                        | 出处                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| vitest              | `^5.0.0`                                                                                                    | apps/miniapp、apps/h5、apps/desktop、apps/admin、apps/site 全部一致 |
| @vitest/coverage-v8 | `^5.0.1`                                                                                                    | 同上                                                                |
| typescript          | `^5.9.3`                                                                                                    | apps/* 一致（根为 6.0.3，app/包层一律 5.9.3）                       |
| eslint              | `10.6.0`（精确钉版）                                                                                        | 根 package.json、apps/miniapp                                       |
| @types/node         | `^24.10.2`                                                                                                  | apps/* 一致                                                         |
| @repo/eslint-config | `workspace:*`，flat config，`export default [...config, {...}]` 追加                                        | apps/miniapp/eslint.config.js                                       |
| @repo/tsconfig      | `workspace:*`，`extends: "@repo/tsconfig/base.json"`                                                        | apps/desktop/tsconfig.*.json                                        |
| turbo 任务名        | `lint` / `test` / `typecheck`（+ `build` no-op 占位）                                                       | turbo.json、packages/tsconfig/package.json                          |
| 测试目录            | `tests/**/*.test.ts`（仓库惯例为 `tests/`，计划文档 §4 树中的 `test/` 以本方案为准）                        | apps/miniapp、apps/h5                                               |
| vitest 环境         | `node`，window 依赖用 `(globalThis as Record<string, unknown>).window = {...}` stub                         | apps/miniapp/tests/transport_queue.test.ts                          |
| 覆盖率门槛纪律      | core 级基础设施 lines/functions/branches/statements 全 90                                                   | apps/miniapp vitest.config.ts `src/core/**`                         |
| 代码风格            | prettier：双引号、分号、`trailingComma: "none"`、`printWidth: 100`                                          | packages/prettier-config/index.js                                   |
| TS 严格项           | `strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `isolatedModules` + `noEmit` | packages/tsconfig/base.json                                         |

`noPropertyAccessFromIndexSignature` 影响实现写法：对 `Record<string, unknown>` 取值一律用方括号（`obj["code"]`），禁止点访问。
`isolatedModules` 影响导入写法：纯类型一律 `import type` / `export type`。

---

## 3. 文件清单（新建 16 个文件，全部是新增）

```
packages/js-bridge/
  package.json
  tsconfig.json
  vitest.config.ts
  eslint.config.js
  src/
    protocol.ts      # 卡 1.1：类型 + 错误码 + 错误工厂
    core.ts          # 卡 1.2：createJSB + 应答归一 + 超时
    events.ts        # 卡 1.3：事件总线
    adapter.ts       # 卡 1.3：isInApp + flutter_inappwebview 适配器
    global.ts        # 卡 1.3：单例 + window.__JSB_BRIDGE__ 挂载
    index.ts         # 卡 1.3：re-export + callNative/on/off 便捷代理
  tests/
    protocol.test.ts
    core.test.ts
    events.test.ts
    adapter.test.ts
    global.test.ts
    index.test.ts
```

模块内依赖方向（单向，禁止成环）：`protocol` ← `core` ← `adapter`；`events` 独立；`global` → `core`/`events`/`protocol`；`index` → 全部。**src 内部互相 import 一律直达模块文件（`./protocol` 等），禁止经 `./index` 中转。**

---

## 4. 配置文件完整内容

### 4.1 `packages/js-bridge/package.json`

```json
{
  "name": "@repo/js-bridge",
  "version": "0.0.0",
  "private": true,
  "description": "JSBridge 协议包(js↔native Promise 化 call/emit;零第三方运行时依赖,源码直出,消费端 bundler 转译)。",
  "license": "MIT",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "files": ["src"],
  "scripts": {
    "build": "node -e \"console.log('js-bridge: source-only package, no build')\"",
    "clean": "rm -rf .turbo coverage",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/tsconfig": "workspace:*",
    "@types/node": "^24.10.2",
    "@vitest/coverage-v8": "^5.0.1",
    "eslint": "10.6.0",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

说明：

- `main`/`types`/`exports` 直指 `src/index.ts`，无构建产物（决策 4）。`build` 是 no-op echo，占位让 turbo 的 `^build` 依赖链不断（照抄 packages/tsconfig 做法）。
- **无 `dependencies` 字段**（零运行时依赖）。
- devDeps 版本全部对齐 §2 表，禁止自行升档。
- `typescript: ^5.9.3` 与 `@repo/eslint-config` peerDep `typescript>=6.0.0` 存在既有告警，apps/* 全部如此，属仓库现状，忽略即可，**不要**为消除告警升到 6.x（会与消费端 h5 的 5.9.3 分叉）。

### 4.2 `packages/js-bridge/tsconfig.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src", "tests", "vitest.config.ts"],
  "exclude": ["node_modules", "coverage"]
}
```

说明：

- base.json 已含 `strict`/`noEmit`/`isolatedModules`/`module: ESNext`/`moduleResolution: Bundler`/`target: ES2022` 等，不重复声明、不覆盖。
- `lib` 显式补 `DOM`：`adapter.ts`/`global.ts` 需要 `window` 与 `Window` 全局接口（base.json 未声明 lib）。包运行时不依赖 DOM（全部 `typeof window` 守卫），仅类型层使用。
- `types: ["node"]`：vitest.config.ts 与 tests 需要 node 类型上下文。

### 4.3 `packages/js-bridge/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

// js-bridge 是纯协议包:node 环境即可,window 依赖一律经 globalThis stub 注入
// (见 tests/adapter.test.ts、tests/global.test.ts),不引入 jsdom、无 setup 文件。
// 覆盖率门槛对齐仓库 core 纪律(apps/miniapp 的 src/core/** 为 90):本包整体即 core 级。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90
      }
    }
  }
});
```

说明：`test` 脚本不挂 `--coverage`（与 apps 一致，门槛在显式跑覆盖率时生效）；验收时单独执行覆盖率命令（§8）。

### 4.4 `packages/js-bridge/eslint.config.js`

```js
import config from "@repo/eslint-config";

// @repo/js-bridge 零第三方运行时依赖(hybrid-capability-plan 决策 4):src/** 只允许相对路径导入,
// 规则形态照抄 apps/miniapp 对 src/core/** 的约束;tests/** 不受限(import vitest 属正常)。
export default [
  ...config,
  {
    files: ["src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 匹配一切非相对导入(裸包名);相对路径 ./ ../ 不受限
              regex: "^(?!\\.{1,2}/)",
              message:
                "@repo/js-bridge 零第三方运行时依赖:src/** 禁止 import 任何第三方包(相对路径导入内部模块不受限)"
            }
          ]
        }
      ]
    }
  }
];
```

---

## 5. 源文件 API 契约（签名 + 行为，逐文件）

### 5.1 `src/protocol.ts`（卡 1.1）

职责：协议类型、错误码、错误类、错误工厂、超时常量。**无任何运行逻辑之外的代码，不 import 任何模块。**

完整契约（实现须与此逐字一致，JSDoc 可补但不许改签名）：

```ts
/** JSB 成功码:native 应答 {code:0} 表示成功。 */
export const JSB_RESULT_OK = 0;

/** callNative 默认超时(ms);0 = 不超时(决策 3)。 */
export const DEFAULT_CALL_TIMEOUT_MS = 30000;

export const JSB_ERROR_CODES = [
  "BRIDGE_NOT_AVAILABLE",
  "TIMEOUT",
  "METHOD_NOT_FOUND",
  "BAD_PARAMS",
  "BAD_RESPONSE",
  "NATIVE_ERROR",
  "CANCELLED"
] as const;

export type JSBErrorCode = (typeof JSB_ERROR_CODES)[number];
```

错误码语义（写进 JSDoc）：

| code                   | 含义                                                                            | 产生方      |
| ---------------------- | ------------------------------------------------------------------------------- | ----------- |
| `BRIDGE_NOT_AVAILABLE` | 非 webview 环境 / `flutter_inappwebview.callHandler` 缺失 / `getJSB()` 未初始化 | js 侧       |
| `TIMEOUT`              | 调用超时                                                                        | js 侧       |
| `METHOD_NOT_FOUND`     | native 无该 method 的注册 handler                                               | native 透传 |
| `BAD_PARAMS`           | js 侧入参非法（空 method、负 timeout）或 native 参数校验失败透传                | 双侧        |
| `BAD_RESPONSE`         | native 应答无法归一（非 JSON 字符串、非对象、code 非数字）                      | js 侧       |
| `NATIVE_ERROR`         | native 业务失败（含未识别的 native error.code）与 transport 层异常              | 双侧        |
| `CANCELLED`            | 用户在 native 流程中主动取消（为阶段 6 媒体方法预留，本阶段仅定义与透传映射）   | native 透传 |

```ts
/** js→native 请求信封。id 由 js 侧 idFactory 生成(callbackId),native 原样回传用于日志关联。 */
export interface JSBRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSBResultError {
  code: string;
  message: string;
}

/** native→js 应答信封。code===0(JSB_RESULT_OK) 成功取 data;否则读 error。 */
export interface JSBResult<T = unknown> {
  code: number;
  data?: T;
  error?: JSBResultError;
}

/**
 * transport 层的原始应答形态:flutter_inappwebview.callHandler 在 iOS/Android
 * 对复杂返回值可能给到 JSON 字符串,故为 JSBResult 对象与 string 的联合。
 */
export type JSBResponse = JSBResult | string;

export class JSBError extends Error {
  /** 归一后的错误码(7 值联合)。 */
  readonly code: JSBErrorCode;
  /** native 侧原始错误码(字符串或数字),用于诊断;js 侧自产错误为 undefined。 */
  readonly nativeCode?: string | number;

  constructor(code: JSBErrorCode, message: string, nativeCode?: string | number);
}
// 实现要求:constructor 内 super(message); this.name = "JSBError"; 赋值 code/nativeCode。
// nativeCode 不传时保持 undefined,禁止给默认值。

export function createJSBError(
  code: JSBErrorCode,
  message: string,
  nativeCode?: string | number
): JSBError;

export function isJSBError(value: unknown): value is JSBError;
// 实现:return value instanceof JSBError;

export function bridgeNotAvailableError(detail?: string): JSBError;
// message:detail ?? "JSB bridge is not available (not running inside flutter_inappwebview)"

export function timeoutError(method: string, timeoutMs: number): JSBError;
// message:`callNative("${method}") timed out after ${timeoutMs}ms`

export function badResponseError(detail: string): JSBError;
// message:`invalid JSB response: ${detail}`
```

### 5.2 `src/core.ts`（卡 1.2）

职责：transport 注入、`callNative` Promise 化（id 分配、超时、应答归一、错误码映射）。import 仅允许 `./protocol`。

```ts
import type { JSBRequest, JSBResult } from "./protocol";

/** 传输层抽象:call 接收请求信封,返回原生应答(未知形态,由 core 归一)。 */
export interface JSBTransport {
  call(req: JSBRequest): Promise<unknown>;
}

export interface JSBOptions {
  /** 默认超时(ms),默认 DEFAULT_CALL_TIMEOUT_MS;0 = 不超时。 */
  timeoutMs?: number;
  /** 时钟,默认 Date.now;仅用于默认 idFactory。测试注入以保证确定性。 */
  now?: () => number;
  /** callbackId 生成器,默认 `jsb_${now()}_${seq}`(seq 自 1 起,按 createJSB 实例独立计数)。 */
  idFactory?: () => string;
}

export interface CallNativeOptions {
  /** 单次调用覆盖默认超时;0 = 不超时;负数非法。 */
  timeoutMs?: number;
}

export interface JSBBridge {
  callNative<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: CallNativeOptions
  ): Promise<T>;
}

export function createJSB(transport: JSBTransport, options?: JSBOptions): JSBBridge;

export function normalizeJSBResponse(raw: unknown): JSBResult;
```

**行为契约（实现必须逐条满足，括号内为对应测试用例编号，见 §7.2）：**

createJSB：

1. `transport` 为 falsy 或 `typeof transport.call !== "function"` → **同步** `throw new TypeError(...)`（C22）。
2. `options.timeoutMs` 省略时取 `DEFAULT_CALL_TIMEOUT_MS`；显式传 0 表示全局不超时。
3. 默认 `idFactory` 闭包持有实例级计数器 `seq`（初值 0），每次调用返回 `` `jsb_${now()}_${++seq}` ``；`now` 默认 `Date.now`（C20/C21）。

callNative（全部校验失败走 **reject**，禁止同步抛）：

4. `method` 非字符串或 `method.trim().length === 0` → reject `BAD_PARAMS`（C18，空值）。
5. 生效超时 `effectiveTimeout = opts?.timeoutMs ?? options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS`；`effectiveTimeout` 非有限 number 或 `< 0` → reject `BAD_PARAMS`（C18，越界）。
6. 组请求：`params === undefined` 时 `req = { id, method }`（**不带 params 键**）；否则 `{ id, method, params }`（C19）。
7. `effectiveTimeout > 0` 时 `setTimeout(() => reject(timeoutError(method, effectiveTimeout)), effectiveTimeout)`；`=== 0` 不挂计时器（C13/C15，零值）。
8. **settle-once**：内部 `settled` 标志 + 成功/失败/超时任一路径先行后，后续一律忽略；任何 settle 路径都要 `clearTimeout`（C16/C17）。
9. `transport.call(req)` 必须包在 try/catch 里再 `Promise.resolve(...)`：同步 throw 与 reject 统一走失败路径，**callNative 永不同步抛 transport 异常**（C12，网络失败）。
10. transport resolve → `normalizeJSBResponse(raw)`：
    - 归一抛 `JSBError(BAD_RESPONSE)` → 原样 reject（C6~C9）；
    - `result.code === JSB_RESULT_OK` → resolve `result.data as T`（无 data 键时 resolve `undefined`，C1/C2/C23）；
    - 否则按 §5.2.1 映射后 reject（C3/C4/C5）。
11. transport reject/同步 throw → `isJSBError(err)` 为真则原样 reject（同一个对象引用，C11）；否则 reject `createJSBError("NATIVE_ERROR", \`JSB transport error: ${err instanceof Error ? err.message : String(err)}\`)`（C10）。

normalizeJSBResponse（导出，供单测直测）：

12. `typeof raw === "string"` → 先 `JSON.parse`（前后空白合法，JSON.parse 原生容忍）；parse 失败 → throw `badResponseError("response is a non-JSON string")`（C7）。
13. parse 后（或非字符串入参）满足 `parsed === null || typeof parsed !== "object" || Array.isArray(parsed)` → throw `badResponseError("response is not an object")`（C6/C9，空值/非法形态）。
14. `parsed["code"]`（注意方括号访问）非 number 或 `Number.isNaN` → throw `badResponseError('response "code" is not a number')`（C8）。
15. `error` 字段整形：仅当其为对象且 `code`、`message` 均为 string 时保留为 `JSBResultError`；否则视为 `undefined`（**不因此抛错**，由映射层兜底 message）。
16. `code === JSB_RESULT_OK` 时不校验 `error` 字段（code 优先，成功即成功）。
17. 返回新对象 `{ code, data, error? }`，`data` 原样引用透传。

#### 5.2.1 native 失败应答 → JSBError 映射（METHOD_NOT_FOUND 映射在此）

```
输入:result(code !== 0)
wireCode   = result.error?.code    (normalize 已保证为 string | undefined)
wireMsg    = result.error?.message (string | undefined)
known      = wireCode !== undefined && JSB_ERROR_CODES.includes(wireCode)
code       = known ? wireCode : "NATIVE_ERROR"        // METHOD_NOT_FOUND/BAD_PARAMS/CANCELLED 等在此透传
message    = wireMsg 非空 ? wireMsg : `native call "${method}" failed with code ${result.code}`
nativeCode = wireCode ?? result.code                  // 原始诊断信息一律保留
返回 createJSBError(code, message, nativeCode)
```

`JSB_ERROR_CODES.includes(wireCode)` 在 TS 下需写成 `(JSB_ERROR_CODES as readonly string[]).includes(wireCode)`。

### 5.3 `src/events.ts`（卡 1.3）

职责：native→js 事件总线。零 import（不依赖 protocol）。

```ts
export type JSBEventHandler = (payload: unknown) => void;

export interface JSBEventBus {
  /** 订阅;返回幂等 unsubscribe(重复调用 no-op)。同一 handler 对同一事件重复注册只生效一次(Set 语义)。 */
  on(event: string, handler: JSBEventHandler): () => void;
  /** 退订;handler 未注册 / 事件不存在时 no-op。 */
  off(event: string, handler: JSBEventHandler): void;
  /** 派发;无监听 no-op;按注册顺序同步调用;单 handler 抛错 console.error 后继续派发其余。 */
  dispatch(event: string, payload?: unknown): void;
  /** 当前监听数;未知事件返回 0。 */
  listenerCount(event: string): number;
}

export function createJSBEvents(): JSBEventBus;
```

行为契约：

1. 内部存储 `Map<string, Set<JSBEventHandler>>`（Set 天然去重，E6）。
2. `on`/`off`/`dispatch`/`listenerCount` 四个方法对 `event` 统一校验：非 string 或空串 → **同步** `throw new TypeError(...)`（E11，空值/非法状态）。`on`/`off` 对 `handler` 校验：非 function → TypeError。
3. `dispatch` 遍历**快照**（`[...set]`）：handler 在派发中 off 自己或 on 新 handler，不影响当次派发序列（E9）。
4. `dispatch` 无 payload 时 handler 收到 `undefined`（E2，空值）。
5. handler 抛错：`console.error(\`[js-bridge] handler for "${event}" threw\`, err)` 并继续（E8；`no-console`规则放行`error`）。
6. unsubscribe 与 `off` 移除后空 Set 要从 Map 删除（防止 listenerCount 语义漂移与内存驻留）。
7. `listenerCount` 对未注册事件返回 0（E10，零值）。

### 5.4 `src/adapter.ts`（卡 1.3）

职责：环境探测 + flutter_inappwebview transport。import 仅允许 `./protocol`、`./core`（type-only）。

```ts
import type { JSBTransport } from "./core";
import { bridgeNotAvailableError, type JSBRequest } from "./protocol";

/** native 侧注册的 handler 名,mobile 阶段 2 注册表按此名分发。 */
export const JSB_HANDLER_NAME = "jsb";

/** flutter_inappwebview 注入对象的最小结构(全部可选,探测期不做强假设)。 */
export interface FlutterInAppWebViewLike {
  callHandler?: (handlerName: string, ...args: unknown[]) => Promise<unknown>;
  postMessage?: (message: unknown) => void;
}

declare global {
  interface Window {
    flutter_inappwebview?: FlutterInAppWebViewLike;
  }
}

export function isInApp(): boolean;

export function createFlutterTransport(): JSBTransport;
```

行为契约：

1. 内部私有 `getFlutterBridge()`：`typeof window === "undefined"` → `undefined`（SSR 安全，A1/A7）；`window.flutter_inappwebview` 为 `null`/非 object → `undefined`（A6，空值）。
2. `isInApp()`：桥存在且（`typeof bridge.callHandler === "function"` **或** `typeof bridge.postMessage === "function"`）→ true；其余一律 false（A2~A5）。访问可选字段用点访问（`FlutterInAppWebViewLike` 是具名接口，不受 noPropertyAccessFromIndexSignature 影响）。
3. `createFlutterTransport()` 返回新对象（每次调用独立），`call(req)`：
   - 桥缺失或 `callHandler` 非 function → `Promise.reject(bridgeNotAvailableError("window.flutter_inappwebview.callHandler is not available"))`（A7/A8）。**注意：即使 postMessage 存在但 callHandler 缺失也 reject**——transport 只走 callHandler 原语，postMessage 仅供 `isInApp` 探测。
   - 正常：`return Promise.resolve(bridge.callHandler(JSB_HANDLER_NAME, req))`。`req` 原样引用透传，**不序列化、不克隆**（A9）；native promise 的 reject 原样透传，adapter 不包装（A10，包装是 core 的职责）。
4. 全文件禁止顶层访问 `window`（只允许函数体内、经 `typeof window` 守卫后访问）。

### 5.5 `src/global.ts`（卡 1.3）

职责：包级单例 + window 挂载（供 native `evaluateJavascript` 注入与调试）。import 仅允许 `./core`（type-only）、`./events`、`./protocol`。

```ts
import type { JSBBridge } from "./core";
import { createJSBEvents, type JSBEventBus } from "./events";
import { createJSBError } from "./protocol";

export interface JSBRuntime {
  bridge: JSBBridge;
  events: JSBEventBus;
}

/** 挂到 window 上的调试/注入面;dispatchEvent 是 native evaluateJavascript 的注入入口。 */
export interface WindowJSBBridge {
  callNative: JSBBridge["callNative"];
  on: JSBEventBus["on"];
  off: JSBEventBus["off"];
  dispatchEvent: (event: string, payload?: unknown) => void;
}

export const WINDOW_BRIDGE_KEY = "__JSB_BRIDGE__";

declare global {
  interface Window {
    __JSB_BRIDGE__?: WindowJSBBridge;
  }
}

export function setupJSB(bridge: JSBBridge, events?: JSBEventBus): JSBRuntime;

export function getJSB(): JSBRuntime;

/** 测试专用:清空单例。afterEach 调用。 */
export function resetJSB(): void;

export function installWindowBridge(): WindowJSBBridge | undefined;
```

行为契约：

1. 模块级 `let current: JSBRuntime | undefined` 单例。
2. `setupJSB(bridge, events = createJSBEvents())`：`bridge` 为 falsy 或 `typeof bridge.callNative !== "function"` → 同步 TypeError；否则 `current = { bridge, events }` 并返回该对象（G2）。**重复调用直接覆盖**（幂等装配，h5 热更新场景安全）。
3. `getJSB()`：未 setup → 同步 throw `createJSBError("BRIDGE_NOT_AVAILABLE", "setupJSB() has not been called")`（G1，非法状态）。
4. `installWindowBridge()`：**先**判 `typeof window === "undefined"` → 返回 `undefined`（SSR no-op，G4）；再 `getJSB()`（未 setup 抛 JSBError，G5）；组 `WindowJSBBridge` 四个方法（箭头函数薄转发，每次 install 生成新对象）；`window.__JSB_BRIDGE__ = api` 直接赋值（重复 install 覆盖旧对象，G7）；返回 `api`。
5. `dispatchEvent` 转发 `runtime.events.dispatch(event, payload)`——native 经 `window.__JSB_BRIDGE__.dispatchEvent("event", payload)` 注入事件。
6. 挂载键名 `__JSB_BRIDGE__`：计划文档 §4 注释写作 `window.JSBridge`，**以本方案 `__JSB_BRIDGE__` 为准**（防与三方库撞名；mobile 阶段 2 注入代码按此键对接）。

### 5.6 `src/index.ts`（卡 1.3）

职责：唯一公共出口。re-export + 3 个便捷代理。实现骨架（须完整保持）：

```ts
export {
  DEFAULT_CALL_TIMEOUT_MS,
  JSB_RESULT_OK,
  JSB_ERROR_CODES,
  JSBError,
  badResponseError,
  bridgeNotAvailableError,
  createJSBError,
  isJSBError,
  timeoutError
} from "./protocol";
export type { JSBErrorCode, JSBRequest, JSBResponse, JSBResult, JSBResultError } from "./protocol";

export { createJSB, normalizeJSBResponse } from "./core";
export type { CallNativeOptions, JSBBridge, JSBOptions, JSBTransport } from "./core";

export { createJSBEvents } from "./events";
export type { JSBEventBus, JSBEventHandler } from "./events";

export { JSB_HANDLER_NAME, createFlutterTransport, isInApp } from "./adapter";
export type { FlutterInAppWebViewLike } from "./adapter";

export { WINDOW_BRIDGE_KEY, getJSB, installWindowBridge, resetJSB, setupJSB } from "./global";
export type { JSBRuntime, WindowJSBBridge } from "./global";

import type { CallNativeOptions } from "./core";
import type { JSBEventHandler } from "./events";
import { getJSB } from "./global";

/** 单例便捷代理:等价于 getJSB().bridge.callNative(...)。 */
export function callNative<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: CallNativeOptions
): Promise<T> {
  return getJSB().bridge.callNative<T>(method, params, opts);
}

/** 单例便捷代理:等价于 getJSB().events.on(...)。 */
export function on(event: string, handler: JSBEventHandler): () => void {
  return getJSB().events.on(event, handler);
}

/** 单例便捷代理:等价于 getJSB().events.off(...)。 */
export function off(event: string, handler: JSBEventHandler): void {
  getJSB().events.off(event, handler);
}
```

---

## 6. ESLint 集成与零依赖护栏

- 集成方式照抄 apps：`eslint.config.js` 首行 `import config from "@repo/eslint-config";`，`export default [...config, 追加块]`（平铺数组，**不是** extends 字段——@repo/eslint-config 是 flat config）。
- 追加块即 §4.4 的 `no-restricted-imports`：`files: ["src/**"]` + pattern `^(?!\.{1,2}/)`，与 apps/miniapp 保护 `src/core/**` 主包体积的规则同形；本包整体即 core 级，故作用于整个 `src/**`。
- `tests/**` 不在 `files` 范围，`import { ... } from "vitest"` 合法。
- 根 `pnpm lint` = `turbo run lint && pnpm run lint:root`；包被 `packages/*` glob 收录后 turbo 自动纳入，无需注册。

---

## 7. 测试计划（tests/，vitest node 环境，共 6 文件）

### 7.0 公共测试设施（每个文件自行携带，不抽公共文件）

**window stub（jsdom-free，环境为 node）：**

```ts
function stubWindow(value: Record<string, unknown> | undefined): void {
  const g = globalThis as Record<string, unknown>;
  if (value === undefined) {
    delete g.window;
  } else {
    g.window = value;
  }
}
```

- 每个用例结束必须还原：`afterEach(() => { delete (globalThis as Record<string, unknown>).window; });`（adapter/global 测试文件）。
- 该形态照抄 apps/miniapp/tests/transport_queue.test.ts 的 `(globalThis as Record<string, unknown>).Taro = {...}` 先例。

**fake timers 超时用例范式（顺序硬性要求，防止 unhandled rejection 与挂起）：**

```ts
it("C13 默认 30s 超时", async () => {
  vi.useFakeTimers();
  const bridge = createJSB(pendingTransport); // call: () => new Promise(() => {})
  const promise = bridge.callNative("getDeviceInfo");
  const assertion = expect(promise).rejects.toMatchObject({
    name: "JSBError",
    code: "TIMEOUT"
  });
  await vi.advanceTimersByTimeAsync(30000);
  await assertion;
  vi.useRealTimers();
});
```

要点：**先挂上 `expect(...).rejects` 再 advance**；文件级 `afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });` 兜底。

六类边界覆盖映射：空值（P3/C6/C18/E2/E11/A6）｜零值（C15/C23/E10）｜越界（C8/C9/C18）｜权限缺失（本包无权限概念，以 native 透传未知权限类错误码的 C4 用例等价覆盖 NATIVE_ERROR 映射）｜网络失败（C10/C11/C12/C13/A10）｜非法状态（C16/C22/E11/G1/G5）。

### 7.1 `tests/protocol.test.ts`（从 `../src/protocol` 导入）

| 用例名                     | 断言                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 常量值                  | `JSB_RESULT_OK === 0`；`DEFAULT_CALL_TIMEOUT_MS === 30000`；`JSB_ERROR_CODES` 长度 7 且含全部 7 个码（含 `CANCELLED`）                                                                |
| P2 createJSBError 整形     | `err instanceof Error`、`err instanceof JSBError`、`name === "JSBError"`、`code`/`message`/`nativeCode` 全透传；不传 nativeCode 时 `err.nativeCode === undefined`（不是 null/""）     |
| P3 isJSBError 甄别（空值） | JSBError → true；`new Error()` / `null` / `undefined` / `{ code: "TIMEOUT" }` 裸对象 / `"TIMEOUT"` 字符串 → 全 false                                                                  |
| P4 工厂消息                | `bridgeNotAvailableError()` 无参有默认 message 且 code 正确；`timeoutError("getDeviceInfo", 5000).message` 含 `"getDeviceInfo"` 与 `"5000"`；`badResponseError("x").message` 含 `"x"` |

### 7.2 `tests/core.test.ts`（从 `../src/core` 导入；JSBError 等从 `../src/protocol` 导入）

fake transport 工厂（文件内定义）：

```ts
const okTransport = (data: unknown): JSBTransport => ({
  call: () => Promise.resolve({ code: 0, data })
});
const pendingTransport: JSBTransport = { call: () => new Promise(() => {}) };
```

| 用例名                                         | 内容                                                                                                                                                                              | 边界类           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| C1 成功应答                                    | transport resolve `{code:0, data:{version:"1.0"}}` → `callNative<{version:string}>` resolve 该 data；泛型透传                                                                     | —                |
| C2 字符串应答归一                              | transport resolve `'{"code":0,"data":42}'`（JSON 字符串）→ resolve `42`                                                                                                           | —                |
| C3 METHOD_NOT_FOUND 映射                       | resolve `{code:1001, error:{code:"METHOD_NOT_FOUND", message:"no handler: foo"}}` → reject JSBError：`code==="METHOD_NOT_FOUND"`、message 原样、`nativeCode==="METHOD_NOT_FOUND"` | —                |
| C4 未知 native 码 → NATIVE_ERROR               | resolve `{code:5000, error:{code:"PERMISSION_DENIED", message:"deny"}}` → reject：`code==="NATIVE_ERROR"`、`nativeCode==="PERMISSION_DENIED"`、message 原样                       | 权限缺失（等价） |
| C5 native 失败但缺 error 字段                  | resolve `{code:7}` → reject：`code==="NATIVE_ERROR"`、`nativeCode===7`、message 含 `"7"` 与 method 名（兜底文案）                                                                 | 空值             |
| C6 应答 null → BAD_RESPONSE（空值）            | resolve `null` → reject `code==="BAD_RESPONSE"`                                                                                                                                   | 空值             |
| C7 非 JSON 字符串 → BAD_RESPONSE               | resolve `"not-json"` → reject BAD_RESPONSE                                                                                                                                        | 网络失败（形态） |
| C8 code 非数字 → BAD_RESPONSE（越界）          | resolve `'{"code":"0"}'` → reject BAD_RESPONSE                                                                                                                                    | 越界             |
| C9 数组/数字应答 → BAD_RESPONSE                | resolve `[]` 与 resolve `42` 各一例 → 均 BAD_RESPONSE                                                                                                                             | 越界             |
| C10 transport reject 普通 Error（网络失败）    | `call: () => Promise.reject(new Error("boom"))` → reject JSBError：`code==="NATIVE_ERROR"`、message 含 `"boom"`、`nativeCode===undefined`                                         | 网络失败         |
| C11 transport reject JSBError 原样透传         | `call: () => Promise.reject(bridgeNotAvailableError())` → reject 且 `await promise.catch(e => e)` 与注入的错误对象为**同一引用**（`toBe`）                                        | 网络失败         |
| C12 transport 同步 throw（非法状态）           | `call: () => { throw new Error("sync"); }` → callNative 返回 promise 且 reject NATIVE_ERROR（**不得同步抛出**：`expect(() => bridge.callNative("m")).not.toThrow()`）             | 非法状态         |
| C13 默认 30s 超时                              | §7.0 范式，advance 30000 → TIMEOUT；message 含 method 与 `30000`                                                                                                                  | 网络失败         |
| C14 单调用超时覆盖                             | opts `{timeoutMs: 5000}` → advance 4999 未 settle、再 advance 1 → TIMEOUT                                                                                                         | —                |
| C15 timeoutMs 0 = 不超时（零值）               | opts `{timeoutMs: 0}` + pendingTransport → advance `600000` 仍 pending（不断言 settle）；随后 transport resolve 的用例（单独一例）正常 resolve                                    | 零值             |
| C16 超时后迟到应答被忽略（非法状态迁移）       | 超时已 reject 后让 transport resolve（用可变 holder 触发）→ promise 仍是 TIMEOUT 结果（settle-once），且 `vi.getTimerCount() === 0`                                               | 非法状态         |
| C17 成功应答清理计时器                         | fake timers 下成功 resolve 后 `vi.getTimerCount() === 0`                                                                                                                          | —                |
| C18 入参非法 → BAD_PARAMS                      | `method: ""`、`method: "   "`（空值）、`opts: {timeoutMs: -1}`（越界）三例 → 均 reject BAD_PARAMS；且 transport.call 未被调用（spy `not.toHaveBeenCalled()`）                     | 空值/越界        |
| C19 请求信封组装                               | spy transport：传 params → `req` 深等于 `{id, method, params}`；省略 params → `req` 无 `params` 键（`expect("params" in req).toBe(false)`）                                       | 空值             |
| C20 注入 idFactory                             | `idFactory: () => "fixed-id"` → spy 断言 `req.id === "fixed-id"`                                                                                                                  | —                |
| C21 默认 id 形态与注入 now                     | `now: () => 1000` → 两次调用 id 分别为 `jsb_1000_1`、`jsb_1000_2`（seq 自 1、实例独立）                                                                                           | —                |
| C22 createJSB 入参非法（非法状态）             | `createJSB(undefined as never)`、`createJSB({} as never)` → 同步 TypeError                                                                                                        | 非法状态         |
| C23 code 0 无 data → resolve undefined（零值） | resolve `{code:0}` → `await expect(p).resolves.toBeUndefined()`                                                                                                                   | 零值             |
| C24 normalizeJSBResponse 直测                  | `{code:0,data:1}` 对象直进直出；`error` 字段畸形（`{code:0,error:"x"}` 成功侧忽略 / `{code:1,error:{code:1}}` → error 视为 undefined 走 C5 兜底）                                 | —                |

### 7.3 `tests/events.test.ts`（从 `../src/events` 导入）

| 用例名                          | 内容                                                                                                           | 边界类        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- |
| E1 on + dispatch 基本链路       | handler 收到 payload 原样引用                                                                                  | —             |
| E2 dispatch 无 payload（空值）  | handler 收到 `undefined`                                                                                       | 空值          |
| E3 多 handler 顺序              | 同事件两个 handler 按注册顺序调用（数组记录调用序）                                                            | —             |
| E4 unsubscribe 幂等             | on 返回的函数调用一次后 dispatch 不再触发；再调一次 no-op 不抛                                                 | 非法状态      |
| E5 off 语义                     | off 移除指定 handler、其它 handler 不受影响；off 未注册 handler、off 未知事件均 no-op 不抛                     | 非法状态      |
| E6 重复注册去重                 | 同一 handler 对同事件 on 两次 → dispatch 只调一次；off 一次即完全移除                                          | —             |
| E7 dispatch 无监听 no-op        | 对从未注册的事件 dispatch 不抛                                                                                 | 空值          |
| E8 handler 抛错不阻断           | 第一个 handler throw、第二个正常执行；`console.error` spy 被调一次（afterEach `vi.restoreAllMocks()`）         | —             |
| E9 派发中自注销（快照语义）     | handlerA 在回调内 off 自己；handlerB 仍被调；再次 dispatch 只剩 B                                              | 非法状态迁移  |
| E10 listenerCount（零值）       | 未知事件 → 0；on 两次不同 handler → 2；off 后 → 1；全部移除 → 0                                                | 零值          |
| E11 事件名非法（空值/非法状态） | `on("", h)`、`off("", h)`、`dispatch("", p)`、`listenerCount("")`、`on("x", null as never)` → 均同步 TypeError | 空值/非法状态 |
| E12 事件隔离                    | dispatch("a") 不触发 "b" 的 handler                                                                            | —             |

### 7.4 `tests/adapter.test.ts`（从 `../src/adapter` 导入；用 §7.0 stubWindow）

| 用例名                                               | 内容                                                                                                                                                                                                  | 边界类   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1 isInApp 无 window（SSR）                          | 不 stub（node 默认无 window）→ false；**直接调用不抛**                                                                                                                                                | 空值     |
| A2 isInApp 空 window                                 | `stubWindow({})` → false                                                                                                                                                                              | 空值     |
| A3 isInApp 桥为空对象                                | `flutter_inappwebview: {}` → false                                                                                                                                                                    | 空值     |
| A4 isInApp 仅 postMessage                            | `{postMessage: () => {}}` → true                                                                                                                                                                      | —        |
| A5 isInApp 仅 callHandler                            | `{callHandler: async () => 1}` → true                                                                                                                                                                 | —        |
| A6 isInApp 桥为 null/非对象（空值）                  | `flutter_inappwebview: null`、`flutter_inappwebview: 1` → 均 false 不抛                                                                                                                               | 空值     |
| A7 transport 无 window → BRIDGE_NOT_AVAILABLE（SSR） | 不 stub → `callNative` 等价物 `transport.call(req)` reject JSBError `code==="BRIDGE_NOT_AVAILABLE"`                                                                                                   | 网络失败 |
| A8 桥无 callHandler（仅 postMessage）→ reject        | reject BRIDGE_NOT_AVAILABLE                                                                                                                                                                           | 非法状态 |
| A9 正常往返 + 序列化                                 | stub `callHandler: vi.fn(async (name, req) => ({code: 0, data: req}))` → 断言 name `"jsb"`；`req` 与传入对象**同一引用**；另断言 `JSON.parse(JSON.stringify(req))` 深等于原 req（序列化往返不丢字段） | —        |
| A10 native promise reject 透传（网络失败）           | callHandler reject `new Error("native boom")` → transport.call reject 同一 Error（adapter 不包装，`catch(e => e)` `toBe` 原对象）                                                                     | 网络失败 |
| A11 JSB_HANDLER_NAME 常量                            | `=== "jsb"`                                                                                                                                                                                           | —        |

req 统一构造：`const req: JSBRequest = { id: "t-1", method: "getDeviceInfo" };`。

### 7.5 `tests/global.test.ts`（从 `../src/global` 导入；每个用例 afterEach 必须 `resetJSB()` + 删 window stub）

fake bridge：`const fakeBridge: JSBBridge = { callNative: vi.fn(async () => ({ ok: true })) };`

| 用例名                                        | 内容                                                                                                                                                                                                                                            | 边界类       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| G1 getJSB 未 setup（非法状态）                | 同步 throw JSBError `code==="BRIDGE_NOT_AVAILABLE"`                                                                                                                                                                                             | 非法状态     |
| G2 setupJSB 自动建 events                     | `setupJSB(fakeBridge)` → getJSB() 返回 `{bridge: 同一引用, events: 定义}`；显式传 events → 同一引用                                                                                                                                             | —            |
| G3 setupJSB 非法入参                          | `setupJSB(undefined as never)` / `setupJSB({} as never)` → TypeError                                                                                                                                                                            | 非法状态     |
| G4 installWindowBridge 无 window（SSR no-op） | setup 后不 stub window → 返回 `undefined` 不抛                                                                                                                                                                                                  | 空值         |
| G5 installWindowBridge 未 setup（非法状态）   | stub window 但不 setup → throw JSBError                                                                                                                                                                                                         | 非法状态     |
| G6 挂载与代理链路                             | setup + stub window + install → `window.__JSB_BRIDGE__` 四方法齐全；`await window.__JSB_BRIDGE__.callNative("m", {a:1})` → fakeBridge.callNative 被调且参数透传；`on("e", h)` 后 `dispatchEvent("e", {x:1})` → h 收到 `{x:1}`；`off` 后不再触发 | —            |
| G7 重复 install 覆盖                          | install 两次 → 第二次返回值覆盖 window 上的键（`window.__JSB_BRIDGE__` 与第二次返回值同一引用）                                                                                                                                                 | 非法状态迁移 |
| G8 WINDOW_BRIDGE_KEY 常量                     | `=== "__JSB_BRIDGE__"`                                                                                                                                                                                                                          | —            |

### 7.6 `tests/index.test.ts`（**从 `../src/index` 导入**，验证公共出口；afterEach 同 7.5）

| 用例名                 | 内容                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 re-export 冒烟      | `createJSB/createJSBEvents/createFlutterTransport/isInApp/setupJSB/getJSB/resetJSB/installWindowBridge/normalizeJSBError…`（§5.6 全清单）均 `typeof === "function"`；`JSB_ERROR_CODES` 为数组、`DEFAULT_CALL_TIMEOUT_MS === 30000`、`WINDOW_BRIDGE_KEY === "__JSB_BRIDGE__"`、`JSB_HANDLER_NAME === "jsb"` |
| I2 callNative 代理     | setupJSB(fakeBridge) 后 `callNative("m")` → fakeBridge.callNative 被调、返回值透传                                                                                                                                                                                                                         |
| I3 on/off 代理         | `on("e", h)` → 经 `getJSB().events.dispatch("e", 1)` 触发；`off("e", h)` 后不再触发                                                                                                                                                                                                                        |
| I4 callNative 未 setup | reject JSBError（getJSB 的同步 throw 在 async 函数外——`callNative` 是普通函数，`getJSB()` 同步 throw 会导致 callNative 同步抛。**断言方式为 `expect(() => callNative("m")).toThrow(JSBError)`**，并据此确认 §5.6 实现即此语义，不得包成 reject）                                                           |

---

## 8. 执行步骤与验收命令

执行顺序（严格）：

```bash
# 1. 建目录与全部文件(§3 清单;先配置后源码后测试)
mkdir -p packages/js-bridge/src packages/js-bridge/tests

# 2. 链接 workspace 依赖(根执行;pnpm-workspace.yaml 的 packages/* 已自动收录,无需改根文件)
pnpm install

# 3. 格式化(仓库 prettier 风格:双引号/分号/trailingComma none/printWidth 100)
pnpm exec prettier --write packages/js-bridge

# 4. 三项门禁(必须全绿)
pnpm --filter @repo/js-bridge lint
pnpm --filter @repo/js-bridge typecheck
pnpm --filter @repo/js-bridge test

# 5. 覆盖率门槛(四项 ≥90;门槛只许超不许降,若不足 90 先补用例,不许调阈值)
pnpm --filter @repo/js-bridge exec vitest run --coverage

# 6. turbo 链路冒烟(确认根命令已收录新包;只跑 lint+typecheck+test 即可)
pnpm turbo run lint typecheck test --filter @repo/js-bridge
```

验收标准（逐条核对）：

1. `pnpm --filter @repo/js-bridge lint` / `typecheck` / `test` 三命令退出码 0。
2. 覆盖率输出 lines/functions/branches/statements 全 ≥90（`src/**`）。
3. §7 全部用例存在且通过（用例名前缀 P/C/E/A/G/I 编号齐全）。
4. `package.json` 无 `dependencies` 字段；`eslint packages/js-bridge/src` 下 `no-restricted-imports` 对任何裸导入报错（可临时加一行 `import _ from "lodash"` 验证规则生效后删除，**验证后必须删净**）。
5. 未改动任何既有文件（`git status` 只出现 `packages/js-bridge/` 与本文件路径之外无新增修改；执行者**不改** hybrid-capability-plan.md）。
6. `pnpm verify` 不需要在本阶段跑全量（desktop e2e 等与本包无关），但 `turbo` 冒烟必须证明新包已进入任务图。

---

## 9. 易错点清单（实现时逐项自查）

1. **方括号访问**：`normalizeJSBResponse` 中对 `Record<string, unknown>` 形态取 `code`/`data`/`error` 必须 `obj["code"]`（`noPropertyAccessFromIndexSignature`）。
2. **类型导入**：`isolatedModules` 下跨文件引类型必须 `import type` / `export type`（§5.6 骨架已标注，照抄）。
3. **JSBError.name**：`useDefineForClassFields: true`（base.json）下在 constructor 内 `this.name = "JSBError"` 赋值，不要用类字段声明覆盖（避免与 Error 原型链语义打架）。
4. **unhandled rejection**：超时用例必须先挂 `expect(p).rejects` 再 `advanceTimersByTimeAsync`；pending promise 用例（C15）结束要 `vi.useRealTimers()`。
5. **单例泄漏**：global/index 测试每个文件 `afterEach(resetJSB)`；vitest 默认文件间隔离，但文件内用例共享模块态。
6. **window 还原**：adapter/global 测试 afterEach 必须 `delete (globalThis as Record<string, unknown>).window`，否则污染同文件后续用例的 SSR 分支。
7. **同步 throw 边界**：callNative 的入参校验走 reject；transport 同步 throw 经 try/catch 转 reject；`createJSB`/`setupJSB`/`getJSB`/事件名校验走同步 throw——两套语义不要混淆，测试已分别锁定（C12 vs C18/C22/G1/E11）。
8. **`includes` 窄化**：`JSB_ERROR_CODES.includes(wireCode)` 需先 `as readonly string[]`（readonly tuple 的 includes 参数被窄化为字面量联合）。
9. **注释语言**：源码 JSDoc/注释用中文（仓库惯例），commit message 遵循 Conventional Commits（如 `feat(js-bridge): ...`）。
10. **禁止手改生成物/禁止新增依赖**：本包无生成物；`pnpm install` 后若 lockfile 出现非预期依赖变更（如有人给包加了 dependencies），视为事故回滚。
