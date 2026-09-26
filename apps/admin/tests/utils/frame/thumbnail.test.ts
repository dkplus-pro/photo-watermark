import { describe, expect, it } from "vitest";

import { makePhotoThumbnail, thumbnailTargetOf } from "../../../src/utils/frame/thumbnail";
import { THUMBNAIL_LONG_EDGE } from "../../../src/utils/frame/types";

/**
 * 列表缩略图单测(`src/utils/frame/thumbnail.ts`)。
 *
 * 与 preview-render.test.ts 同一处境:jsdom 没有 canvas / `createImageBitmap`,
 * 真渲染不可能,所以断言方式是「喂什么尺寸、算什么目标」:`thumbnailTargetOf` 的
 * 等比算术是「缩略图只缩不放、不把非方形图压变形」这两条硬保证的全部实现,
 * 必须能在不启动渲染的情况下直接钉住;`makePhotoThumbnail` 只测环境与入参守卫
 * (失败一律 null,列表退回原图直显),成功路径靠浏览器 e2e 覆盖。
 *
 * 六类边界对照:空值(sourceSize 为 null)、零值(0 字节文件)、越界(长边远超限值的
 * 极端长条,短边 floor 后不足 1px)、非法状态迁移不适用(纯函数无状态)、
 * 网络失败(环境解不了图 → null)、权限缺失不适用(本站无鉴权)。
 */

const makeFile = (byteLength: number, type = "image/jpeg"): File =>
  new File([new Uint8Array(byteLength)], "photo", { type });

describe("thumbnailTargetOf(等比目标算术)", () => {
  it("空值:源尺寸未知(头部读不出)时不给目标,调用方据此放弃产缩略图", () => {
    expect(thumbnailTargetOf(null)).toBeNull();
  });

  it("长边不超限的图不产缩略图:原图直显已经够小,重编码是白亏画质", () => {
    expect(
      thumbnailTargetOf({ width: THUMBNAIL_LONG_EDGE, height: THUMBNAIL_LONG_EDGE })
    ).toBeNull();
    expect(thumbnailTargetOf({ width: 300, height: 200 })).toBeNull();
  });

  it("横图按长边等比缩,floor 取整", () => {
    expect(thumbnailTargetOf({ width: 4000, height: 3000 })).toEqual({ width: 320, height: 240 });
  });

  it("竖图同样按长边等比缩,宽高角色互换", () => {
    expect(thumbnailTargetOf({ width: 3000, height: 4000 })).toEqual({ width: 240, height: 320 });
  });

  it("越界:极端长条短边 floor 后不足 1px 时按 1px 兜住,不出现 0 尺寸画布", () => {
    expect(thumbnailTargetOf({ width: 10_000, height: 1 })).toEqual({
      width: 320,
      height: 1
    });
  });
});

describe("makePhotoThumbnail(守卫路径)", () => {
  it("空值:源尺寸未知时直接放弃,不碰文件字节", async () => {
    const file = makeFile(2048);

    expect(await makePhotoThumbnail(file, null)).toBeNull();
  });

  it("零值:0 字节文件直接放弃", async () => {
    expect(await makePhotoThumbnail(makeFile(0), { width: 4000, height: 3000 })).toBeNull();
  });

  it("网络失败口径:环境解不了图(无 createImageBitmap)时收敛成 null,不向调用方抛错", async () => {
    // jsdom 没有 createImageBitmap,decodeImageScaled 的守卫会抛中文错误,这里验它被吞成 null。
    const file = makeFile(2048);

    await expect(makePhotoThumbnail(file, { width: 4000, height: 3000 })).resolves.toBeNull();
  });
});
