# Flutter 通用壳方案：apps/mobile 基础设施化

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：把 `apps/mobile` 从 hello-world 占位升级为**通用业务壳**——无具体业务，但性能监控、错误上报、埋点、稳定性、自动化测试全部就绪；所有外部依赖点留配置坑；附 `apps/mobile/AGENTS.md` 作为架构约束，保证后续业务开发不破坏架构。
> 前置依赖：已完成的 [docs/monorepo-expansion-plan.md](monorepo-expansion-plan.md)（mobile 最小包、CI flutter job 已存在）。

---

## 0. TL;DR

| 项       | 结论                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 监控厂商 | **Sentry Flutter**（`sentry_flutter ^9.30.0`）；架构上抽 `ErrorReporter` / `PerformanceMonitor` / `EventTracker` 三接口，DSN 缺失即 no-op（与 site 的 ARMS RUM"缺 env 不初始化"同哲学） |
| 状态管理 | **Riverpod**（编译期安全、测试友好、provider override 天然就是"配置坑"机制）                                                                                                            |
| 平台目录 | 阶段 0 装 Flutter SDK，`flutter create .` 生成 android/ios，本地真实验收                                                                                                                |
| 测试深度 | unit + widget，CI 加覆盖率产物；golden / integration_test 列入后续                                                                                                                      |
| 网络层   | 裸 `http` 换 **dio**（拦截器生态），信封 `{code,message,data,logID}` 解包收口在拦截器                                                                                                   |
| 工作量   | 约 **4~5 人日**；planner 编排 + coding-agent 执行，**最大并行 3**，并行后约 **1.5 日历天**                                                                                              |

---

## 1. 现状盘点：目前还差什么

已有（上一轮交付）：最小 Dart 包（`pubspec.yaml` + `lib/main.dart` + `lib/api.dart` + 8 个纯 Dart 单测）、CI flutter job（analyze + test，paths 过滤）、README。

**差距清单**（本方案逐项补齐）：

| #   | 缺口         | 现状                                                    | 目标                                                                                             |
| --- | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | 平台工程     | 无 android/ios 目录，无法真机运行、无法集成任何原生 SDK | 阶段 0 装 SDK 后 `flutter create .` 生成                                                         |
| 2   | 应用分层     | 单文件 main.dart，业务无处安放                          | `core/`（基础设施）+ `app` 装配 + `features/`（业务）三层                                        |
| 3   | 状态管理     | 裸 setState                                             | Riverpod，服务以 Provider 暴露、override 即替换                                                  |
| 4   | 路由         | 无                                                      | go_router 路由表 + 错误页                                                                        |
| 5   | 网络层       | 裸 http 包手写，无信封/错误模型/超时/重试               | dio 工厂 + 信封拦截器 + `AppError` 错误模型                                                      |
| 6   | 配置系统     | baseURL 写死在代码注释里                                | `AppConfig` 经 `--dart-define` 驱动，所有坑集中一处（env/flavor）                                |
| 7   | 错误监控     | 无                                                      | `ErrorReporter` 抽象 + Sentry 实现，DSN 缺失 no-op                                               |
| 8   | 性能监控     | 无                                                      | `PerformanceMonitor` 抽象（trace/span），Sentry 实现（启动、路由事务）                           |
| 9   | 埋点         | 无                                                      | `EventTracker` 抽象（事件 + 属性），console/Sentry 实现可切                                      |
| 10  | 稳定性       | 无未捕获异常收口                                        | `runZonedGuarded` + `FlutterError.onError` + `PlatformDispatcher.onError` 全收口进 ErrorReporter |
| 11  | 日志         | 无                                                      | `AppLogger` 抽象（分级），ERROR 级自动挂接 ErrorReporter                                         |
| 12  | 自动化测试   | 8 个纯 Dart 单测                                        | unit + widget 双轨 + 测试替身 helpers + CI 覆盖率                                                |
| 13  | 架构约束文档 | 无                                                      | `apps/mobile/AGENTS.md`：分层、依赖方向、禁止事项、配置坑清单                                    |
| 14  | 杂项坑位     | 无                                                      | theme（亮暗）、l10n（intl 接线）、`KeyValueStore` 本地存储抽象                                   |

**明确不做**（列入后续阶段）：dart 侧 openapi 生成链（沿用前方案 §7）、golden 测试、integration_test 真机端到端、apk/ipa 构建分发与签名、ARMS 厂商对齐（Sentry 已选；ARMS 可日后经 `EventTracker`/`ErrorReporter` 接口追加第二实现）。

---

## 2. 决策记录

