// SiteImage 图片包装语义(阶段 5.2 壳约定 + 任务卡 6.1):默认懒加载(lazy)+ 异步解码
// (async)+ 显式尺寸防布局抖动;首屏关键图显式传 eager 时切换为同步加载。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteImage } from "../../src/components/site-image";

describe("SiteImage 图片包装", () => {
  it("默认懒加载:loading=lazy + decoding=async,尺寸/alt/className 透传", () => {
    render(
      <SiteImage
        src="https://cdn.example.com/cover.png"
        alt="封面图"
        width={320}
        height={200}
        className="site-cover"
      />
    );
    const img = screen.getByRole("img", { name: "封面图" });
    expect(img).toHaveAttribute("src", "https://cdn.example.com/cover.png");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width", "320");
    expect(img).toHaveAttribute("height", "200");
    expect(img).toHaveClass("site-cover");
  });

  it("eager 显式开启:首屏关键图 loading=eager,其余语义不变", () => {
    render(
      <SiteImage src="https://cdn.example.com/logo.png" alt="站标" width={48} height={48} eager />
    );
    const img = screen.getByRole("img", { name: "站标" });
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("decoding", "async");
  });
});
