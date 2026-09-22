# 阶段 6 / 阶段 7 施工方案：mobile 权限+媒体+JSB 媒体方法 与 更新检查+Push 抽象+曝光

> 对应 docs/hybrid-capability-plan.md 阶段 6（任务卡 6.1–6.3）与阶段 7（任务卡 7.1–7.3，本方案把 7.1 的
> mobile 侧拆为独立卡 7.4），决策 5（JSB 首批方法媒体组）、7（Push 抽象）、8（更新检查走契约）、
> 9（媒体全量）、10（权限策略）、11（曝光语义）。
> 本文件是给 coding-agent 的完整施工方案：**所有架构决策已做完，执行者不得自行变更 API 形态、文件结构、命名、文案、依赖版本。**
> 目标分支：`refactor/big-infra`。格式与纪律沿用 [hybrid-phase-4-5-spec.md](hybrid-phase-4-5-spec.md)。
> 环境约束沿用总计划 §5：**本机无 Flutter SDK**，mobile 代码与测试照常交付，`flutter analyze/test` 标记「待 Flutter 环境执行」，并附静态自查清单（§10）。

---

## 1. 范围与边界

**阶段 6 做**（apps/mobile，Flutter，agent A 独占）：

- 6.1 `core/permission/`：`PermissionService` 抽象（check/request/openSettings）+ 五态状态机 + 七类权限枚举 + permission_handler 实现 + 首次拒绝/永久拒绝中文说明弹窗 + 装配。
- 6.2 `core/media/`：选图（相册/相机）、图片压缩、缓存图片组件、文件选择、视频、音频、相册保存、图片信息读取（钉版本进 pubspec）。
- 6.3 `core/hybrid/jsb_methods/media.dart`：`chooseImage`/`takePhoto`/`saveImageToAlbum`/`getImageInfo` 四个 JSB handler（权限前置、CANCELLED/PERMISSION_DENIED 错误语义、返回结构锁定）+ webview 注册表与容器页装配。

**阶段 7 做**：

- 7.1（agent B，**只改 `openapi/app/**` + `apps/server/**`**）：`GET /api/app/version/check` 契约 + gen:api + server env 配置 + `VersionService`（semver 比较纯函数）+ handler + 测试。
- 7.2（apps/mobile）：`core/push/` PushService 抽象 + PushMessage 协议 + 路由映射纯函数 + NoopPushService + `PUSH_ENABLED` dart-define + JSB push 事件通道预留（**仅文档与常量，不实现**）。
- 7.3（apps/mobile）：`core/ui/exposure_detector.dart`（visibility_detector，50%/300ms/页面实例级去重）+ `EventTracker.expose()` 语义（对齐 miniapp `track.expose`）。
- 7.4（apps/mobile，依赖 7.1 的契约语义）：`core/network/version_repository.dart` + `core/update/update_checker.dart` + `features/update/` 更新弹窗（强制更新不可关闭）+ 启动触发接线。

**不做**（明确排除）：

- 不实现任何鉴权逻辑（决策 1）；不做 JSB `uploadFile`（server 无上传契约，总计划 §7）。
- 不接真实 Push SDK（FCM/厂商通道后续阶段）；`push.message` JSB 事件只留常量与注释。
- 不做 admin 版本管理配置页（version/check 数据源本期只读 env）。
- 不做 offline 包、deeplink、l10n（权限/弹窗文案只出中文，决策 12）。
- 不改 `apps/h5`、`apps/miniapp`、`packages/js-bridge`（错误码协议不动，PERMISSION_DENIED 走 native 自定义字符串码，见 §4.3）。
- 不回填 docs/hybrid-capability-plan.md §8 执行记录（planner 在阶段门禁时回填）。
- 阶段 6/7 不改 `lib/main.dart`（Sentry/装配选型不动）；不改 `lib/app.dart` 已有接线（7.4 的启动触发走路由层 UpdateGate，见 §5.4）。

---

## 2. 文件所有权与并行冲突控制

### 2.1 两卡并行矩阵

| 所有者  | 卡                    | 允许改动的路径                               | 证明         |
| ------- | --------------------- | -------------------------------------------- | ------------ |
| agent A | 阶段 6（6.1/6.2/6.3） | `apps/mobile/**` 仅此一处                    | 见 §2.2 清单 |
| agent B | 阶段 7.1              | `openapi/app/**` + `apps/server/**` 仅此两处 | 见 §2.3 清单 |

**互不相交证明**：A 的全部改动以 `apps/mobile/` 为前缀；B 的全部改动以 `openapi/app/` 或 `apps/server/` 为前缀。三个前缀互不重叠，git 层面不可能冲突。A 不需要等 B 的契约落地（6.x 不消费 version/check），B 不需要等 A（server 不依赖 mobile）。

### 2.2 阶段 6（agent A）文件清单

| 动作 | 文件                                                                                             | 卡      |
| ---- | ------------------------------------------------------------------------------------------------ | ------- |
| 修改 | `apps/mobile/pubspec.yaml`（8 个依赖单行追加，字母序，见 §4.0）                                  | 6.1/6.2 |
| 新增 | `apps/mobile/lib/core/permission/permission_service.dart`                                        | 6.1     |
| 新增 | `apps/mobile/lib/core/permission/permission_handler_service.dart`                                | 6.1     |
| 新增 | `apps/mobile/lib/core/permission/permission_rationale.dart`                                      | 6.1     |
| 新增 | `apps/mobile/lib/core/media/media_picker_service.dart`                                           | 6.2     |
| 新增 | `apps/mobile/lib/core/media/image_compress_service.dart`                                         | 6.2     |
| 新增 | `apps/mobile/lib/core/media/cached_image.dart`                                                   | 6.2     |
| 新增 | `apps/mobile/lib/core/media/file_service.dart`                                                   | 6.2     |
| 新增 | `apps/mobile/lib/core/media/video_service.dart`                                                  | 6.2     |
| 新增 | `apps/mobile/lib/core/media/audio_service.dart`                                                  | 6.2     |
| 新增 | `apps/mobile/lib/core/media/media_saver_service.dart`                                            | 6.2     |
| 新增 | `apps/mobile/lib/core/media/image_info_service.dart`                                             | 6.2     |
| 新增 | `apps/mobile/lib/core/hybrid/jsb_methods/media.dart`                                             | 6.3     |
| 修改 | `apps/mobile/lib/features/webview/webview_jsb_registry.dart`（加 media 参数，见 §4.4 diff）      | 6.3     |
| 修改 | `apps/mobile/lib/features/webview/webview_page.dart`（initState 装配 media deps，见 §4.4 diff）  | 6.3     |
| 修改 | `apps/mobile/lib/app_providers.dart`（permission/media 7 个 Provider，见 §4.4 diff）             | 6.1/6.2 |
| 修改 | `apps/mobile/AGENTS.md`（仅 §2 例外清单追加一段，见 §4.5）                                       | 6.3     |
| 新增 | `apps/mobile/test/unit/permission_map_test.dart`                                                 | 6.1     |
| 新增 | `apps/mobile/test/unit/permission_service_test.dart`                                             | 6.1     |
| 新增 | `apps/mobile/test/widget/permission_rationale_test.dart`                                         | 6.1     |
| 新增 | `apps/mobile/test/unit/media_logic_test.dart`（压缩参数/文件白名单/图片类型推断纯逻辑）          | 6.2     |
| 新增 | `apps/mobile/test/unit/jsb_methods_media_test.dart`                                              | 6.3     |
| 修改 | `apps/mobile/test/unit/webview_jsb_registry_test.dart`（注册表签名变化，补 media fake，见 §4.4） | 6.3     |

阶段 6 **不得触碰**：`openapi/**`、`apps/server/**`、`packages/**`、其他 `apps/**`、`lib/main.dart`、`lib/app.dart`、`lib/router/`。

### 2.3 卡 7.1（agent B）文件清单

| 动作 | 文件                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------- |
| 新增 | `openapi/app/paths/version-check.yaml`                                                          |
| 新增 | `openapi/app/components/schemas/version-check.yaml`                                             |
| 修改 | `openapi/app/openapi.yaml`（paths 下追加一条 `$ref`，见 §5.1 diff）                             |
| 生成 | `apps/server/gen/app/gen.go`（`pnpm gen:api` 产物，**禁止手改**）                               |
| 修改 | `apps/server/internal/config/config.go`（AppVersion 配置节）                                    |
| 修改 | `apps/server/internal/config/config_test.go`（env 解析用例）                                    |
| 新增 | `apps/server/internal/service/version_service.go`                                               |
| 新增 | `apps/server/internal/service/version_service_test.go`                                          |
| 新增 | `apps/server/internal/handler/app/version.go`                                                   |
| 新增 | `apps/server/internal/handler/app/version_test.go`                                              |
| 修改 | `apps/server/internal/handler/app/app.go`（`New` 签名加 VersionService）                        |
| 修改 | `apps/server/internal/handler/app/ping_test.go`（`New(nil)` → `New(nil, versions)` 一处调用点） |
| 修改 | `apps/server/cmd/server/main.go`（构造 versionService 并传入 apphandler.New，见 §5.2 diff）     |

卡 7.1 **不得触碰**：`apps/mobile/**`（mobile 更新客户端是卡 7.4，见下）、`apps/server/gen/**` 以外的生成物手改、`httpapi.RoutePermissions`（公开受众无权限概念，AGENTS §6）。

### 2.4 串行约束（后续卡说明）

**卡 7.2 / 7.3 / 7.4（全部 `apps/mobile/**`）必须在阶段 6 验收合并后再开工**，原因：

- 三方都改 `apps/mobile/lib/app_providers.dart`（6.x 加 permission/media Provider，7.2 加 pushServiceProvider，7.4 加 versionRepositoryProvider/updateCheckerProvider）与 `apps/mobile/pubspec.yaml`（依赖追加），并行必冲突；
- 7.4 的 `VersionRepository` 消费 7.1 的契约语义（字段名/信封），需 7.1 已合并以便对照 `gen/app` 生成物；
- 7.2/7.3/7.4 之间互不依赖，可由同一 agent 一次交付，内部顺序 7.2 → 7.3 → 7.4。

---

## 3. 仓库既有约定（已核查，照此执行）

### mobile（apps/mobile）

