import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CUSTOM_LOGO_ID, NO_LOGO_ID } from "../../../../../src/store/export";
import type { LogoCatalogEntry } from "../../../../../src/types";

/**
 * logo 选择器用例(阶段 11,选项集合已收拢成 Select 下拉)。
 *
 * 六类边界对照:
 * - 空值:`logos` 为空数组、`source` 为空串(退化成 mark 文字块)、`customFile` 为 null;
 * - 零值:清单只有一项时顺序契约(首「不添加」、末「自定义」)仍然成立;
 * - 越界 / 非法数据:id 撞上 `none` / `custom` 两个哨兵值(会让两个 option 用同一个 value、
 *   选中态互相顶掉)、条目为 null、`logos` 整个不是数组、残留偏好不在合成列表里;
 * - 上游失败:清单装载失败时页面喂空数组,本组件仍要能渲染出「不添加 + 自定义」这两项
 *   (不依赖清单的项),故与「空值」用同一组断言钉住;
 * - 非法状态迁移:`disabled` 期间下拉根本打不开、点自定义入口、点移除都不许回调;
 *   未选中自定义项时不得出现自定义区(否则会拿一个用户没选的上传入口占地方)。
 * - 权限缺失:不适用。本站匿名公开、无鉴权(apps/admin/AGENTS.md 第 3 节),
 *   本层也不发任何请求(用例末尾用 fetch 替身实证了这点)。
 *
 * `assetUrl` 与 `useObjectUrl` 都不打桩:前者是子路径部署下 404 的唯一防线(第 9 节),
 * 后者是 object URL 的「谁创建谁释放」契约(D22),都要看真实实现。
 */

const { assetUrlMock } = vi.hoisted(() => ({
  assetUrlMock: vi.fn((path: string) => `/base/${path}`)
}));

vi.mock("../../../../../src/utils/asset-url", () => ({ assetUrl: assetUrlMock }));

import LogoPicker, {
  type LogoPickerProps
} from "../../../../../src/routes/frames/[styleId]/export/components/logo-picker";

const PRESETS: LogoCatalogEntry[] = [
  { id: "acme", name: "Acme 官方", source: "logos/acme.svg", mark: "ACME" },
  { id: "juzi", name: "芥子", source: "logos/juzi.svg", mark: "JUZI" }
];

const handlers = {
  onChange: vi.fn(),
  onCustomFile: vi.fn(),
  onLogoSizeChange: vi.fn()
};

function renderPicker(overrides: Partial<LogoPickerProps> = {}) {
  const props: LogoPickerProps = {
    logos: PRESETS,
    loading: false,
    value: NO_LOGO_ID,
    customFile: null,
    logoSize: 10,
    disabled: false,
    onChange: handlers.onChange,
    onCustomFile: handlers.onCustomFile,
    onLogoSizeChange: handlers.onLogoSizeChange,
    ...overrides
  };
  return render(<LogoPicker {...props} />);
}

/** 下拉挂在 body(arco Trigger 传送门):先点触发器展开,再从全文档查选项。 */
function openDropdown(container: HTMLElement): void {
  fireEvent.click(container.querySelector(".arco-select-view") as HTMLElement);
}

/** 下拉选项的文本顺序就是合成列表的顺序,这是本组件唯一自己决定的事。 */
function optionTexts(): string[] {
  return Array.from(document.querySelectorAll(".arco-select-option")).map(
    (node) => node.textContent ?? ""
  );
}

function selectedOptionTexts(): string[] {
  return Array.from(document.querySelectorAll('.arco-select-option[aria-selected="true"]')).map(
    (node) => node.textContent ?? ""
  );
}

function optionByText(text: string): HTMLElement {
  const option = Array.from(document.querySelectorAll(".arco-select-option")).find((node) =>
    (node.textContent ?? "").includes(text)
  );
  if (!option) throw new Error(`下拉里没有含「${text}」的选项`);
  return option as HTMLElement;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("没有找到自定义 logo 的 <input type=file>");
  return input as HTMLInputElement;
}

