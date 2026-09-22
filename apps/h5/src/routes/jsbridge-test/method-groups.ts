export interface JSBMethodMeta {
  /** 协议 method 名(与 native 注册表一致)。 */
  method: string;
  /** 卡片中文标题。 */
  label: string;
  /** 一句话中文说明。 */
  description: string;
  /** 参数输入框默认 JSON 文本。 */
  defaultParams: string;
}

export interface JSBMethodGroup {
  /** 分组 key(渲染用)。 */
  key: string;
  /** 分组中文标题。 */
  title: string;
  methods: JSBMethodMeta[];
}

export const jsbMethodGroups: JSBMethodGroup[] = [
  {
    key: "device",
    title: "设备 / 网络 / 版本",
    methods: [
      {
        method: "getDeviceInfo",
        label: "获取设备信息",
        description: "返回平台、系统版本与语言环境。",
        defaultParams: "{}"
      },
      {
        method: "getNetworkType",
        label: "获取网络状态",
        description: "返回 online / offline / unknown。",
        defaultParams: "{}"
      },
      {
        method: "getAppVersion",
        label: "获取 App 版本",
        description: "返回版本号、构建号与环境档位。",
        defaultParams: "{}"
      }
    ]
  },
  {
    key: "ui",
    title: "UI 交互",
    methods: [
      {
        method: "showToast",
        label: "显示 Toast",
        description: "message 必填;duration 可选 short / long。",
        defaultParams: '{\n  "message": "你好,来自 H5",\n  "duration": "short"\n}'
      },
      {
        method: "showLoading",
        label: "显示加载中",
        description: "text 可选,默认「加载中…」。",
        defaultParams: '{\n  "text": "加载中…"\n}'
      },
      {
        method: "hideLoading",
        label: "隐藏加载中",
        description: "关闭当前加载遮罩,无遮罩时静默成功。",
        defaultParams: "{}"
      },
      {
        method: "setNavigationBarTitle",
        label: "设置导航栏标题",
        description: "title 必填,最长 64 字符。",
        defaultParams: '{\n  "title": "JSB 测试页"\n}'
      }
    ]
  },
  {
    key: "page",
    title: "页面跳转",
    methods: [
      {
        method: "openPage",
        label: "打开原生页面",
        description: "path 限白名单:/ 或 /webview;/webview 需 params.url(http/https)。",
        defaultParams: '{\n  "path": "/",\n  "params": {}\n}'
      },
      {
        method: "closePage",
        label: "关闭当前页面",
        description: "返回上一页;不可返回时静默成功。",
        defaultParams: "{}"
      }
    ]
  }
];

/** 事件订阅演示的默认事件名(native 在 webview 加载完成时派发)。 */
export const JSB_DEMO_EVENT = "native.webview.ready";