| 项            | 取值                                                                                                                                                                                                                                               | 出处                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 包名          | `cms_mobile`（import 前缀 `package:cms_mobile/`）                                                                                                                                                                                                  | pubspec.yaml                                                            |
| 状态管理      | `flutter_riverpod ^3.4.3`；Provider 装配集中在 `lib/app_providers.dart`，main.dart 仅 override                                                                                                                                                     | app_providers.dart                                                      |
| 网络          | `dio ^5.11.1`；`buildDio` 唯一构造入口；`dioCall` 唯一调用边界（支持可选 `CancelToken`，取消归一 `AppError(code:-1)`）；业务只 catch `AppError`                                                                                                    | core/network/dio_client.dart                                            |
| 错误模型      | `AppError{code,message,logID?}`；形态错误文案 `kMalformedEnvelopeMessage`                                                                                                                                                                          | core/error/app_error.dart、envelope_interceptor.dart                    |
| 日志          | `AppLogger` 抽象 + `ConsoleLogger`；禁 print/debugPrint（test 除外）                                                                                                                                                                               | core/logging/                                                           |
| 埋点          | `EventTracker{pageView,track}`；Console/Sentry 双实现经 `buildEventTracker(config)`                                                                                                                                                                | core/analytics/                                                         |
| 配置          | `AppConfig.fromDartDefines()` 唯一读取口；新增 dart-define 需同步 AGENTS.md §4 表与 README.md 配置坑清单                                                                                                                                           | core/config/app_config.dart、AGENTS.md §4                               |
| JSB           | `JSBRegistry`（register/registerAll/dispatch/handleRawCall，失败信封 `{code,error:{code,message}}`）；handler 纯闭包注入可单测；方法组文件 `jsb_methods/<组>.dart` 导出 `xxxJSBMethodNames` + `buildXxxHandlers(deps)`                             | core/hybrid/jsb_registry.dart、jsb_methods/*.dart                       |
| JSB 错误码    | native 侧常量：`NATIVE_ERROR/METHOD_NOT_FOUND/BAD_PARAMS/CANCELLED`（数字码 1000–1003）；**未识别的字符串码数字兜底 1000 且 error.code 字符串原样透传**（js 侧归一为 NATIVE_ERROR + nativeCode，protocol.ts 注释「含未识别的 native error.code」） | jsb_registry.dart `_numericCodeFor`、packages/js-bridge/src/protocol.ts |
| webview 装配  | `buildWebViewJSBRegistry({device, ui, page})` 在 `features/webview/webview_jsb_registry.dart`；deps 在 `webview_page.dart` initState 用 `ref.read(...)` 构建                                                                                       | features/webview/                                                       |
| core 依赖方向 | core 模块互不依赖，例外须先在 AGENTS.md §2 登记再写代码（已登记：config 人人可用、error、network→logging、lifecycle→analytics/logging）                                                                                                            | AGENTS.md §2                                                            |
| 测试          | flutter_test；单测 `test/unit/`（纯 Dart，fake 闭包注入）、widget `test/widget/`（经 test/helpers/pump_app.dart 范式 ProviderScope+MaterialApp 包装）；本机无 Flutter SDK，验证待环境                                                              | test/                                                                   |
| 单文件        | ≤300 行，超出拆分；页面主入口只做数据编排                                                                                                                                                                                                          | 根 AGENTS 规则 10                                                       |
| 依赖纪律      | pubspec.yaml 单点、`^x.y.z`、新增依赖一次钉定 + 评审；pubspec.lock 不入库                                                                                                                                                                          | AGENTS.md §7                                                            |

### server（apps/server）与契约

| 项          | 取值                                                                                                                                                                                                     | 出处                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 契约        | `openapi/app/` 多文件骨架：`openapi.yaml` 入口 + `paths/*.yaml` + `components/schemas/*.yaml`；路径字面带 `/api/app` 前缀；公开受众 `security: []`；响应 schema 只描述 data 载荷                         | openapi/app/                                     |
| 生成链      | `redocly bundle openapi/app/openapi.yaml -o .gen-bundle/app.yaml && oapi-codegen -config oapi.app.cfg.yaml`（package app、models+std-http-server）；根 `pnpm gen:api`                                    | apps/server/package.json                         |
| app handler | `internal/handler/app/`：一个资源一个文件；`AppHandler` struct + `var _ appgen.ServerInterface = (*AppHandler)(nil)`；公开链复用 baseChain，无鉴权                                                       | handler/app/app.go、main.go                      |
| 响应写出    | 只走 `httpapi.WriteJSON(w, status, body)` / `httpapi.WriteError(w, status, message)`；ping 同款 `Cache-Control: no-store`                                                                                | internal/httpapi/respond.go、handler/app/ping.go |
| 配置        | `internal/config/config.go` 唯一 env 读取口（`envOr/envInt/envBool`，`.env.local/.env` 补缺失）；config 为叶子包，service **禁止 import config**（依赖矩阵），main.go 负责把 cfg 映射成 service 构造参数 | AGENTS.md §1 矩阵、config.go                     |
| service     | 厚 service 薄 handler；GET 查询**不埋 oplog**（§5）；本卡无 repo（env 驱动无 DB）                                                                                                                        | AGENTS.md §5                                     |
| 测试        | handler 测试经 `appgen.HandlerFromMux` 起完整 mux + httptest；service 纯函数直接表驱动单测；六类边界必查                                                                                                 | handler/app/ping_test.go、AGENTS.md §7           |
| 生成物      | `gen/**`、`.gen-bundle/**` 禁止手改                                                                                                                                                                      | AGENTS.md §8                                     |

---

## 4. 阶段 6：mobile 权限 + 媒体 + JSB 媒体方法（apps/mobile，agent A）

### 4.0 pubspec.yaml 改动（两阶段全部依赖，本节为阶段 6 部分）

**以下版本号均为「钉版本待评审」**：按 AGENTS.md §7，执行者原样落版本，评审环节统一确认，不得自行升/降。

阶段 6 追加 8 个依赖（字母序插入，除追加行外不动任何既有行）：

```yaml
dependencies:
  cached_network_image: ^3.4.1 # 钉版本待评审;插在 connectivity_plus 之前
  connectivity_plus: ^6.1.4 # 既有,不动
  dio: ^5.11.1 # 既有,不动
  file_picker: ^10.3.3 # 钉版本待评审;插在 dio 与 flutter 之间
  flutter: # 既有,不动
    sdk: flutter
  flutter_image_compress: ^2.4.0 # 钉版本待评审;插在 flutter 与 flutter_inappwebview 之间
  flutter_inappwebview: ^6.1.5 # 既有,不动
  flutter_localizations: # 既有,不动
    sdk: flutter
  flutter_riverpod: ^3.4.3 # 既有,不动
  gal: ^2.3.2 # 钉版本待评审;插在 flutter_riverpod 与 go_router 之间
  go_router: ^18.0.1 # 既有,不动
  image_picker: ^1.2.1 # 钉版本待评审;插在 go_router 与 intl 之间
  intl: ^0.20.3 # 既有,不动
  just_audio: ^0.10.5 # 钉版本待评审;插在 intl 之后
  permission_handler: ^12.0.1 # 钉版本待评审;插在 just_audio 与 sentry_flutter 之间
  sentry_flutter: ^9.30.0 # 既有,不动
  shared_preferences: ^2.5.5 # 既有,不动
  video_player: ^2.10.0 # 钉版本待评审;追加在 shared_preferences 之后
```

> **对总计划 §4/决策 9 的两处扩充（本方案拍板，评审时确认）**：
>
> 1. `gal`——决策 9 插件清单未含「保存图片到相册」能力，而 JSB `saveImageToAlbum` 必须落相册；选 `gal`（维护活跃、iOS/Android 行为一致），替代老旧的 `image_gallery_saver`。
> 2. `media_saver_service.dart` / `image_info_service.dart`——总计划 §4 树只列六件媒体文件；`saveImageToAlbum` 与 `getImageInfo` 的插件薄壳单独成文件（守住单文件 ≤300 行与一职责一文件）。

### 4.1 卡 6.1：core/permission

#### 4.1.1 `lib/core/permission/permission_service.dart`（纯抽象，零第三方 import）

逐字实现以下 API：

```dart
/// 统一权限抽象(决策 10):懒请求 + 状态机;业务调用前 check,拒绝降级不阻断主流程。
/// 本文件零第三方依赖;permission_handler 桥接在 permission_handler_service.dart。

/// 七类权限(决策 10,枚举值即对外契约,顺序固定)。
enum AppPermission { camera, photo, location, notification, microphone, bluetooth, contacts }

/// 权限五态状态机。
/// granted=已授权;denied=未授权(可再请求);limited=iOS 限定授权(如限定相册,按可用处理);
/// permanentlyDenied=永久拒绝(只能引导去设置);restricted=系统级限制(iOS 家长控制等,不可请求)。
enum PermissionAppState { granted, denied, limited, permanentlyDenied, restricted }

/// 状态可用性判定(纯函数):granted/limited 视为可用,其余不可用。
bool isPermissionUsable(PermissionAppState state) =>
    state == PermissionAppState.granted || state == PermissionAppState.limited;

/// 平台通道桥接抽象:生产实现桥 permission_handler,单测注入 fake。
/// (与 network_status.dart 的 NetworkStatusSource 同范式:插件薄壳不进单测。)
abstract interface class PermissionGateway {
  Future<PermissionAppState> status(AppPermission permission);
  Future<PermissionAppState> request(AppPermission permission);
  Future<bool> openSettings();
}

/// 权限服务:业务唯一入口。
abstract interface class PermissionService {
  /// 查询当前状态(不触发系统弹窗)。
  Future<PermissionAppState> check(AppPermission permission);

  /// 发起系统授权请求;已是 granted/limited 直接返回;permanentlyDenied/restricted
  /// 不再触发系统弹窗,直接返回当前状态(请求语义由调用方结合说明弹窗编排)。
  Future<PermissionAppState> request(AppPermission permission);

  /// 跳系统设置页;返回是否成功打开。
  Future<bool> openSettings();
}
```

#### 4.1.2 `lib/core/permission/permission_handler_service.dart`（实现）

```dart
import 'package:permission_handler/permission_handler.dart' as ph;

import 'permission_service.dart';

/// permission_handler 状态 → 五态映射(纯函数,单测直测):
/// granted→granted;denied→denied;limited→limited;permanentlyDenied→permanentlyDenied;
/// restricted→restricted;provisional→granted(iOS 临时通知授权按可用处理)。
PermissionAppState mapPermissionHandlerStatus(ph.PermissionStatus status) { /* switch 全分支覆盖,default 兜底 denied */ }

/// AppPermission → permission_handler.Permission 映射(纯函数):
/// camera→Permission.camera;photo→Permission.photos;location→Permission.locationWhenInUse;
/// notification→Permission.notification;microphone→Permission.microphone;
/// bluetooth→Permission.bluetooth;contacts→Permission.contacts。
ph.Permission toPlatformPermission(AppPermission permission) { /* switch 全分支覆盖 */ }

/// permission_handler 桥接(插件薄壳,单测不触)。
class PermissionHandlerGateway implements PermissionGateway {
  const PermissionHandlerGateway();
  // status/request 经 toPlatformPermission + mapPermissionHandlerStatus 转换;
  // openSettings → ph.openAppSettings()。
}

/// PermissionService 生产实现:薄壳转发 gateway,无业务逻辑(编排语义在调用方/JSB 层)。
class PermissionHandlerPermissionService implements PermissionService {
  const PermissionHandlerPermissionService({PermissionGateway gateway = const PermissionHandlerGateway()})
      : _gateway = gateway;
  final PermissionGateway _gateway;
  // check/request/openSettings 逐一转发。
}
```

要点：

- `mapPermissionHandlerStatus` / `toPlatformPermission` 必须是**全覆盖 switch**（编译器穷举校验），mapping 单测在 Dart VM 上可跑（`permission_handler` 的枚举类型不触平台通道）。
- service 实现不吞异常：gateway 抛错原样上抛（调用方按降级策略处理），薄壳不做重试。

#### 4.1.3 `lib/core/permission/permission_rationale.dart`（中文说明弹窗）

```dart
import 'package:flutter/material.dart';

import 'permission_service.dart';

/// 每类权限的中文文案(决策 10/12,只出中文;即对外契约,改文案需评审)。
class PermissionCopy {
  const PermissionCopy({required this.name, required this.rationale, required this.settingsHint});
  /// 权限名(如「相机」)。
  final String name;
  /// 首次说明:为什么需要(首次拒绝后再次请求前展示)。
  final String rationale;
  /// 永久拒绝引导:去设置开启。
  final String settingsHint;
}

/// 七类权限文案表(全量,key 与 AppPermission 一一对应,缺 key 是装配错误)。
const Map<AppPermission, PermissionCopy> kPermissionCopyTable = {
  AppPermission.camera: PermissionCopy(
    name: '相机',
    rationale: '需要使用相机拍摄照片,用于扫码、拍照上传等功能。',
    settingsHint: '相机权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.photo: PermissionCopy(
    name: '相册',
    rationale: '需要访问相册选择或保存图片。',
    settingsHint: '相册权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.location: PermissionCopy(
    name: '位置',
    rationale: '需要获取当前位置,用于附近内容与本地化服务。',
    settingsHint: '位置权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.notification: PermissionCopy(
    name: '通知',
    rationale: '需要通知权限,用于接收重要消息提醒。',
    settingsHint: '通知权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.microphone: PermissionCopy(
    name: '麦克风',
    rationale: '需要使用麦克风录制音频。',
    settingsHint: '麦克风权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.bluetooth: PermissionCopy(
    name: '蓝牙',
    rationale: '需要使用蓝牙连接附近设备。',
    settingsHint: '蓝牙权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.contacts: PermissionCopy(
    name: '通讯录',
    rationale: '需要访问通讯录,用于好友邀请等功能。',
    settingsHint: '通讯录权限已被关闭,请在系统设置中开启后再试。',
  ),
};