1. **监控厂商选 Sentry Flutter**。放弃与 site 对齐的阿里云 RUM（其 Flutter 插件 `alibabacloud_rum_flutter_plugin` 需额外集成原生 SDK，偏重）。架构上仍保持厂商可替换：三接口抽象 + 配置坑。
2. **状态管理 Riverpod**。壳骨架以 Riverpod 组织：core 服务全部以 Provider 暴露，`main.dart` 里 `ProviderScope(overrides: ...)` 按 AppConfig 选择实现——override 机制本身就是"配置坑"的落地形式。
3. **阶段 0 装 SDK、生成平台目录**。本机当前无 Flutter SDK；生成 android/ios 后本地可 `flutter analyze/test` 真实验收，Sentry 原生符号上传等后续也有了地基。
4. **测试 unit + widget**。CI 加 `--coverage` 产物上传；不设硬覆盖率门槛（壳阶段样本太小，门槛无意义，业务接入后再加）。
5. **网络层 dio**。拦截器生态成熟（信封解包、token 预留、重试、日志各一个拦截器）；监控侧对 dio 的插桩是各厂商通行做法。现有 `lib/api.dart`（http 包）迁移进 `core/network/`，`http` 依赖移除。
6. **路由 go_router**（官方）。路由表独立于页面，天然支持路由级性能事务。
7. **信封语义与 JS 端对齐**：HTTP 200 且 `code == 200` → 解出 `data`；否则抛 `AppError(code, message, logID)`（server `WriteJSON` 实测形态 `{"code":200,"message":"ok","data":...,"logID":...}`）。

---

## 3. 目标架构

```
apps/mobile/
  android/ ios/                  # 阶段 0 生成（flutter create .）
  lib/
    main.dart                    # 装配：AppConfig(dart-define) → ProviderScope(overrides) → Sentry 条件初始化 → runZonedGuarded → runApp
    app.dart                     # MaterialApp.router：theme / l10n / router 挂载
    core/
      config/                    # AppConfig + Flavor（dev/staging/prod），dart-define 读取收口
      logging/                   # AppLogger 抽象 + ConsoleLogger；ERROR 级挂接 ErrorReporter
      error/                     # ErrorReporter 抽象 + SentryErrorReporter + NoopErrorReporter + AppError 模型
      monitoring/                # PerformanceMonitor 抽象（startTrace/span）+ Sentry 实现 + Noop
      analytics/                 # EventTracker 抽象 + Console/Sentry 实现
      network/                   # dio 工厂 + 信封拦截器 + 错误拦截器 + 超时/重试；ping 调用迁入
      storage/                   # KeyValueStore 抽象 + SharedPreferences 实现
    router/                      # go_router 路由表 + 错误页
    theme/                       # ThemeData 亮/暗 + design tokens 占位
    l10n/                        # flutter_localizations 接线 + 占位 arb
    features/
      home/                      # 示例 feature：ping 页（view + riverpod controller），业务接入范式样板
  test/
    unit/                        # 纯逻辑（拦截器、config、envelope）
    widget/                      # 页面三态（loading/success/failure）
    helpers/                     # Fake 实现（FakeErrorReporter/FakeTracker/pumpApp 包装）
  AGENTS.md                      # 架构约束（本方案交付物之一）
```

**依赖方向（写进 AGENTS.md 的硬规则）**：`features/ → core/`，`core/` 内部模块互不依赖（config 除外，人人可用）；`core/` 禁止 import `features/`；禁止业务代码直接 `print` / 裸 `new Dio()` / 裸读 `Platform.environment`（必须经 AppConfig）。

**配置坑清单**（dart-define，README 落表）：

| key                         | 用途             | 缺失行为                                                 |
| --------------------------- | ---------------- | -------------------------------------------------------- |
| `API_BASE_URL`              | 后端基地址       | 默认 `http://localhost:18085`（Android 模拟器 10.0.2.2） |
| `SENTRY_DSN`                | Sentry 接入      | 缺失则 ErrorReporter/PerformanceMonitor 全部 no-op       |
| `SENTRY_TRACES_SAMPLE_RATE` | 性能采样率       | 默认 0.0                                                 |
| `FLAVOR`                    | dev/staging/prod | 默认 dev                                                 |
| `ANALYTICS_ENABLED`         | 埋点开关         | 默认 false（console 实现）                               |

---

## 4. 分阶段计划与并行编排

**编排模型**：planner（出任务卡、把门禁）→ coding-agent 按卡执行。任务卡含文件所有权清单 + 验收命令 + 禁止事项；agent 间文件所有权互不相交。

**并行约束分析**（决定最大并行数）：