const makeLogoFile = (name = "my-logo.png"): File =>
  new File([new Uint8Array(64)], name, { type: "image/png" });

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  revoked.length = 0;
  let seq = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((source: Blob | MediaSource) => {
    seq += 1;
    const url = `blob:logo-${String(seq)}`;
    created.push(url);
    void source;
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("选项集合与顺序", () => {
  it("首项是「不添加」、末项是「自定义 logo」,中间严格按清单顺序", () => {
    const { container } = renderPicker({ value: "juzi" });
    openDropdown(container);

    expect(optionTexts()).toEqual(["不添加", "Acme 官方", "芥子", "自定义 logo"]);
    expect(selectedOptionTexts()).toEqual(["芥子"]);
  });

  it("零值:清单只有一项时两端契约不变", () => {
    const { container } = renderPicker({ logos: [PRESETS[0]] });
    openDropdown(container);

    expect(optionTexts()).toEqual(["不添加", "Acme 官方", "自定义 logo"]);
  });

  it("空值:清单为空(装载失败喂空数组)时仍给得出「不添加 + 自定义」,不会只剩一个光杆选项", () => {
    const { container } = renderPicker({ logos: [] });
    openDropdown(container);

    expect(optionTexts()).toEqual(["不添加", "自定义 logo"]);
    expect(container.querySelector(".arco-select-view")).not.toBeNull();
  });

  it("越界:id 撞上两个哨兵值、条目为 null、缺 id 的脏数据一律丢掉,不允许两个 option 共用 value", () => {
    const dirty = [
      null,
      { id: "", name: "空 id", source: "logos/x.svg", mark: "X" },
      { id: NO_LOGO_ID, name: "撞车的不添加", source: "logos/y.svg", mark: "Y" },
      { id: CUSTOM_LOGO_ID, name: "撞车的自定义", source: "logos/z.svg", mark: "Z" },
      PRESETS[0]
    ] as unknown as LogoCatalogEntry[];

    const { container } = renderPicker({ logos: dirty });
    openDropdown(container);
    const texts = optionTexts();

    expect(texts).toEqual(["不添加", "Acme 官方", "自定义 logo"]);
    expect(screen.queryByText("撞车的不添加")).toBeNull();
  });

  it("非法数据:logos 整个不是数组时按空清单渲染而不是抛错", () => {
    const { container } = renderPicker({ logos: null as unknown as LogoCatalogEntry[] });
    openDropdown(container);

    expect(optionTexts()).toEqual(["不添加", "自定义 logo"]);
  });

  it("展示名缺失时回落 mark、再回落 id,不给用户看空白标签", () => {
    const { container } = renderPicker({
      logos: [
        { id: "only-mark", name: "", source: "logos/m.svg", mark: "MARK" },
        { id: "only-id", name: "", source: "", mark: "" }
      ]
    });
    openDropdown(container);

    // 第一项 name 空 → 用 mark;第二项 name/mark 都空 → 用 id,总之标签不为空。
    expect(screen.getByText("MARK")).toBeInTheDocument();
    expect(screen.getByText("only-id")).toBeInTheDocument();
  });

  it("装载中只出骨架:选项还没成形时不渲染触发器,免得用户点到一个待会儿会消失的 id", () => {
    const { container } = renderPicker({ loading: true });

    expect(container.querySelector(".arco-select-view")).toBeNull();
    expect(container.querySelector(".arco-skeleton")).not.toBeNull();
  });
});

describe("预设图", () => {
  it("预设图路径必须过 assetUrl:子路径部署下裸 /logos/... 必 404", () => {
    const { container } = renderPicker();
    openDropdown(container);
    const srcs = Array.from(document.querySelectorAll("img")).map(
      (node) => node.getAttribute("src") ?? ""
    );

    expect(srcs).toEqual(["/base/logos/acme.svg", "/base/logos/juzi.svg"]);
    expect(assetUrlMock).toHaveBeenCalledWith("logos/acme.svg");
  });

  it("空值:source 为空串的条目不渲染坏图,退化成 mark 文字块", () => {
    const { container } = renderPicker({
      logos: [{ id: "text-only", name: "纯文字", source: "", mark: "TXT" }]
    });
    openDropdown(container);

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".logo-picker-preview--mark")?.textContent).toBe("TXT");
  });
});

describe("选中回调", () => {
  it("点预设项只回 id,不夹带任何别的东西", () => {
    const { container } = renderPicker();
    openDropdown(container);

    fireEvent.click(optionByText("Acme 官方"));
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
    expect(handlers.onChange).toHaveBeenCalledWith("acme");
  });

  it("点「自定义 logo」即切到自定义项,此时才长出图片入口", () => {
    const { container } = renderPicker({ value: "acme" });

    expect(container.querySelector(".logo-picker-custom")).toBeNull();
    openDropdown(container);
    fireEvent.click(optionByText("自定义 logo"));
    expect(handlers.onChange).toHaveBeenCalledWith(CUSTOM_LOGO_ID);
  });

  it("越界:清单换版本后残留的旧偏好(不在合成列表里)不选中任何项,也不报错", () => {
    const { container } = renderPicker({ value: "removed-in-new-catalog" });
    openDropdown(container);

    expect(optionTexts()).toHaveLength(4);
    expect(selectedOptionTexts()).toEqual([]);
  });

  it("disabled 期间下拉打不开、点选项无从发生,导出进行中列表不能中途变", () => {
    const { container } = renderPicker({ disabled: true });

    openDropdown(container);
    expect(container.querySelector(".arco-select-disabled")).not.toBeNull();
    expect(optionTexts()).toEqual([]);
    expect(handlers.onChange).not.toHaveBeenCalled();
  });
});