/// 说明/引导弹窗:permanentlyDenied=false 展示 rationale(「取消/知道了」),
/// permanentlyDenied=true 展示 settingsHint(「取消/去设置」)。
/// 返回 true = 用户点了「去设置」;false/null = 取消或知道了。
Future<bool?> showPermissionRationaleDialog(
  BuildContext context, {
  required AppPermission permission,
  required bool permanentlyDenied,
}) { /* AlertDialog;按钮文案:取消 / 知道了(非永久) / 去设置(永久) */ }
```

弹窗按钮文案锁定：`取消` / `知道了` / `去设置`。文案表即 widget 测试断言依据。

#### 4.1.4 卡 6.1 测试用例表

`test/unit/permission_map_test.dart`（P 系列）与 `test/unit/permission_service_test.dart`（PS 系列）：

| 编号                                                       | 用例                                                                                    | 边界类别                 | 断言                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| P1                                                         | `toPlatformPermission` 七类全覆盖                                                       | 越界（枚举完整性）       | 七个枚举各自映射到预期 `ph.Permission`；switch 无 default（编译期穷举） |
| P2                                                         | `mapPermissionHandlerStatus` 六状态全覆盖（含 provisional→granted）                     | 非法状态迁移             | 每个 `ph.PermissionStatus` 映射到预期五态                               |
| P3                                                         | `isPermissionUsable`                                                                    | 零值                     | granted/limited→true；denied/permanentlyDenied/restricted→false         |
| PS1                                                        | fake gateway granted → check/request 透传                                               | 正常                     | 返回值与 fake 一致                                                      |
| PS2                                                        | fake gateway permanentlyDenied → request 不触发系统请求语义（service 直通，编排在上层） | 权限缺失                 | 返回 permanentlyDenied                                                  |
| PS3                                                        | fake gateway 抛异常 → 原样上抛不吞                                                      | 网络失败（通道失败同构） | `throwsA` 同一异常                                                      |
| PS4                                                        | `openSettings` 透传 bool                                                                | 正常                     | true/false 原样返回                                                     |
| W1（widget，`test/widget/permission_rationale_test.dart`） | permanentlyDenied=false 渲染 rationale 文案 + 「知道了」                                | 空值（文案兜底）         | 文案与 kPermissionCopyTable 逐字一致                                    |
| W2                                                         | permanentlyDenied=true 渲染 settingsHint + 「去设置」，点击返回 true                    | 权限缺失                 | pop 结果为 true                                                         |
| W3                                                         | 点「取消」返回 false                                                                    | 用户取消                 | pop 结果为 false                                                        |

（widget 测试待 Flutter 环境执行；纯函数与 service 单测同批交付。）

### 4.2 卡 6.2：core/media（六能力 + 两个扩充文件）

通用约定：

- 每个文件 = 抽象接口 + 插件薄壳实现 + 纯逻辑函数（纯逻辑全部可 Dart VM 单测，薄壳不进单测）。
- 用户取消一律返回 `null`（选图/选文件），不抛异常；插件调用失败原样上抛。
- 业务层只 import `core/media/*` 抽象，插件 import 只允许出现在薄壳文件内（与 sentry/shared_preferences 实现同范式，无需 AGENTS 例外登记）。

#### 4.2.1 `lib/core/media/media_picker_service.dart`（image_picker）

```dart
/// 选图结果(薄壳返回;path 为插件临时文件路径,sizeBytes 读取文件长度,width/height 可为 null)。
typedef PickedImage = ({String path, int? width, int? height, int sizeBytes});

/// 选图参数(纯函数 resolvePickParams 的输入)。
abstract interface class MediaPickerService {
  /// 相册选一张;用户取消返回 null。
  Future<PickedImage?> pickFromGallery({int? maxDim, int? quality});
  /// 相机拍一张;用户取消返回 null。
  Future<PickedImage?> pickFromCamera({int? maxDim, int? quality});
}

/// 选图参数归一(纯函数):maxDim 缺省 2048、clamp [1,4096];quality 缺省 80、clamp [1,100]。
({int maxDim, int quality}) resolvePickParams({int? maxDim, int? quality});

class ImagePickerMediaPickerService implements MediaPickerService {
  // 薄壳:image_picker ImagePicker 可注入(构造参数),pickImage(imageQuality/maxWidth/maxHeight 换算:
  // maxWidth=maxHeight=maxDim.toDouble());取消(pickImage 返回 null)→ 返回 null;
  // sizeBytes 经 File(path).length();width/height 本类不读(交给 ImageInfoService),置 null。
}
```

常量：`const int kDefaultPickMaxDim = 2048; const int kMaxPickDim = 4096; const int kDefaultPickQuality = 80;`

#### 4.2.2 `lib/core/media/image_compress_service.dart`（flutter_image_compress）

```dart
abstract interface class ImageCompressService {
  /// 压缩 [sourcePath] 到同目录新文件(命名 <原名>_compressed.jpg),返回新路径;
  /// 源文件已小于 skipBelowBytes 时直接返回原路径(纯函数决策,见下)。
  Future<String> compress(String sourcePath, {int? maxDim, int? quality});
}

/// 是否跳过压缩(纯函数):体积 ≤ skipBelowBytes 跳过(缺省阈值 200*1024)。
bool shouldSkipCompress({required int sizeBytes, int skipBelowBytes = 200 * 1024});

class FlutterImageCompressService implements ImageCompressService {
  // 薄壳:FlutterImageCompress.compressAndGetFile(minWidth/minHeight=maxDim, quality);
  // 插件返回 null(失败)→ 抛 StateError('image compress failed')(调用方/JSB 层兜底归一)。
}
```

#### 4.2.3 `lib/core/media/cached_image.dart`（cached_network_image 封装组件）

```dart
/// 通用缓存网络图:加载进度 + 失败占位;业务不直接 import cached_network_image。
class CachedAppImage extends StatelessWidget {
  const CachedAppImage({super.key, required this.url, this.width, this.height, this.fit = BoxFit.cover, this.memCacheWidth});
  final String url; final double? width; final double? height; final BoxFit fit; final int? memCacheWidth;
  // build:CachedNetworkImage(imageUrl: url, …, placeholder: Center(CircularProgressIndicator),
  //   errorWidget: ColoredBox + Icon(Icons.broken_image_outlined))。
  // 纯函数:bool isLoadableImageUrl(String? url) → 非空且 http/https 前缀(空/非法渲染 errorWidget 分支,不发起请求)。
}
```

#### 4.2.4 `lib/core/media/file_service.dart`（file_picker）

```dart
/// 文件白名单判定(纯函数):
/// allowedExtensions 为 null/空 = 不限类型(只校大小);扩展名比较统一小写、不带点;
/// maxSizeBytes ≤0 = 不限大小;超过返回 false。
bool isFileAllowed({required String fileName, required int sizeBytes, List<String>? allowedExtensions, int maxSizeBytes = 0});

/// 提取小写扩展名(纯函数):'a.PNG'→'png';无扩展名/以点结尾 → 空串。
String fileExtensionOf(String fileName);

typedef PickedFileInfo = ({String path, String name, int sizeBytes});

abstract interface class FileService {
  /// 选单个文件;白名单外类型/超限大小 → 抛 ArgumentError(中文文案);用户取消 → null。
  Future<PickedFileInfo?> pick({List<String>? allowedExtensions, int maxSizeBytes = 0});
}
class FilePickerFileService implements FileService { /* 薄壳:FilePicker.platform.pickFiles(type/allowedExtensions 换算) */ }
```

中文错误文案锁定：类型不允许 → `'不支持的文件类型'`；超大小 → `'文件超过大小限制'`。

#### 4.2.5 `lib/core/media/video_service.dart`（video_player 薄壳）

```dart
/// 视频播放薄壳:包装 VideoPlayerController 生命周期(initialize/play/pause/seekTo/dispose);
/// 不抽纯逻辑(播放器无决策逻辑),业务面向本类,不直接 import video_player。
class AppVideoPlayer {
  AppVideoPlayer.network(String url);   // 构造 VideoPlayerController.networkUrl(Uri.parse(url))
  Future<void> initialize();
  Future<void> play(); Future<void> pause();
  Future<void> seekTo(Duration position);
  Duration get position; bool get isPlaying; bool get isInitialized;
  Future<void> dispose();
}
```

#### 4.2.6 `lib/core/media/audio_service.dart`（just_audio 薄壳）

```dart
/// 音频播放薄壳:包装 just_audio AudioPlayer(setUrl/play/pause/seek/dispose + playing 状态流)。
class AppAudioPlayer {
  AppAudioPlayer();
  Future<void> setUrl(String url);
  Future<void> play(); Future<void> pause();
  Future<void> seek(Duration position);
  Stream<bool> get playingStream; bool get isPlaying;
  Future<void> dispose();
}
```

#### 4.2.7 `lib/core/media/media_saver_service.dart`（gal）

```dart
abstract interface class MediaSaverService {
  /// 把 [path] 图片存入系统相册;失败抛异常(由调用方兜底)。
  Future<void> saveImageToAlbum(String path);
}
class GalMediaSaverService implements MediaSaverService { /* 薄壳:Gal.putImage(path) */ }
```

#### 4.2.8 `lib/core/media/image_info_service.dart`（dart:ui 解码薄壳）

```dart
/// 图片类型推断(纯函数):按扩展名 → 'jpeg'/'png'/'gif'/'webp'/'heic';jpg→jpeg;未知 → 'unknown'。
String resolveImageType(String path);

abstract interface class ImageInfoService {
  /// 读取图片尺寸与大小;文件不存在/解码失败抛异常。
  Future<PickedImage> read(String path);   // 复用 media_picker_service.dart 的 PickedImage record
}
class UiImageInfoService implements ImageInfoService {
  // 薄壳:File.readAsBytes → dart:ui instantiateImageCodec → width/height;sizeBytes=字节长度。
}
```

#### 4.2.9 卡 6.2 测试用例表（`test/unit/media_logic_test.dart`，M 系列，全部纯 Dart）

| 编号 | 用例                                                                                  | 边界类别                 | 断言                                            |
| ---- | ------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| M1   | `resolvePickParams` 全 null → 默认 (2048, 80)                                         | 空值/零值                | 默认值                                          |
| M2   | `resolvePickParams` maxDim=0/-5/99999 → clamp 到 [1,4096]；quality 同理 clamp [1,100] | 越界                     | clamp 结果                                      |
| M3   | `shouldSkipCompress` 恰好等于阈值 / 阈值-1 / 阈值+1                                   | 越界                     | ≤ 阈值为 true                                   |
| M4   | `isFileAllowed` allowedExtensions=null 且 maxSizeBytes=0 → 恒 true                    | 空值/零值                | true                                            |
| M5   | `isFileAllowed` 扩展名大小写混合 `'A.PNG'` vs `['png']` → true；不在白名单 → false    | 正常/越界                | 大小写不敏感                                    |
| M6   | `isFileAllowed` sizeBytes 恰好等于上限 → true；上限+1 → false                         | 越界                     | 边界含等于                                      |
| M7   | `fileExtensionOf` 无扩展名/以点结尾/多点文件名                                        | 空值                     | `''` / `''` / `'gz'`（取最后一段）              |
| M8   | `resolveImageType` jpg→jpeg、PNG→png、未知扩展名→unknown、无扩展名→unknown            | 空值/越界                | 映射表                                          |
| M9   | `isLoadableImageUrl` null/空串/非 http(s)/大写 scheme                                 | 空值/越界                | false/false/false/true                          |
| M10  | `FilePickerFileService.pick` 白名单拒绝文案                                           | 权限缺失同构（输入拒绝） | ArgumentError message 逐字 `'不支持的文件类型'` |

### 4.3 卡 6.3：core/hybrid/jsb_methods/media.dart

#### 4.3.1 错误语义（与 packages/js-bridge 协议对齐，协议不改）

- 用户取消（picker 返回 null）→ `JSBException(kJSBErrCancelled, '用户已取消')`（CANCELLED 是协议预留码，数字码 1003）。
- 权限拒绝/永久拒绝/系统限制 → `JSBException('PERMISSION_DENIED', <中文文案>)`。`PERMISSION_DENIED` 不在 registry 数字码表内 → 数字码兜底 1000，`error.code` 字符串原样透传；js 侧归一为 `NATIVE_ERROR` 且 `nativeCode='PERMISSION_DENIED'`（protocol.ts 既定语义，**不需要改 packages/js-bridge**）。本文件新增常量：
  `const String kJSBErrPermissionDenied = 'PERMISSION_DENIED';`
- 参数非法 → `JSBException(kJSBErrBadParams, …)`（沿用既有风格，英文技术文案）；读取/保存失败 → 让异常穿透，由 registry 兜底 NATIVE_ERROR。

#### 4.3.2 文件骨架（逐字实现签名）

```dart
// lib/core/hybrid/jsb_methods/media.dart
import 'dart:convert';