1. `pubspec.yaml` 是单点（所有依赖声明集中）→ **阶段 1 一次写全依赖并钉版本**，阶段 2 模块 agent 禁改 pubspec；
2. `main.dart` / `app.dart` 是装配单点 → 阶段 3 收口独占；
3. Flutter 单包编译，模块间经接口耦合 → **阶段 1 冻结全部 core 抽象接口**，阶段 2 各模块实现文件不相交，可并行；
4. 阶段 0 与阶段 1 强串行（无 SDK 什么都验不了）。

由此**全局最大并行 3**（阶段 2 的三个互不相交文件集）。

### 阶段 0：环境准备（串行；系统级变更，可由用户手动完成）

| 任务卡 | 内容                                                                                                                                                                     | 验收                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 0.1    | 安装 Flutter SDK stable：`git clone https://github.com/flutter/flutter.git -b stable ~/flutter` 并配 PATH（或用户自选 brew/官网 zip；已装则跳过）；`flutter doctor` 自查 | `flutter --version` 正常；`flutter doctor` 关键项绿（Android/iOS 工具链允许告警，本方案不需要模拟器） |

### 阶段 1：骨架与接口冻结（并行度 1，依赖阶段 0）

| 任务卡 | 内容                                                                                                                                                                                                                                                       | 验收                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1.1    | `cd apps/mobile && flutter create .` 生成 android/ios/web(如默认) 平台目录；`.gitignore` 核对（平台产物不入库）；确认 `flutter analyze && flutter test` 基线绿                                                                                             | analyze/test 绿                           |
| 1.2    | pubspec 全量依赖一次钉定（查 pub.dev 取最新稳定）：`dio`、`flutter_riverpod`、`go_router`、`sentry_flutter ^9.30.0`、`shared_preferences`、`intl` + `flutter_localizations`(sdk)；移除 `http`；`environment.sdk` 若 sentry 9 要求更高则抬升并记录          | `flutter pub get` 成功                    |
| 1.3    | 建目录骨架；**定义并冻结全部 core 抽象接口**（`AppConfig`/`AppLogger`/`ErrorReporter`/`PerformanceMonitor`/`EventTracker`/`KeyValueStore`/`AppError`），只写接口与类型，不写实现；`main.dart` 最小装配雏形（ProviderScope + 直接跑现有 ping 逻辑，可临时） | analyze 绿；接口文件即阶段 2 的任务卡附件 |

### 阶段 2：模块并行（并行度 3，依赖阶段 1；三卡文件所有权互不相交，均禁改 pubspec/main.dart）

| 任务卡         | 文件集                                                                                            | 内容                                                                                                                                                                                                                         | 验收                          |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2.A network    | `lib/core/network/` + `test/unit/`（network 部分）                                                | dio 工厂（baseUrl 从 AppConfig）；信封拦截器（code==200 解 data，否则抛 AppError）；错误/超时/重试拦截器；现有 ping 调用迁移为 `PingRepository`（走 dio）；单测：信封边界六类（空值/零值/越界/非法 JSON/缺字段/非 200 code） | `flutter test test/unit` 绿   |
| 2.B 监控三件套 | `lib/core/error/`、`monitoring/`、`analytics/`、`logging/`、`storage/` + `test/unit/`（对应部分） | 三接口的 Sentry 实现 + Noop/Console 实现；`AppLogger`（分级，ERROR 挂 ErrorReporter）；`KeyValueStore` + SharedPreferences 实现；单测用 Fake 验证：DSN 缺失时 no-op、事件字段透传正确                                        | `flutter test test/unit` 绿   |
| 2.C 壳应用层   | `lib/router/`、`theme/`、`l10n/`、`features/home/` + `test/widget/` + `test/helpers/`             | go_router 路由表 + 错误页；ThemeData 亮/暗 + tokens 占位；l10n 接线；home feature：ping 页 Riverpod 化（controller 调 PingRepository，渲染三态）；widget 测试三态 + `test/helpers/pumpApp`（ProviderScope 包装器）           | `flutter test test/widget` 绿 |

### 阶段 3：装配收口（并行度 1，依赖阶段 2）

| 任务卡 | 内容                                                                                                                                                                                                                       | 验收                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 3.1    | main.dart 完整装配：`runZonedGuarded` + `FlutterError.onError` + `PlatformDispatcher.onError` 全收口；`AppConfig.fromDartDefines()`；ProviderScope overrides 按 config 选实现；`SentryFlutter.init` 条件化（DSN 缺失跳过） | analyze + 全量 test 绿     |
| 3.2    | 联通验证：本地起 server（18085），`flutter run -d <可用设备>` 或退而求其次经 unit 级集成测试验证 dio 信封链路对真实 server 的 ping（curl 对照）                                                                            | 页面渲染 pong 或集成测试绿 |
| 3.3    | `flutter test --coverage` 跑通，coverage/ 产物不入库（.gitignore）                                                                                                                                                         | 覆盖率文件生成             |