describe("搜索过滤", () => {
  /** 展开后往触发器的搜索 input 里打字(arco 由此驱动过滤)。 */
  async function search(container: HTMLElement, keyword: string): Promise<string[]> {
    const input = container.querySelector(".arco-select-view-input") as HTMLInputElement | null;
    if (!input) throw new Error("showSearch 开着却找不到搜索输入框");
    await act(async () => {
      fireEvent.change(input, { target: { value: keyword } });
    });
    return optionTexts();
  }

  it("按展示名过滤:富内容的预设项(图 + 名)也能被名字命中,大小写不敏感", async () => {
    const { container } = renderPicker();
    openDropdown(container);

    expect(await search(container, "ACME")).toEqual(["Acme 官方"]);
  });

  it("两个哨兵项用同一句人话参与搜索,不留「搜不到首末项」的死角", async () => {
    const { container } = renderPicker();
    openDropdown(container);

    expect(await search(container, "添加")).toEqual(["不添加"]);
    expect(await search(container, "自定义")).toEqual(["自定义 logo"]);
  });

  it("空关键字不过滤;过滤后点剩下的选项照样回正确的 id", async () => {
    const { container } = renderPicker();
    openDropdown(container);

    expect(await search(container, "  ")).toEqual(["不添加", "Acme 官方", "芥子", "自定义 logo"]);
    fireEvent.click(optionByText("芥子"));
    expect(handlers.onChange).toHaveBeenCalledWith("juzi");
  });
});