import 'package:cms_mobile/core/permission/permission_service.dart';

import '../jsb_registry.dart';

const List<String> mediaJSBMethodNames = <String>['chooseImage', 'takePhoto', 'saveImageToAlbum', 'getImageInfo'];

const String kJSBErrPermissionDenied = 'PERMISSION_DENIED';

/// dataUrl 内联上限:压缩后 sizeBytes 超过 1MB 不再内联(信封体积护栏,决策见 §4.3.4)。
const int kMaxInlineDataUrlBytes = 1024 * 1024;

/// 选图/拍图参数边界(与 core/media 默认值对齐)。
const int kJSBDefaultMaxDim = 2048;
const int kJSBMaxPickDim = 4096;
const int kJSBDefaultQuality = 80;

/// media 组依赖:全部闭包注入,纯 Dart 可测;实现由 webview 容器页装配(§4.4)。
class JSBMediaDependencies {
  const JSBMediaDependencies({
    required this.ensurePermission,
    required this.showPermissionDeniedHint,
    required this.pickFromGallery,
    required this.pickFromCamera,
    required this.saveToAlbum,
    required this.readImageInfo,
    required this.readFileBytes,
  });

  /// check→(denied 时)request 后的最终权限状态(编排闭包,实现方一次完成)。
  final Future<PermissionAppState> Function(AppPermission permission) ensurePermission;

  /// 拒绝提示:容器页弹 PermissionRationaleDialog(permanentlyDenied 决定文案与按钮)。
  final void Function(AppPermission permission, {required bool permanentlyDenied}) showPermissionDeniedHint;

  /// 选图/拍照(已含压缩管线);用户取消返回 null。
  final Future<JSBPickedImage?> Function({required int maxDim, required int quality}) pickFromGallery;
  final Future<JSBPickedImage?> Function({required int maxDim, required int quality}) pickFromCamera;

  /// 保存到相册;失败抛异常。
  final Future<void> Function(String path) saveToAlbum;

  /// 读取图片信息;文件不存在/解码失败抛异常。
  final Future<JSBPickedImage> Function(String path) readImageInfo;

  /// 读文件字节(dataUrl 内联用);失败抛异常。
  final Future<List<int>> Function(String path) readFileBytes;
}

/// 单张图片的 JSB 侧投影(与 core/media PickedImage 同构,避免 hybrid → media 的类型耦合面扩大;
/// 装配层一行记录转换)。
typedef JSBPickedImage = ({String path, int? width, int? height, int sizeBytes});
```

#### 4.3.3 参数 schema 与返回结构（锁定，即对外契约）

| method             | params（全部可选除非标必填）                                                               | 校验失败   | 成功 data（键固定）                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `chooseImage`      | `maxDim:int(1..4096,缺省2048)`、`quality:int(1..100,缺省80)`、`withBase64:bool(缺省false)` | BAD_PARAMS | `{tempPath:String, sizeBytes:int, width?:int, height?:int, dataUrl?:String}`                                                       |
| `takePhoto`        | 同 chooseImage                                                                             | BAD_PARAMS | 同 chooseImage                                                                                                                     |
| `getImageInfo`     | `tempPath:String`（**必填**非空）                                                          | BAD_PARAMS | `{width:int, height:int, type:String, sizeBytes:int}`（width/height 由 readImageInfo 保证非 null，为 null 时抛 NATIVE_ERROR 兜底） |
| `saveImageToAlbum` | `tempPath:String`（**必填**非空）                                                          | BAD_PARAMS | 无 data（`{code:0}`）                                                                                                              |

- `dataUrl` 仅当 `withBase64==true` 且压缩后 `sizeBytes <= kMaxInlineDataUrlBytes` 时内联，形态 `data:image/<resolveImageType(path)>;base64,<...>`；超限静默省略该键（**锁定的体积决策**，见 §4.3.4）。
- `width`/`height` 为 null 时**键省略**（H5 侧可选链读取；chooseImage/takePhoto 的薄壳不保证读到尺寸）。
- 权限前置：`chooseImage`/`saveImageToAlbum` → `AppPermission.photo`；`takePhoto` → `AppPermission.camera`；`getImageInfo` 不需要权限。
- 权限编排（handler 内统一）：`state = await ensurePermission(p)`；`isPermissionUsable(state)` → 继续；`state == permanentlyDenied || state == restricted` → `showPermissionDeniedHint(p, permanentlyDenied: true)` + 抛 `JSBException(kJSBErrPermissionDenied, '<名>权限已被关闭,请在系统设置中开启后再试。')`（即 settingsHint 文案）；其余（仍 denied）→ `showPermissionDeniedHint(p, permanentlyDenied: false)` + 抛 `JSBException(kJSBErrPermissionDenied, '未获得<权限名>权限,已取消本次操作。')`。

#### 4.3.4 handler 骨架

```dart
Map<String, JSBHandler> buildMediaHandlers(JSBMediaDependencies deps) {
  // 公共小函数(文件内私有):
  // ({int maxDim,int quality,bool withBase64}) parsePickParams(Map params) —— 类型错/越界抛 BAD_PARAMS;
  //    (数字只接受 int;bool 只接受 bool;其余类型一律 BAD_PARAMS)
  // Future<Map<String,dynamic>> pickedResult(JSBPickedImage picked, {required bool withBase64}) ——
  //    拼返回 Map;withBase64 且 sizeBytes<=kMaxInlineDataUrlBytes 时 readFileBytes+base64Encode 内联 dataUrl。
  // Future<void> ensureUsable(AppPermission p) —— §4.3.3 权限编排。
  return <String, JSBHandler>{
    'chooseImage': (params) async { ensureUsable(photo) → pickFromGallery → null=CANCELLED → pickedResult },
    'takePhoto': (params) async { ensureUsable(camera) → pickFromCamera → 同上 },
    'getImageInfo': (params) async { 校验 tempPath → readImageInfo → {width,height,type,sizeBytes} },
    'saveImageToAlbum': (params) async { 校验 tempPath → ensureUsable(photo) → saveToAlbum → return null },
  };
}
```

#### 4.3.5 卡 6.3 测试用例表（`test/unit/jsb_methods_media_test.dart`，MM 系列，fake 闭包注入纯 Dart）

| 编号 | 用例                                                                                                              | 边界类别                 | 断言                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| MM1  | method 名清单与 buildMediaHandlers 键集一致                                                                       | 越界（完整性）           | 与 mediaJSBMethodNames 相等（照抄 D4 范式）                             |
| MM2  | chooseImage 正常：granted + fake 选图 → 返回 {tempPath,sizeBytes}，无 dataUrl（withBase64 缺省 false）            | 正常                     | Map 逐键相等；width/height 为 null 时键不存在                           |
| MM3  | chooseImage maxDim=0/5000/'abc'、quality=-1/'x'、withBase64='yes' → BAD_PARAMS                                    | 空值/越界                | JSBException code=BAD_PARAMS                                            |
| MM4  | chooseImage fake 返回 null → CANCELLED '用户已取消'                                                               | 用户取消                 | code=CANCELLED、message 逐字                                            |
| MM5  | chooseImage denied（request 后仍 denied）→ PERMISSION_DENIED + hint(permanentlyDenied:false) 被调 1 次            | 权限缺失                 | code 字符串 'PERMISSION_DENIED'、文案 '未获得相册权限,已取消本次操作。' |
| MM6  | takePhoto permanentlyDenied → PERMISSION_DENIED + hint(permanentlyDenied:true) + settingsHint 文案；pick 未被调用 | 权限缺失                 | 相机文案逐字；fake pick 调用数 0                                        |
| MM7  | takePhoto restricted → 按永久拒绝分支（hint true）                                                                | 非法状态迁移             | 同 MM6 分支                                                             |
| MM8  | limited 视为可用 → 正常走完选图                                                                                   | 非法状态迁移             | 成功返回                                                                |
| MM9  | withBase64=true 且 sizeBytes≤1MB → dataUrl=`data:image/jpeg;base64,…`；>1MB → 无 dataUrl 键                       | 越界                     | 恰好 1MB 内联、1MB+1 省略                                               |
| MM10 | getImageInfo tempPath 缺失/空串/非字符串 → BAD_PARAMS                                                             | 空值                     | BAD_PARAMS                                                              |
| MM11 | getImageInfo fake 返回 width=null → 穿透抛错（registry 兜底 NATIVE_ERROR，handler 不兜底）                        | 非法状态迁移             | throwsA（非 JSBException 也可）                                         |
| MM12 | saveImageToAlbum 正常 → 返回 null（信封 {code:0}）；权限 denied → PERMISSION_DENIED 且 save 未调                  | 权限缺失                 | fake save 调用数 0                                                      |
| MM13 | ensurePermission fake 抛异常 → 原样穿透                                                                           | 网络失败同构（通道失败） | throwsA 同一异常                                                        |
| MM14 | registry 集成：dispatch('chooseImage') 未注册拼写 'chooseimage' → METHOD_NOT_FOUND（护栏）                        | 越界                     | 数字码 1001                                                             |

### 4.4 装配 diff（逐字落）

`lib/features/webview/webview_jsb_registry.dart`：

```diff
 import 'package:cms_mobile/core/hybrid/jsb_methods/device.dart';
+import 'package:cms_mobile/core/hybrid/jsb_methods/media.dart';
 import 'package:cms_mobile/core/hybrid/jsb_methods/page.dart';
 import 'package:cms_mobile/core/hybrid/jsb_methods/ui.dart';
 import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
@@
 JSBRegistry buildWebViewJSBRegistry({
   required JSBDeviceDependencies device,
   required JSBUIDependencies ui,
   required JSBPageDependencies page,
+  required JSBMediaDependencies media,
 }) {
   return JSBRegistry()
     ..registerAll(buildDeviceHandlers(device))
     ..registerAll(buildUIHandlers(ui))
-    ..registerAll(buildPageHandlers(page));
+    ..registerAll(buildPageHandlers(page))
+    ..registerAll(buildMediaHandlers(media));
 }
```

`lib/features/webview/webview_page.dart`（initState 内 `_registry = buildWebViewJSBRegistry(...)` 追加 media 实参；**保持 phase 2 装配范式：handlers 在容器页读 Provider 构建**）：

```diff
+import 'package:cms_mobile/core/hybrid/jsb_methods/media.dart';
+import 'package:cms_mobile/core/media/image_info_service.dart';
+import 'package:cms_mobile/core/permission/permission_rationale.dart';
+import 'package:cms_mobile/core/permission/permission_service.dart';
@@
       page: JSBPageDependencies( … 不变 … ),