### 阶段 4：CI 增强 + 文档收口（并行度 2，依赖阶段 3；文件不相交）

| 任务卡   | 内容                                                                                                                                                                                                                                                              | 验收                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 4.A CI   | `.github/workflows/flutter.yml`：`flutter test --coverage` + 覆盖率 lcov 上传工件（不设硬门槛）；`scripts/verify.sh` flutter 段同步加 `--coverage`（保持本地/CI 同构）                                                                                            | workflow YAML 合法；本地 verify 绿 |
| 4.B 文档 | `apps/mobile/AGENTS.md` 定稿（分层图、依赖方向硬规则、禁止事项：禁 print/裸 Dio/裸读环境变量、接口替换点清单、新增 feature 范式）；`apps/mobile/README.md` 更新（配置坑 dart-define 表、Sentry 接入、真机运行、测试命令）；本方案文档执行记录回填（planner 配合） | prettier 通过                      |

### 排期与并行图

```
阶段0 (SDK, 串行)
  └─► 阶段1 (骨架+接口冻结, 1人)
        └─► 阶段2 (2.A network ∥ 2.B 监控三件套 ∥ 2.C 壳应用层, 3人并行)
              └─► 阶段3 (装配收口, 1人)
                    ├─► 阶段4.A (CI, 1人)
                    └─► 阶段4.B (文档, 1人)
```

估算：阶段 0 ≈ 0.5 人日（主要是 SDK 下载）；阶段 1 ≈ 1；阶段 2 每卡 0.5~~1；阶段 3 ≈ 0.5~~1；阶段 4 每卡 ≈ 0.5。合计 **4~5 人日，并行后约 1.5 日历天**。

---

## 5. 风险清单

| 风险                                                          | 等级 | 缓解                                                                           |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| `sentry_flutter` 9 对 Flutter/Dart 版本下限高于 `sdk: ^3.5.0` | 低   | 任务卡 1.2 实测钉定，必要则抬 sdk 约束并记录                                   |
| 阶段 0 装 SDK 是系统级变更（下载 ~1GB、PATH 修改）            | 低   | 任务卡允许用户手动完成；agent 执行走 `git clone` 到 `~/flutter`，无需 sudo     |
| 阶段 2 三卡都写 `test/unit/` 目录，文件名冲突                 | 低   | 任务卡约定各卡测试文件前缀（`network_*` / `monitoring_*` 等）                  |
| Sentry 真实上报无法在无 DSN 环境验证                          | 低   | 架构即 no-op 设计；单测用 Fake 验证调用契约；真实接入属配置事项（填 DSN 即通） |
| 厂商分裂（site 用 ARMS，mobile 用 Sentry）                    | 低   | 决策已记录；ARMS 可日后经三接口追加第二实现，架构不返工                        |
| 覆盖率门槛误伤                                                | 低   | 本次只上传产物不设门槛，业务接入后再评                                         |

---

## 6. 后续阶段（明确不在本次）

1. dart 侧 openapi 生成链（沿用前方案 §7.3，替代手写 `PingRepository`）；
2. golden 测试与 integration_test（CI 模拟器 job）；
3. apk/ipa 构建、签名与分发；
4. 启动耗时/帧率真机基线采集与上报；
5. token 注入拦截器（C 端用户体系落地时，前方案 §7.1）；
6. 覆盖率硬门槛（业务代码达到一定规模后）。

---

## 7. 执行记录

| 阶段                      | 状态    | 提交                        | 备注                                                                                     |
| ------------------------- | ------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| 0 环境准备                | ✅ 完成 | —(M0 无提交) | ~/flutter stable 3.47.5;平台目录本机生成不入库 |
| 1 骨架与接口冻结          | ✅ 完成 | 7864c31 / 396dbcb / 0e0a629 | 1.1 基线+平台目录 ignore；1.2 依赖钉版（http 移除顺延 M2.A）；1.3 接口冻结+ProviderScope |
| 2 模块并行（2.A/2.B/2.C） | ✅ 完成 | 5fdb95c / 85533f6 / 7e35b37 | network 信封拦截器;监控三件套;router/theme/l10n/home |
| 3 装配收口                | ✅ 完成 | d780c86 / 7e5061c | runZonedGuarded 全收口+Sentry 条件 init;联通+coverage |
| 4 CI + 文档               | ✅ 完成 | 3331f72 / f5d666d | flutter.yml --coverage+lcov;verify.sh 同构;AGENTS+README |
