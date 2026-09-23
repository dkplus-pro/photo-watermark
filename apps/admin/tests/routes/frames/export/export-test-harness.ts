// 导出页(阶段 13)测试脚手架的「带 src 依赖」那一半:清单默认值与 store 读写。
//
// 替身函数与纯数据夹具在同目录的 `./export-test-doubles.ts`。拆成两个文件不是为了整洁,
// 而是 ESM 求值顺序的硬要求:`vi.mock` 工厂在被 mock 的模块被求值的那一刻执行,而本文件一
// import `src/store/export` 就会牵出 `store → style-registry → frame-drawing → fonts → asset-url`
// 这条链去求值被替掉的 asset-url —— 那一刻 doubles 必须已经初始化完毕,它自己因此一行
// src 运行期代码都不能 import(否则就是 "Cannot access '__vi_import_N__' before initialization")。
// 测试文件仍只认这一个入口(`from "./export-test-harness"`),不直接引 doubles。
//
// 打桩的边界与「替身函数只创建一次」的约定写在 doubles 文件头。
// 不打桩的:`store/export`(状态机与守卫是被测协作方)、本阶段自己的 `style-guard` /
// `logo-settings` / `use-file-preparation` / `use-export-flow`(经页面间接验,或由各自用例直接验)。
import { catalogDefaults, makeFrameEntry, pickerProps } from "./export-test-doubles";
import { CUSTOM_LOGO_ID, NO_LOGO_ID, useExportStore } from "../../../../src/store/export";
import { listFrameStyleIds } from "../../../../src/utils/frame/style-registry";
import type { ExportFileEntry } from "../../../../src/store/export";
import type { SizeTierKey } from "../../../../src/utils/frame/types";

export {
  DEFAULT_LOGOS,
  catalogDefaults,
  exportTestDoubles,
  makeDeferred,
  makeFailure,
  makeFrameEntry,
  makeImageFile,
  makeLogoEntry,
  makePickerStub,
  makeSummary,
  makeTaskResult,
  pickerProps,
  resetExportTestDoubles,
  resetPickerRegistry
} from "./export-test-doubles";

/** 真实注册表里的第一个样式 id:清单与注册表两边都有它才算「样式存在」。 */
export const REGISTERED_STYLE_ID = listFrameStyleIds()[0];
/** 清单项造得出来、但注册表一定没有的 id(仓库当前只注册了 plain-frame 一款)。 */
export const UNREGISTERED_STYLE_ID = "not-in-registry-frame";

export const DEFAULT_FRAMES = [makeFrameEntry(REGISTERED_STYLE_ID, "基础黑框")];

// 带注册表依赖的默认清单填进 doubles 的槽位(那边不能 import 注册表)。
catalogDefaults.frames = DEFAULT_FRAMES;

/** store 的干净初值(persist 只落 sizeTier/logoId 两项偏好,其余必须每例重置)。 */
export function resetExportStore(
  overrides: Partial<{ sizeTier: SizeTierKey; logoId: string }> = {}
): void {
  useExportStore.setState({
    files: [],
    styleId: REGISTERED_STYLE_ID,
    sizeTier: overrides.sizeTier ?? "medium",
    logoId: overrides.logoId ?? NO_LOGO_ID,
    customLogoFile: null,
    status: "idle",
    done: 0,
    failedCount: 0,
    total: 0,
    failures: [],
    zipFileName: null,
    error: null
  });
}

// ---------------------------------------------------------------- store 读取 helpers

export function storeFiles(): ExportFileEntry[] {
  return useExportStore.getState().files;
}

export function storeState() {
  return useExportStore.getState();
}

/** 通过子组件替身的 onAdd 往 store 里塞图,并等页面把这批探测完。 */
export async function addFilesThroughPicker(files: File[]): Promise<void> {
  pickerProps<{ onAdd: (picked: readonly File[]) => void }>("image").onAdd(files);
  await Promise.resolve();
}

export { CUSTOM_LOGO_ID, NO_LOGO_ID };