+      media: JSBMediaDependencies(
+        ensurePermission: (permission) async {
+          final svc = ref.read(permissionServiceProvider);
+          var state = await svc.check(permission);
+          if (state == PermissionAppState.denied) {
+            state = await svc.request(permission);
+          }
+          return state;
+        },
+        showPermissionDeniedHint: (permission, {required permanentlyDenied}) {
+          if (!mounted) return;
+          showPermissionRationaleDialog(
+            context,
+            permission: permission,
+            permanentlyDenied: permanentlyDenied,
+          );
+        },
+        pickFromGallery: ({required maxDim, required quality}) =>
+            _pickAndCompress((s) => s.pickFromGallery(maxDim: maxDim, quality: quality)),
+        pickFromCamera: ({required maxDim, required quality}) =>
+            _pickAndCompress((s) => s.pickFromCamera(maxDim: maxDim, quality: quality)),
+        saveToAlbum: (path) => ref.read(mediaSaverServiceProvider).saveImageToAlbum(path),
+        readImageInfo: (path) async {
+          final info = await ref.read(imageInfoServiceProvider).read(path);
+          return (path: info.path, width: info.width, height: info.height, sizeBytes: info.sizeBytes);
+        },
+        readFileBytes: (path) => File(path).readAsBytes(),
+      ),
```

并在 `_WebViewPageState` 内新增私有方法（选图+压缩+尺寸管线编排；dart:io `File` 只在 features 层使用）：

```dart
/// 选图管线:pick → 压缩(小文件自动跳过,见 shouldSkipCompress) → 读尺寸;取消返回 null。
Future<JSBPickedImage?> _pickAndCompress(
  Future<PickedImage?> Function(MediaPickerService) pick,
) async {
  final picker = ref.read(mediaPickerServiceProvider);
  final picked = await pick(picker);
  if (picked == null) return null;
  final compressed = await ref.read(imageCompressServiceProvider).compress(picked.path);
  final info = await ref.read(imageInfoServiceProvider).read(compressed);
  return (path: info.path, width: info.width, height: info.height, sizeBytes: info.sizeBytes);
}
```

`lib/app_providers.dart` 追加（放在既有 Provider 之后，注释风格沿用）：

```dart
/// 权限服务(卡 6.1):permission_handler 薄壳;测试经 override 注入 fake gateway 的 service。
final permissionServiceProvider = Provider<PermissionService>(
  (ref) => const PermissionHandlerPermissionService(),
);

/// 选图(卡 6.2)。
final mediaPickerServiceProvider = Provider<MediaPickerService>(
  (ref) => ImagePickerMediaPickerService(),
);

/// 图片压缩(卡 6.2)。
final imageCompressServiceProvider = Provider<ImageCompressService>(
  (ref) => FlutterImageCompressService(),
);

/// 相册保存(卡 6.2)。
final mediaSaverServiceProvider = Provider<MediaSaverService>(
  (ref) => const GalMediaSaverService(),
);

/// 图片信息读取(卡 6.2)。
final imageInfoServiceProvider = Provider<ImageInfoService>(
  (ref) => const UiImageInfoService(),
);