describe("自定义 logo 一条闭环", () => {
  it("未选自定义时不出现自定义区,哪怕已经带着一个文件", () => {
    const { container } = renderPicker({ value: "acme", customFile: makeLogoFile() });

    // 自定义区不出现;文件仍被 hook 持有一条 URL(切到自定义项时立刻能显示),
    // 它的释放点在「换图」与「卸载」两条路径上,下面各自有一例。
    expect(container.querySelector(".logo-picker-custom")).toBeNull();
    expect(created).toEqual(["blob:logo-1"]);
    expect(revoked).toEqual([]);
  });

  it("选自定义 + 没图:给上传入口与「还没选图」的说明,而不是空白一块", () => {
    const { container } = renderPicker({ value: CUSTOM_LOGO_ID });

    expect(container.querySelector(".logo-picker-custom")).not.toBeNull();
    expect(screen.getByRole("button", { name: /选择 logo 图片/u })).toBeInTheDocument();
    expect(screen.getByText(/还没有选择自定义图片/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /移除/u })).toBeNull();
  });

  it("挑一张图:只回一次 onCustomFile;页面把文件写回来后文件名与预览才出现", async () => {
    const { container, rerender } = renderPicker({ value: CUSTOM_LOGO_ID });
    const file = makeLogoFile("brand.png");

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    // arco 的默认 beforeUpload 返回 Promise,onChange 落在微任务里。
    await waitFor(() => expect(handlers.onCustomFile).toHaveBeenCalledTimes(1));
    expect(handlers.onCustomFile.mock.calls[0][0]).toBe(file);
    // 本组件是受控件:customFile 由页面喂回来,所以这一段验的是「喂回来就显示」。
    expect(screen.queryByText("brand.png")).toBeNull();

    rerender(
      <LogoPicker
        logos={PRESETS}
        loading={false}
        value={CUSTOM_LOGO_ID}
        customFile={file}
        logoSize={10}
        disabled={false}
        onChange={handlers.onChange}
        onCustomFile={handlers.onCustomFile}
        onLogoSizeChange={handlers.onLogoSizeChange}
      />
    );
    expect(screen.getByText("brand.png")).toBeInTheDocument();
    expect(container.querySelector(".logo-picker-custom img")?.getAttribute("src")).toBe(
      "blob:logo-1"
    );
  });

  it("已选图:预览用 object URL 显示,点移除把 null 交回上层", () => {
    const { container } = renderPicker({
      value: CUSTOM_LOGO_ID,
      customFile: makeLogoFile("b.png")
    });

    expect(created).toEqual(["blob:logo-1"]);
    // 预设项的图在下拉里(未展开时不挂载),所以自定义区这一张就是全部。
    expect(container.querySelector(".logo-picker-custom img")?.getAttribute("src")).toBe(
      "blob:logo-1"
    );
    expect(revoked).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /移除/u }));
    expect(handlers.onCustomFile).toHaveBeenCalledTimes(1);
    expect(handlers.onCustomFile).toHaveBeenCalledWith(null);
  });

  it("URL 生成失败(隐私模式/配额)时这一项退化成文字块,上传入口与移除照样能用", () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("quota");
    });
    const { container } = renderPicker({
      value: CUSTOM_LOGO_ID,
      customFile: makeLogoFile()
    });

    expect(container.querySelector(".logo-picker-custom img")).toBeNull();
    expect(
      container.querySelector(".logo-picker-custom .logo-picker-preview--mark")
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /移除/u })).toBeEnabled();
  });

  it("换一张图时上一条 URL 被回收、卸载时回收当前这条,全程不在渲染中同步 revoke(D22)", () => {
    const { rerender, unmount } = renderPicker({
      customFile: makeLogoFile("a.png"),
      value: CUSTOM_LOGO_ID
    });
    expect(created).toEqual(["blob:logo-1"]);

    rerender(
      <LogoPicker
        logos={PRESETS}
        loading={false}
        value={CUSTOM_LOGO_ID}
        customFile={makeLogoFile("b.png")}
        logoSize={10}
        disabled={false}
        onChange={handlers.onChange}
        onCustomFile={handlers.onCustomFile}
        onLogoSizeChange={handlers.onLogoSizeChange}
      />
    );
    expect(created).toEqual(["blob:logo-1", "blob:logo-2"]);
    expect(revoked).toEqual(["blob:logo-1"]);

    unmount();
    expect(revoked).toEqual(["blob:logo-1", "blob:logo-2"]);
  });

  it("disabled 时移除按钮禁用、点它不改状态", () => {
    renderPicker({
      value: CUSTOM_LOGO_ID,
      customFile: makeLogoFile(),
      disabled: true
    });

    fireEvent.click(screen.getByRole("button", { name: /移除/u }), { pointerEventsCheck: 0 });
    expect(handlers.onCustomFile).not.toHaveBeenCalled();
  });

  it("disabled 且没图时入口按钮是灰的,直接喂 input 也不回调", async () => {
    const { container } = renderPicker({ value: CUSTOM_LOGO_ID, disabled: true });

    // arco 的 disabled 不删隐藏 input(浏览器仍可能把文件塞进来),所以这条要验到回调层。
    const trigger = screen.getByRole("button", { name: /选择 logo 图片/u });
    fireEvent.click(trigger);
    // 派发要包在 act 里:arco 收到 change 后会 setState(它自己的内部列表),不包就是 act 警告。
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [makeLogoFile("c.png")] } });
    });

    expect(trigger.className).toContain("arco-btn-disabled");
    expect(handlers.onCustomFile).not.toHaveBeenCalled();
    expect(screen.getByText(/还没有选择自定义图片/u)).toBeInTheDocument();
  });

  it("选图全程不发请求:本站没有服务端,logo 也只留在内存", async () => {
    const { container } = renderPicker({ value: CUSTOM_LOGO_ID });
    fireEvent.change(fileInput(container), { target: { files: [makeLogoFile()] } });
    await waitFor(() => expect(handlers.onCustomFile).toHaveBeenCalledTimes(1));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("logo大小滑杆", () => {
  it("给出「logo大小」标签与 5–10 的带刻度滑杆,右侧回显当前档位", () => {
    const { container } = renderPicker({ logoSize: 7 });

    expect(screen.getByText("logo大小")).toBeInTheDocument();
    expect(container.querySelector(".arco-slider")).not.toBeNull();
    // showTicks:整数档位的刻度线必须真的渲染出来,滑杆才是「档位选择」而不是连续量。
    expect(container.querySelector(".arco-slider-ticks")).not.toBeNull();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("受控件:value 完全由页面喂,档位不变时不重复回调", () => {
    const { rerender, container } = renderPicker({ logoSize: 7 });
    const first = container.querySelector(".arco-slider");

    rerender(
      <LogoPicker
        logos={PRESETS}
        loading={false}
        value={NO_LOGO_ID}
        customFile={null}
        logoSize={7}
        disabled={false}
        onChange={handlers.onChange}
        onCustomFile={handlers.onCustomFile}
        onLogoSizeChange={handlers.onLogoSizeChange}
      />
    );
    expect(handlers.onLogoSizeChange).not.toHaveBeenCalled();
    expect(container.querySelector(".arco-slider")).toBe(first);
  });
});