/// 文件选择(卡 6.2;本期无业务消费,Provider 先行供后续 uploadFile 阶段复用)。
final fileServiceProvider = Provider<FileService>(
  (ref) => FilePickerFileService(),
);
```

`test/unit/webview_jsb_registry_test.dart`：既有断言（methodCount、重复注册护栏）按新签名补一个 `media: _fakeMediaDeps()`（fake 闭包全 no-op）；补一条断言：`registry.methodCount == 9`（device 3 + ui 4 + page 2 + media 4 = 13 → 注意：**以实际注册数为准**，正确值 = 3+4+2+4 = 13，执行者按生成断言核对并写明 13）。

> 更正：既有三组 methodCount 为 3+4+2=9；加入 media 4 个后为 **13**。测试断言写 `expect(registry.methodCount, 13)`。

### 4.5 AGENTS.md 有界编辑（卡 6.3，仅此一处）

`apps/mobile/AGENTS.md` §2 例外登记段（「另登记（阶段 4)…」那句之后）追加一句，**不改其他任何行**：

```diff
-另登记(阶段 4):`network → logging`(请求日志拦截器复用 AppLogger)、`lifecycle → analytics`(前后台事件埋点)与 `lifecycle → logging`(flush 钩子失败告警,可选依赖);新增跨模块依赖先在本条登记再写代码;
+另登记(阶段 4):`network → logging`(请求日志拦截器复用 AppLogger)、`lifecycle → analytics`(前后台事件埋点)与 `lifecycle → logging`(flush 钩子失败告警,可选依赖);另登记(阶段 6):`hybrid → permission`(JSB 媒体方法权限前置,仅引用 AppPermission/PermissionAppState 类型);新增跨模块依赖先在本条登记再写代码;
```

> 说明（决策）：`hybrid → media` **不登记**——`media.dart` 只引用自有 `JSBPickedImage` record 与闭包，core/media 类型在 features/webview 装配层完成转换（见 §4.4 diff 的 readImageInfo 转换行），hybrid 文件不 import core/media。`permission → permission_handler` 属「core 实现文件内 import 第三方插件」既定范式（同 SentryErrorReporter/SharedPreferencesKeyValueStore），不需例外。

### 4.6 阶段 6 静态自查清单（本机无 Flutter SDK，提交前逐项人工核对）

1. 所有新文件 import 前缀 `package:cms_mobile/`，无相对路径跨目录乱引（jsb_methods 内 `../jsb_registry.dart` 沿用既有风格允许）。
2. `lib/` 下无 `print(`/`debugPrint(`；无 `String.fromEnvironment` 新增读取点。
3. pubspec.yaml：8 个新依赖字母序正确、`^x.y.z`、未改动任何既有行（`git diff` 只有追加行）。
4. `core/hybrid/jsb_methods/media.dart` 只 import `dart:convert` + `core/permission/permission_service.dart` + `../jsb_registry.dart`（**不得** import flutter/core/media/dart:io）。
5. `permission_service.dart` 零第三方 import；permission_handler 只出现在 `permission_handler_service.dart`。
6. 插件 import 收敛核对：`image_picker`→media_picker_service.dart、`flutter_image_compress`→image_compress_service.dart、`cached_network_image`→cached_image.dart、`file_picker`→file_service.dart、`video_player`→video_service.dart、`just_audio`→audio_service.dart、`gal`→media_saver_service.dart、`dart:ui`→image_info_service.dart；其他文件不出现。
7. 单文件 ≤300 行；文案与 §4.1.3/§4.2.4/§4.3.3 锁定文案逐字一致。
8. 生成物零触碰：`apps/server/gen/**`、`apps/admin/src/api/generated/**` 无 diff。
9. AGENTS.md 仅 §2 一处追加（§4.5 diff），其他行无 diff。
10. 待 Flutter 环境执行：`flutter pub get && flutter analyze && dart format --set-exit-if-changed lib test && flutter test`（结果回填总计划 §8）。

---

## 5. 阶段 7

### 5.1 卡 7.1：version/check 契约 + server 实现（openapi/app + apps/server，agent B）

#### 5.1.1 契约（先落契约，再 `pnpm gen:api`，再补实现）

新增 `openapi/app/paths/version-check.yaml`（逐字）：

```yaml
get:
  operationId: versionCheck
  summary: 应用版本检查(匿名公开;配置读 env,admin 配置页列后续阶段)
  tags:
    - app
  security: []
  parameters:
    - name: platform
      in: query
      required: true
      description: 目标平台
      schema:
        type: string
        enum: [ios, android]
    - name: version
      in: query
      required: true
      description: 当前版本号(x.y.z 数字串;非法串按无更新处理)
      schema:
        type: string
        example: "1.2.3"
  responses:
    "200":
      description: 版本检查结果
      content:
        application/json:
          schema:
            $ref: ../components/schemas/version-check.yaml#/VersionCheckResult
```

新增 `openapi/app/components/schemas/version-check.yaml`（逐字）：

```yaml
VersionCheckResult:
  type: object
  required:
    - hasUpdate
    - forceUpdate
    - latestVersion
    - downloadUrl
    - releaseNotes
  properties:
    hasUpdate:
      type: boolean
      description: 是否有新版本(当前版本号非法或未配置最新版本时恒 false)
    forceUpdate:
      type: boolean
      description: 是否强制更新(仅 hasUpdate=true 时可能为 true)
    latestVersion:
      type: string
      example: "1.4.0"
      description: 最新版本号;未配置时回显请求版本号
    downloadUrl:
      type: string
      description: 下载地址;未配置为空串
    releaseNotes:
      type: string
      description: 更新说明;未配置为空串
```

`openapi/app/openapi.yaml` 修改（paths 下追加一条，其他行不动）：

```diff
 paths:
   /api/app/ping:
     $ref: ./paths/ping.yaml
+  /api/app/version/check:
+    $ref: ./paths/version-check.yaml
```

随后根目录执行 `pnpm gen:api`（redocly bundle 解析多文件 → oapi-codegen 生成 `gen/app/gen.go`）。生成物新增：`VersionCheckResult` model、`VersionCheckParams`（query 绑定）、`ServerInterface.VersionCheck`。**生成参数类型的确切标识符以生成物为准**（oapi-codegen 命名如 `VersionCheckParamsPlatform`），实现时对照 gen.go 引用，禁止手改生成物。

#### 5.1.2 server 配置（internal/config/config.go）

`Config` struct 增加一节（字段名锁定）：

```go
// AppVersionConfig C 端版本检查配置(公开只读;admin 配置页列后续阶段,见 docs/hybrid-capability-plan.md 决策 8)。
type AppVersionConfig struct {
	IOS     AppVersionRuleConfig
	Android AppVersionRuleConfig
}

// AppVersionRuleConfig 单平台版本规则;空 LatestVersion = 该平台未配置,检查恒返回无更新。
type AppVersionRuleConfig struct {
	LatestVersion     string
	ForceBelowVersion string
	DownloadURL       string
	ReleaseNotes      string
}
```

`Load()` 内追加（键名锁定；server 进程 env 与 mobile dart-define `APP_VERSION` 不同进程，无冲突）：

```go
AppVersion: AppVersionConfig{
	IOS: AppVersionRuleConfig{
		LatestVersion:     envOr("APP_VERSION_IOS", ""),
		ForceBelowVersion: envOr("APP_FORCE_VERSION_IOS", ""),
		DownloadURL:       envOr("APP_DOWNLOAD_URL_IOS", ""),
		ReleaseNotes:      envOr("APP_RELEASE_NOTES_IOS", ""),
	},
	Android: AppVersionRuleConfig{
		LatestVersion:     envOr("APP_VERSION_ANDROID", ""),
		ForceBelowVersion: envOr("APP_FORCE_VERSION_ANDROID", ""),
		DownloadURL:       envOr("APP_DOWNLOAD_URL_ANDROID", ""),
		ReleaseNotes:      envOr("APP_RELEASE_NOTES_ANDROID", ""),
	},
},
```

`config_test.go` 追加用例：设置 8 个 env → Load 后字段一一对应；缺省 → 全空串（不报错，零值合法）。

#### 5.1.3 service（internal/service/version_service.go）

```go
// Package service 既有注释不变。本文件:C 端版本检查(env 驱动,无 repo,GET 查询不埋 oplog)。
package service

import (
	"fmt"
	"strconv"
	"strings"
)

// VersionPlatform 目标平台(枚举即契约;handler 负责字符串解析与 400 映射)。
type VersionPlatform string

const (
	VersionPlatformIOS     VersionPlatform = "ios"
	VersionPlatformAndroid VersionPlatform = "android"
)

// ParseVersionPlatform 解析 query platform;非法返回 false(handler 映射 400)。
func ParseVersionPlatform(raw string) (VersionPlatform, bool)

// VersionRule 单平台版本规则(零值合法:Latest 空 = 未配置)。
type VersionRule struct {
	Latest     string
	ForceBelow string
	DownloadURL string
	ReleaseNotes string
}

// VersionServiceConfig 双平台规则。
type VersionServiceConfig struct {
	IOS     VersionRule
	Android VersionRule
}

// VersionCheckOutcome 检查结果(服务自有类型,handler 映射到 gen DTO;service 不 import gen)。
type VersionCheckOutcome struct {
	HasUpdate     bool
	ForceUpdate   bool
	LatestVersion string
	DownloadURL   string
	ReleaseNotes  string
}

// VersionService 版本检查:纯内存规则,无 DB。
type VersionService struct{ cfg VersionServiceConfig }

func NewVersionService(cfg VersionServiceConfig) *VersionService

// Check 决策(全程不返回 error,零值/非法输入一律降级为「无更新」):
// 1. Latest 空 → 零值 Outcome,LatestVersion 回显 current;
// 2. current 非法(CompareVersions 报错)→ HasUpdate=false,LatestVersion 仍返回 Latest;
// 3. current < Latest → HasUpdate=true;再判 ForceBelow 非空且 current < ForceBelow → ForceUpdate=true;
// 4. DownloadURL/ReleaseNotes 按平台规则原样透传(未配置为空串)。
func (s *VersionService) Check(platform VersionPlatform, current string) VersionCheckOutcome

// CompareVersions 数字版本比较:current<latest → -1;相等 → 0;> → 1。
// 规则:trim 后允许一个前导 'v'/'V';段数 1~3,缺段按 0 补齐("1.2" == "1.2.0");
// 每段必须全数字(允许前导零,按数值解析);含 '-'/'+'(预发布/构建元数据)、空段、非数字段 → error。
func CompareVersions(current, latest string) (int, error)
```

设计理由（写入代码注释）：`service` 禁止 import `config`（依赖矩阵），故规则以纯值构造参数传入，main.go 做 cfg→`VersionServiceConfig` 映射；查询接口不埋 oplog（AGENTS §5）；非法版本号降级无更新，避免坏 dart-define 把全量用户挡在强制更新外。

#### 5.1.4 service 测试（version_service_test.go，表驱动，六类边界）

| 编号 | 用例                                                                                       | 边界类别         | 断言                   |
| ---- | ------------------------------------------------------------------------------------------ | ---------------- | ---------------------- |
| V1   | CompareVersions 相等："1.2.3" vs "1.2.3" → 0；"1.2" vs "1.2.0" → 0                         | 零值             | 0                      |
| V2   | current 更旧 → -1（"1.2.3" vs "1.4.0"；次版本/修订位分别覆盖）                             | 正常             | -1                     |
| V3   | current 更新 → 1                                                                           | 正常             | 1                      |
| V4   | 非法输入全表：""、"abc"、"1..2"、"1.2.3.4"、"1.2.x"、"v1.2"（允许）→ 后两者分别 error/合法 | 空值/越界        | error 或合法值逐一断言 |
| V5   | 前导零与 v 前缀："v01.02.003" vs "1.2.3" → 0                                               | 越界             | 0                      |
| V6   | 预发布/构建元数据："1.2.3-rc.1"、"1.2.3+build5" → error                                    | 非法状态迁移同构 | error                  |
| V7   | Check：Latest 空 → HasUpdate=false、LatestVersion 回显 current、ForceUpdate=false          | 空值/零值        | 逐字段                 |
| V8   | Check：current 非法 → HasUpdate=false、LatestVersion=配置的 Latest                         | 空值（非法入参） | 逐字段                 |
| V9   | Check：current<Latest 且 ForceBelow 空 → HasUpdate=true、ForceUpdate=false                 | 零值             | ForceUpdate=false      |
| V10  | Check：current<ForceBelow → ForceUpdate=true；current==ForceBelow → false（边界含等于）    | 越界             | 布尔断言               |
| V11  | Check：platform 选择 iOS/Android 各自规则；DownloadURL/ReleaseNotes 透传                   | 正常             | 逐字段                 |
| V12  | ParseVersionPlatform："ios"/"android"→true；"IOS"/""/"web"→false                           | 空值/越界        | 布尔断言               |

#### 5.1.5 handler（internal/handler/app/version.go）

```go
package app

// VersionCheck GET /api/app/version/check:版本检查(匿名公开、禁止缓存;查询接口不埋 oplog)。
func (h *AppHandler) VersionCheck(w http.ResponseWriter, r *http.Request, params appgen.VersionCheckParams) {
	platform, ok := service.ParseVersionPlatform(string(params.Platform))
	if !ok {
		httpapi.WriteError(w, http.StatusBadRequest, "platform 仅支持 ios/android")
		return
	}
	version := strings.TrimSpace(params.Version)
	if version == "" {
		httpapi.WriteError(w, http.StatusBadRequest, "version 不能为空")
		return
	}
	out := h.versions.Check(platform, version)
	w.Header().Set("Cache-Control", "no-store")
	httpapi.WriteJSON(w, http.StatusOK, appgen.VersionCheckResult{
		HasUpdate:     out.HasUpdate,
		ForceUpdate:   out.ForceUpdate,
		LatestVersion: out.LatestVersion,
		DownloadUrl:   out.DownloadURL, // 字段名以生成物为准
		ReleaseNotes:  out.ReleaseNotes,
	})
}
```

`app.go` 修改：`AppHandler` 加 `versions *service.VersionService` 字段；`New(logger *slog.Logger, versions *service.VersionService)`；包注释追加一句「version/check 经 VersionService 读 env 配置」。`ping_test.go` 中 `New(nil)` 改为 `New(nil, service.NewVersionService(service.VersionServiceConfig{}))`（唯一调用点，改完即过）。

`cmd/server/main.go` 修改（装配，位置在 app/h5 装配段）：

```diff
-// app/h5 占坑期与 site 同款匿名公开链,不注入任何 service(见 docs/monorepo-expansion-plan.md 阶段 2)。
+// app 受众:version/check 注入 env 版本配置服务(其余端点仍无 service);h5 维持纯匿名公开链。
+versionService := service.NewVersionService(service.VersionServiceConfig{
+	IOS: service.VersionRule{
+		Latest: cfg.AppVersion.IOS.LatestVersion, ForceBelow: cfg.AppVersion.IOS.ForceBelowVersion,
+		DownloadURL: cfg.AppVersion.IOS.DownloadURL, ReleaseNotes: cfg.AppVersion.IOS.ReleaseNotes,
+	},
+	Android: service.VersionRule{
+		Latest: cfg.AppVersion.Android.LatestVersion, ForceBelow: cfg.AppVersion.Android.ForceBelowVersion,
+		DownloadURL: cfg.AppVersion.Android.DownloadURL, ReleaseNotes: cfg.AppVersion.Android.ReleaseNotes,
+	},
+})
 appMux := http.NewServeMux()
-appgen.HandlerFromMux(apphandler.New(logger), appMux)
+appgen.HandlerFromMux(apphandler.New(logger, versionService), appMux)
```

#### 5.1.6 handler 测试（version_test.go，经 appgen.HandlerFromMux 起完整 mux，照 ping_test 范式）

| 编号 | 用例                                                                                                           | 边界类别                      | 断言                            |
| ---- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------- |
| H1   | 正常：Latest=1.4.0、当前 1.2.3 → 200、信封 code=200、data.hasUpdate=true、Cache-Control: no-store              | 正常                          | 逐字段                          |
| H2   | platform=web → 400、错误信封 message='platform 仅支持 ios/android'                                             | 越界                          | 状态码+message                  |
| H3   | version 缺失/空串 → 400 'version 不能为空'（生成物对 required query 缺失若已 400，以生成物行为为准并断言 400） | 空值                          | 400                             |
| H4   | version=abc → 200 且 hasUpdate=false（非法版本降级）                                                           | 空值（非法入参）              | hasUpdate=false                 |
| H5   | Latest 未配置（空规则）→ hasUpdate=false、latestVersion 回显请求 version                                       | 零值                          | 逐字段                          |
| H6   | current<ForceBelow → forceUpdate=true；current==ForceBelow → false                                             | 越界                          | 布尔断言                        |
| H7   | platform=android 走 Android 规则（与 iOS 不同配置时）                                                          | 权限缺失同构（受众/平台边界） | latestVersion 来自 Android 规则 |

#### 5.1.7 卡 7.1 验收命令

```bash
# 契约结构校验(bundle 成功即多文件 $ref 全部可解析)
cd apps/server && pnpm exec redocly bundle ../../openapi/app/openapi.yaml -o /tmp/app-bundle-check.yaml
# 生成 + 幂等核对(再跑一遍无 diff)
pnpm gen:api && pnpm gen:api && git diff --exit-code apps/server/gen
# server 门禁
cd apps/server && go build ./... && go vet ./... && go test ./...
# 根门禁(涉及契约改动)
pnpm verify
```

### 5.2 卡 7.2：mobile Push 抽象（apps/mobile；阶段 6 合并后开工）

#### 5.2.1 文件清单

| 动作 | 文件                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 新增 | `lib/core/push/push_service.dart`                                                                        |
| 新增 | `lib/core/push/push_route.dart`                                                                          |
| 新增 | `test/unit/push_route_test.dart`、`test/unit/push_service_test.dart`                                     |
| 修改 | `lib/core/config/app_config.dart`（加 `pushEnabled` 字段 + `PUSH_ENABLED` dart-define）                  |
| 修改 | `lib/app_providers.dart`（`pushServiceProvider`）                                                        |
| 修改 | `apps/mobile/AGENTS.md` §4 配置坑清单加一行；`apps/mobile/README.md` 配置坑清单加同一行                  |
| 修改 | `test/unit/monitoring_fake_test.dart` 等构造 AppConfig 的测试（新必填字段，逐处补 `pushEnabled: false`） |

AppConfig diff 要点：`const AppConfig({…, required this.pushEnabled})` + `factory` 内 `pushEnabled: const bool.fromEnvironment('PUSH_ENABLED', defaultValue: false)` + 字段注释「Push 总开关;false → NoopPushService（决策 7)」。AGENTS/README 表行：`| PUSH_ENABLED | Push SDK 总开关 | 默认 false(NoopPushService,SDK 后接) |`。

#### 5.2.2 API（逐字实现）

```dart
// lib/core/push/push_service.dart
import 'dart:async';

/// native 收到推送后拟向 H5 派发的事件名(决策 7 预留;本期仅常量与注释,不实现派发)。
/// 派发通道:webview 容器 evaluateJavascript window.__JSB_BRIDGE__.dispatchEvent(kPushMessageEvent, payload)。
const String kPushMessageEvent = 'push.message';

/// 推送消息协议:type 决定跳转路由(映射表见 push_route.dart),payload 为业务载荷。
class PushMessage {
  const PushMessage({required this.type, this.payload = const <String, dynamic>{}});
  final String type;
  final Map<String, dynamic> payload;
}

/// Push 抽象(决策 7):SDK(FCM/厂商通道)后接,只换实现。
abstract interface class PushService {
  /// 初始化(权限申请/SDK 注册);重复调用幂等。
  Future<void> init();
  /// 前台/通知点击消息流(广播)。
  Stream<PushMessage> get onMessage;
  /// 冷启动携带的消息;无 → null。
  Future<PushMessage?> getInitialMessage();
}

/// 默认实现(PUSH_ENABLED=false 或 SDK 未接入):全 no-op,流为空广播流。
class NoopPushService implements PushService {
  const NoopPushService();
  @override
  Future<void> init() async {}
  @override
  Stream<PushMessage> get onMessage => const Stream<PushMessage>.empty();
  @override
  Future<PushMessage?> getInitialMessage() async => null;
}
```

```dart
// lib/core/push/push_route.dart
import '../hybrid/webview_url.dart';

/// 路由映射结果:null = 不跳转(未知类型/非法载荷,降级不阻断)。
/// 映射表(锁定,新增 type 需评审):
///   'home'    → '/'(payload 忽略)
///   'webview' → '/webview?url=<payload.url>'(url 必填且过 validateWebViewUrl;可带 payload.title)
String? resolvePushRoute(PushMessage message) { /* 纯函数 */ }
```

> 依赖说明（已核对）：`push → hybrid(webview_url)` 属新增跨模块依赖——**避免方案**：把 `validateWebViewUrl` 的调用以闭包注入？不，更简单的决策：`resolvePushRoute` 直接内联「http/https 前缀 + Uri.parse 非空」两条件（与 validateWebViewUrl 语义一致但不 import），**不新增 AGENTS 例外**。代码注释注明「与 core/hybrid/webview_url.dart 语义保持一致，刻意不依赖以守 core 模块零耦合」。

装配（app_providers.dart 追加）：

```dart
/// Push(卡 7.2):PUSH_ENABLED=false 或 SDK 未接入 → Noop;真实 SDK 实现后在此按 config.pushEnabled 选型。
final pushServiceProvider = Provider<PushService>((ref) {
  final config = ref.watch(appConfigProvider);
  // 决策 7:本期只交付 Noop;config.pushEnabled 为 true 时同样落 Noop 并留 TODO(SDK 实装点)。
  return const NoopPushService();
});
```

#### 5.2.3 卡 7.2 测试用例表

| 编号 | 用例                                                                                                 | 边界类别  | 断言                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| PU1  | NoopPushService.init/getInitialMessage/onMessage                                                     | 零值      | init 不抛；initial null；流首事件前关闭无事件                        |
| PU2  | resolvePushRoute type='home' → '/'                                                                   | 正常      | '/'                                                                  |
| PU3  | type='webview' + 合法 url → '/webview?url=…'（encodeQueryComponent）；带 title 拼 &title=            | 正常      | 逐字                                                                 |
| PU4  | type='webview' url 缺失/空/非 http(s)/非字符串 → null                                                | 空值/越界 | null                                                                 |
| PU5  | 未知 type → null（不跳转不抛错）                                                                     | 越界      | null                                                                 |
| PU6  | type 空串、payload 缺省 → null                                                                       | 空值      | null                                                                 |
| PU7  | AppConfig.fromDartDefines 不可单测（const ctor）：直接构造含 pushEnabled 的 AppConfig 供其他测试复用 | 零值      | 编译通过即护栏（参照既有测试 fake config 全部补 pushEnabled: false） |

### 5.3 卡 7.3：mobile 曝光埋点（apps/mobile）

#### 5.3.1 pubspec 追加（字母序）

```yaml
url_launcher: ^6.3.2 # 钉版本待评审;卡 7.4 用,此处一并评审,插在 shared_preferences 与 video_player 之间
video_player: ^2.10.0 # 阶段 6 已加
visibility_detector: ^0.4.0+2 # 钉版本待评审;追加在 video_player 之后
```

（`url_launcher` 属卡 7.4，放在本小节统一登记依赖评审；若阶段 6 与 7.3/7.4 分批落地，pubspec 逐卡追加同规则。）

#### 5.3.2 EventTracker 增 expose 语义（对齐 miniapp `track.expose`）

`lib/core/analytics/event_tracker.dart` 接口追加（决策：与 miniapp 一致的事件名 `expose` + `trackId` 属性；接口加方法而非约定裸 track 字符串，编译期护栏）：

```dart
abstract interface class EventTracker {
  void pageView(String path, {Map<String, Object?>? properties});
  void track(String name, {Map<String, Object?>? properties});

  /// 元素曝光(决策 11,与 miniapp track.expose 对齐):事件名 'expose',属性含 trackId。
  void expose(String trackId, {Map<String, Object?>? properties});
}
```

`event_tracker_impls.dart` 双实现各加：

```dart
@override
void expose(String trackId, {Map<String, Object?>? properties}) =>
    track('expose', properties: {'trackId': trackId, ...?properties});
```

（Console 实现同样经此转发；Sentry 实现经 track 的 breadcrumb。）

连带修改：`test/unit/app_lifecycle_test.dart` 的 `_FakeEventTracker implements EventTracker` 补 `expose` 空实现（**这是唯一的存量 fake**，已全库核查）；`monitoring_fake_test.dart` 只用真实实现，不受影响。

#### 5.3.3 `lib/core/ui/exposure_detector.dart`

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:visibility_detector/visibility_detector.dart';

/// 曝光阈值(决策 11,锁定):≥50% 可见持续 300ms。
const double kExposeRatioThreshold = 0.5;
const int kExposeDurationMs = 300;

/// 曝光触发判定(纯函数):双阈值;非有限值一律 false。
bool shouldExpose(double ratio, int durationMs);

/// 页面实例级去重器(决策 11:同页面实例同 trackId 只报一次,重进可再报;
/// 不做会话级/持久化去重)。tryMark 首次 true 并登记;reset 清空(显式重置 API)。
class ExposureDedup {
  bool tryMark(String trackId);
  bool has(String trackId);
  void reset();
  int get size;
}

/// 曝光会话纯逻辑(一个埋点位一个会话;定时器注入,单测无 Flutter):
/// hidden →(ratio≥阈值)pending(起计时)→(持续达标)report 一次 → exposed;
/// pending 中跌回阈值下 → 撤计时回 hidden;dispose 幂等。语义与 miniapp expose-logic.ts 逐行对齐。
class ExposureSession {
  ExposureSession({
    required String trackId,
    required void Function(String trackId) report,
    required ExposureDedup dedup,
    void Function(void Function() body, Duration delay)? startTimer,   // 缺省 Timer.new
    void Function(Object timer)? cancelTimer,                           // 缺省 (t) => (t as Timer).cancel()
    double ratioThreshold = kExposeRatioThreshold,
    int durationMs = kExposeDurationMs,
  });
  void onVisible(double ratio);   // visibility_detector 回调喂入;非法值(NaN/负)按 0 处理
  void dispose();
}

/// 曝光容器:child 进入可视 ≥50% 持续 300ms → onExpose(trackId) 一次(State 生命周期内去重,
/// 页面重进 State 销毁即自然重置)。onExpose 必传——core/ui 不依赖 analytics(守 core 零耦合,
/// 不新增 AGENTS 例外),装配方(feature 页)闭包接 ref.read(eventTrackerProvider).expose。
class ExposureDetector extends StatefulWidget {
  const ExposureDetector({
    super.key,
    required this.trackId,
    required this.onExpose,
    required this.child,
    this.ratioThreshold = kExposeRatioThreshold,
    this.durationMs = kExposeDurationMs,
  });
  final String trackId;
  final void Function(String trackId) onExpose;
  final Widget child;
  final double ratioThreshold;
  final int durationMs;
  // State:持有 ExposureDedup + ExposureSession;build 包 VisibilityDetector(
  //   key: ValueKey('expose-$trackId'), onVisibilityChanged: (info) => session.onVisible(info.visibleFraction));
  // dispose → session.dispose()。
}
```

app_providers **无改动**（决策记录：ExposureDetector 经 `onExpose` 闭包注入，core/ui 不 import analytics/app_providers，避免新增跨模块例外；使用范式写入文件头注释：`ExposureDetector(trackId: 'home.banner', onExpose: (id) => ref.read(eventTrackerProvider).expose(id), child: …)`）。

#### 5.3.4 卡 7.3 测试用例表（`test/unit/exposure_session_test.dart`，E 系列，纯 Dart + fake 定时器）

| 编号 | 用例                                                                                  | 边界类别          | 断言                                                            |
| ---- | ------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| E1   | `shouldExpose` 49.9%/50%/299ms/301ms 四边界                                           | 越界              | false/true/false/true                                           |
| E2   | ratio=NaN/Infinity/-0.1 → false                                                       | 空值（非法值）    | false                                                           |
| E3   | ExposureDedup：同 trackId 二次 tryMark → false；reset 后可再放行；空串 trackId 也登记 | 零值/非法状态迁移 | 布尔序列 + size                                                 |
| E4   | Session：达阈值起计时，300ms 后 report 一次                                           | 正常              | fake 定时器手动推进，report 调用 1 次且 trackId 正确            |
| E5   | pending 中 ratio 跌回 0.4 → 撤计时；再次 0.5 重新起计时                               | 非法状态迁移      | report 0 次 → 推进后 1 次                                       |
| E6   | 已 exposed 后任何 onVisible 不再报                                                    | 非法状态迁移      | report 仍 1 次                                                  |
| E7   | 同 dedup 两个 Session 同 trackId → 第二个不报（页面级去重语义）                       | 正常              | report 1 次                                                     |
| E8   | dispose 后计时器撤销、onVisible no-op；dispose 幂等                                   | 零值              | 不抛、report 0 次                                               |
| E9   | EventTracker：ConsoleEventTracker.expose 转发 track('expose', {'trackId': …})         | 正常              | 经接口调用不抛（真实实现冒烟）；fake 实现接口含 expose 编译通过 |
| E10  | ratio 恰好 0.5 + 时长恰好 300 → 触发（含等于边界）                                    | 越界              | report 1 次                                                     |

（widget 冒烟 `test/widget/exposure_detector_test.dart` 待 Flutter 环境：可见性回调 → onExpose 一次。）

### 5.4 卡 7.4：mobile 更新客户端（apps/mobile，依赖 7.1 已合并）

#### 5.4.1 文件清单

| 动作 | 文件                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 新增 | `lib/core/network/version_repository.dart`                                                                          |
| 新增 | `lib/core/update/update_checker.dart`                                                                               |
| 新增 | `lib/features/update/update_gate.dart`                                                                              |
| 新增 | `test/unit/version_repository_test.dart`、`test/unit/update_checker_test.dart`、`test/widget/update_gate_test.dart` |
| 修改 | `lib/app_providers.dart`（`versionRepositoryProvider`、`updateCheckerProvider`）                                    |
| 修改 | `lib/router/app_router.dart`（home 路由包 UpdateGate，见 diff）                                                     |
| 修改 | `apps/mobile/AGENTS.md` §2 例外登记追加 `update → network`（见下）                                                  |

AGENTS.md §2 追加（与阶段 6 那句合并落一次也行，分开落地时各自追加）：

```
另登记(阶段 7):`update → network`(更新检查复用网络层 VersionRepository,与 features 经 Repository 消费数据同范式);
```

#### 5.4.2 `lib/core/network/version_repository.dart`

```dart
import 'package:dio/dio.dart';

import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';

/// 版本检查数据(record 形态载荷,非契约 DTO 类;字段与 openapi/app version-check.yaml 一一对应)。
typedef VersionCheckData = ({
  bool hasUpdate,
  bool forceUpdate,
  String latestVersion,
  String downloadUrl,
  String releaseNotes,
});

/// version/check 仓库:GET /api/app/version/check(契约见 openapi/app/paths/version-check.yaml);
/// 走 dioCall 边界,只抛 AppError;支持可选 CancelToken(页面销毁取消)。
class VersionRepository {
  VersionRepository(this._dio);
  final Dio _dio;

  static const String _path = '/api/app/version/check';

  Future<VersionCheckData> check({
    required String platform,   // 'ios' | 'android'(调用方经 resolveRequestPlatform 归一)
    required String version,
    CancelToken? cancelToken,
  }) async {
    final Response<dynamic> response = await dioCall<dynamic>(
      () => _dio.get<dynamic>(_path, queryParameters: {'platform': platform, 'version': version}, cancelToken: cancelToken),
      cancelToken: cancelToken,
    );
    return parseVersionCheckData(response.data);
  }
}

/// 载荷解析(纯函数,照 extractPingMessage 范式):非对象/缺键/类型错 → AppError(kMalformedEnvelopeMessage);
/// 五个键全必填(契约 required),bool 只接受 bool、string 只接受 String。
VersionCheckData parseVersionCheckData(Object? payload);
```

#### 5.4.3 `lib/core/update/update_checker.dart`

```dart
/// 更新决策三态:none=不打扰;optional=可关闭弹窗;force=强制(不可关闭,决策 8)。
enum UpdateAction { none, optional, force }

/// 更新决策结果。
typedef UpdateDecision = ({
  UpdateAction action,
  String latestVersion,
  String downloadUrl,
  String releaseNotes,
});

const UpdateDecision kNoUpdate = (action: UpdateAction.none, latestVersion: '', downloadUrl: '', releaseNotes: '');

/// 决策合并(纯函数):信任 server 的 hasUpdate/forceUpdate(server 已做版本比较,卡 7.1);
/// 护栏:remote.latestVersion 为空或与 currentVersion 相同 → none(容错坏配置);
/// hasUpdate=false → none;forceUpdate=true → force;其余 optional。
UpdateDecision resolveUpdateDecision({required String currentVersion, required VersionCheckData remote});

/// 请求平台归一(纯函数):Platform.operatingSystem → 'ios'/'android';其他(fuchsia/macos 开发机) → null(跳过检查)。
String? resolveRequestPlatform(String operatingSystem);

/// 更新检查编排:网络失败/非法一律降级 kNoUpdate(降级不阻断主流程,决策 8/10 同款哲学);
/// 失败经 onError 闭包上报(装配层接 AppLogger,本文件不 import logging,不新增跨模块例外)。
class UpdateChecker {
  UpdateChecker({required VersionRepository repository, required AppConfig config, void Function(Object error)? onError, ...});
  /// 执行一次检查;平台不支持/失败 → kNoUpdate。
  Future<UpdateDecision> check({CancelToken? cancelToken});
}
```

#### 5.4.4 `lib/features/update/update_gate.dart`（弹窗 + 启动触发）

决策（启动触发落点）：**路由层 UpdateGate 包裹 HomePage**，理由——app.dart 只接 core 服务（现状契约，不动）；HomePage 是 ConsumerWidget 三态样板（不动）；showDialog 需要 MaterialApp 之下的 context，路由包裹件是最小侵入点。

```dart
/// 更新门禁:包裹落地页;首帧后触发一次检查,按决策弹更新对话框。
/// 每页面实例只查一次(State 守卫);失败静默(UpdateChecker 已降级)。
class UpdateGate extends ConsumerStatefulWidget {
  const UpdateGate({super.key, required this.child});
  final Widget child;
  // initState:WidgetsBinding.instance.addPostFrameCallback → _check()。
  // _check:decision = await ref.read(updateCheckerProvider).check();!mounted 或 none → return;
  //   showDialog(barrierDismissible: decision.action != force, builder → UpdateDialog(decision))。
}

/// 更新对话框(中文文案锁定):
/// 标题:force '重要更新' / optional '发现新版本 V<latestVersion>'
/// 内容:force 固定文案 + releaseNotes(空则只固定文案)/ optional releaseNotes(空回退 '建议更新到最新版本以获得更好体验。')
/// 按钮:optional [稍后再说(关闭), 立即更新];force 仅 [立即更新],且 barrierDismissible=false + PopScope(canPop:false)
/// 「立即更新」:downloadUrl 空 → 按钮置灰;非空 → launchUrl(Uri.parse(downloadUrl), mode: externalApplication)(url_launcher)。
class UpdateDialog extends StatelessWidget { … }
```

中文文案锁定：强制固定文案 `'当前版本已停止服务,请更新后继续使用。'`；按钮 `'稍后再说'` / `'立即更新'`。

`lib/router/app_router.dart` diff（仅 home 一行）：

```diff
-    GoRoute(path: '/', builder: (context, state) => const HomePage()),
+    GoRoute(path: '/', builder: (context, state) => const UpdateGate(child: HomePage())),
```

`lib/app_providers.dart` 追加：

```dart
/// 版本检查仓库(卡 7.4):测试经 override 注入 fake。
final versionRepositoryProvider = Provider<VersionRepository>(
  (ref) => VersionRepository(ref.watch(dioProvider)),
);

/// 更新检查编排(卡 7.4):失败降级 kNoUpdate 并经 AppLogger 告警。
final updateCheckerProvider = Provider<UpdateChecker>(
  (ref) => UpdateChecker(
    repository: ref.watch(versionRepositoryProvider),
    config: ref.watch(appConfigProvider),
    onError: (error) => ref.read(appLoggerProvider).warn('update check failed: $error'),
  ),
);
```

（`AppLogger.warn` 签名以现有 core/logging/app_logger.dart 为准；若无 warn 级则用 debug——执行时核对，二选一，不得改 AppLogger 接口。）

#### 5.4.5 卡 7.4 测试用例表

`test/unit/version_repository_test.dart`（VR 系列，fake HttpClientAdapter 打桩，照 network_ping_repository_test 范式）：

| 编号 | 用例                                                                                   | 边界类别                 | 断言              |
| ---- | -------------------------------------------------------------------------------------- | ------------------------ | ----------------- |
| VR1  | 200 正常载荷 → record 五字段                                                           | 正常                     | 逐字段            |
| VR2  | 载荷非 Map/缺 hasUpdate/类型错（hasUpdate='yes'）→ AppError(kMalformedEnvelopeMessage) | 空值                     | throwsA AppError  |
| VR3  | 信封 code!=200 → AppError 透传（信封拦截器范式）                                       | 网络失败                 | code/message 透传 |
| VR4  | 传输层失败 → AppError(code:0)                                                          | 网络失败                 | code 0            |
| VR5  | CancelToken 已取消 → AppError(code:-1,'请求已取消')                                    | 非法状态迁移（取消语义） | 逐字              |
| VR6  | downloadUrl/releaseNotes 空串合法 → 原样空串                                           | 零值                     | ''                |

`test/unit/update_checker_test.dart`（UC 系列，fake repository 闭包）：

| 编号 | 用例                                                                                                    | 边界类别  | 断言        |
| ---- | ------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| UC1  | hasUpdate=false → none                                                                                  | 正常      | kNoUpdate   |
| UC2  | hasUpdate=true, forceUpdate=false → optional，字段透传                                                  | 正常      | action/字段 |
| UC3  | forceUpdate=true → force                                                                                | 正常      | force       |
| UC4  | latestVersion='' 或与 currentVersion 相同 → none（护栏）                                                | 空值/零值 | none        |
| UC5  | repository 抛 AppError → kNoUpdate 且 onError 被调 1 次                                                 | 网络失败  | 降级+回调   |
| UC6  | resolveRequestPlatform：ios/android/macOS/'' → 'ios'/'android'/null/null                                | 越界      | 归一表      |
| UC7  | config.appVersion 非法（'abc'）→ 请求仍发出，结果按 server 返回（server 已降级 hasUpdate=false → none） | 空值      | none        |
| UC8  | 平台 null（非 ios/android）→ 不发请求直接 kNoUpdate（fake repository 调用数 0）                         | 零值      | 0 次        |

`test/widget/update_gate_test.dart`（待 Flutter 环境）：force 弹窗不可关闭（barrierDismissible=false、无「稍后再说」）；optional 可关闭；downloadUrl 空 → 「立即更新」置灰；文案逐字断言。

---

## 6. 数据流与调用关系（总览）

- JSB 媒体链路：H5 `callNative('chooseImage')` → flutter_inappwebview handler → `JSBRegistry.handleRawCall` → `media.dart` handler → `ensurePermission`（PermissionService）→ `pickFromGallery`（MediaPickerService→ImageCompressService→ImageInfoService 管线，webview_page 装配）→ 信封 `{code:0,data}`；取消 → `{code:1003,error:{code:'CANCELLED'}}`；权限拒绝 → `{code:1000,error:{code:'PERMISSION_DENIED',message:<中文>}}`。
- 更新链路：UpdateGate 首帧 → UpdateChecker.check → VersionRepository（dioCall）→ server `GET /api/app/version/check`（VersionService env 规则 + CompareVersions）→ resolveUpdateDecision → UpdateDialog（force 不可关闭）。
- Push（预留）：未来 SDK 实装 → PushMessage{type,payload} → resolvePushRoute → GoRouter；native 收推送 → `kPushMessageEvent`('push.message') 经 registry 事件派发通知 H5（本期仅常量）。

---

## 7. 风险与边界情况

| 风险                                        | 缓解                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本机无 Flutter SDK，mobile 无法编译/跑测试  | 代码+测试照常交付；§4.6 静态自查清单逐项过；runbook 标注待 Flutter 环境（总计划 §8）                                                                    |
| iOS 权限文案审核风险                        | 文案集中 kPermissionCopyTable 一处可审；rationale/settingsHint 分态展示                                                                                 |
| `PERMISSION_DENIED` 非协议 7 码             | 协议不改：registry 数字码兜底 1000、字符串码透传，js 侧归一 NATIVE_ERROR+nativeCode（protocol.ts 既定语义）；H5 调试页按 error.code/nativeCode 展示即可 |
| iOS 限定相册（limited）                     | `isPermissionUsable` 按可用处理，流程不阻断；MM8 锁定                                                                                                   |
| dataUrl 体积撑爆 JSB 通道                   | 1MB 内联上限（kMaxInlineDataUrlBytes），超限静默省略；MM9 锁定边界                                                                                      |
| saveImageToAlbum 双端权限差异               | 统一前置 photo 权限（简化决策，gal 内部兼容 Android 13+）；后续真机核对入 runbook                                                                       |
| 版本号 dart-define 坏值把用户挡在强制更新外 | server 端非法版本一律 hasUpdate=false（V8/H4）；mobile 端 latestVersion==currentVersion 护栏（UC4）                                                     |
| version env 配置漂移                        | 本期 env 只读 + 文档声明；admin 配置页列后续阶段（总计划 §7）                                                                                           |
| UpdateGate 弹窗重复弹                       | State 守卫每实例一次；force 弹窗 PopScope 拦截返回键                                                                                                    |
| EventTracker 接口加方法破坏存量 fake        | 已全库核查仅 `app_lifecycle_test.dart` 一处 `_FakeEventTracker`，随卡同批改                                                                             |
| 阶段 6 与 7.2/7.3/7.4 并行冲突              | §2.4 串行约束：7.2/7.3/7.4 必须等阶段 6 合并（app_providers.dart/pubspec.yaml 热点文件）                                                                |

---

## 8. 验收标准

### 阶段 6（agent A）

1. §2.2 文件清单全部落地，无私自增删文件；§4.6 静态自查 10 项逐项通过。
2. `git diff` 核对：`apps/mobile/**` 之外零改动；pubspec.yaml 只有 8 行追加；AGENTS.md 仅 §2 一处追加。
3. 测试与实现同批交付：P/PS/W（6.1）、M（6.2）、MM（6.3）系列用例齐全，六类边界覆盖表逐条可指认。
4. `webview_jsb_registry_test.dart` 断言 methodCount=13 通过（待 Flutter 环境）。
5. 待 Flutter 环境执行命令（结果回填总计划 §8）：
   `cd apps/mobile && flutter pub get && flutter analyze && dart format --set-exit-if-changed lib test && flutter test`

### 卡 7.1（agent B）

1. §2.3 文件清单落地；`openapi/app/**` 与 `apps/server/**` 之外零改动；`gen/**` 无手改痕迹。
2. §5.1.7 四条验收命令全绿（redocly bundle / gen:api 幂等 / go 门禁 / pnpm verify）。
3. V 系列 12 例 + H 系列 7 例与实现同批交付。
4. 行为验收：`APP_VERSION_IOS=1.4.0 APP_FORCE_VERSION_IOS=1.0.0` 启动 server 后，
   `curl 'http://localhost:8080/api/app/version/check?platform=ios&version=1.2.3'` 返回 `hasUpdate=true, forceUpdate=true`；
   `platform=web` 返回 400；`version=abc` 返回 `hasUpdate=false`。

### 卡 7.2 / 7.3 / 7.4（后续卡，阶段 6 合并后开工）

1. 各自 §5.2/§5.3/§5.4 文件清单与测试表（PU/E/VR/UC 系列）落地；`AppConfig.pushEnabled`、AGENTS/README 配置表、EventTracker.expose、AGENTS `update → network` 登记齐全。
2. 静态自查沿用 §4.6 适用项（import 前缀/无 print/单文件行数/生成物零触碰）。
3. 待 Flutter 环境：`flutter analyze && flutter test` 全绿；widget 用例（exposure_detector、update_gate）通过。
