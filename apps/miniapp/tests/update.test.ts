// 更新检查边界(方案 docs/hybrid-capability-plan.md 卡 5.4;
// 六类边界:空值/零值/越界/权限缺失(环境与能力门控等价)/网络失败/非法状态迁移)。
// 宿主 fake:回调落袋,用例手动触发。
import { describe, expect, it, vi } from "vitest";

import {
  checkUpdate,
  UPDATE_MODAL_CANCEL_TEXT,
  UPDATE_MODAL_CONFIRM_TEXT,
  UPDATE_MODAL_CONTENT,
  UPDATE_MODAL_TITLE,
  type UpdateHost,
  type UpdateManagerLike
} from "../src/core/update";

/** 可编程宿主 fake:记录注册的回调并暴露 applyUpdate 调用数。 */
function createHost() {
  const callbacks: { ready?: () => void; failed?: () => void } = {};
  const applyUpdate = vi.fn();
  const showModal = vi.fn();
  const getUpdateManager = vi.fn((): UpdateManagerLike => ({
    onUpdateReady: (callback) => {
      callbacks.ready = callback;
    },
    onUpdateFailed: (callback) => {
      callbacks.failed = callback;
    },
    applyUpdate
  }));
  const host: UpdateHost = { getUpdateManager, showModal };
  return { host, callbacks, applyUpdate, showModal, getUpdateManager };
}

describe("checkUpdate(更新检查)", () => {
  it("UP1 dev 环境直接跳过,不读宿主(权限缺失等价)", () => {
    const { host, getUpdateManager } = createHost();
    expect(checkUpdate({ host, env: "dev" })).toBe("skipped_dev");
    expect(getUpdateManager).not.toHaveBeenCalled();
  });

  it("UP2 宿主缺失:无 getUpdateManager / host undefined 均 unavailable 不抛(空值)", () => {
    expect(checkUpdate({ host: {}, env: "prod" })).toBe("unavailable");
    expect(checkUpdate({ host: undefined, env: "prod" })).toBe("unavailable");
  });

  it("UP3 canIUse 否定:能力不授权即降级(权限缺失)", () => {
    const { host, getUpdateManager } = createHost();
    expect(checkUpdate({ host: { ...host, canIUse: () => false }, env: "prod" })).toBe(
      "unavailable"
    );
    expect(getUpdateManager).not.toHaveBeenCalled();
  });

  it("UP4 getUpdateManager 抛错/返回空:降级不抛(空值)", () => {
    const throwing: UpdateHost = {
      getUpdateManager: () => {
        throw new Error("boom");
      }
    };
    expect(() => checkUpdate({ host: throwing, env: "prod" })).not.toThrow();
    expect(checkUpdate({ host: throwing, env: "prod" })).toBe("unavailable");
    expect(checkUpdate({ host: { getUpdateManager: () => undefined }, env: "prod" })).toBe(
      "unavailable"
    );
  });

  it("UP5 更新就绪:锁定文案四件套 + showCancel,确认后 applyUpdate", () => {
    const { host, callbacks, applyUpdate, showModal } = createHost();
    expect(checkUpdate({ host, env: "prod" })).toBe("registered");

    callbacks.ready?.();
    expect(showModal).toHaveBeenCalledTimes(1);
    const options = showModal.mock.calls[0][0];
    expect(options).toMatchObject({
      title: UPDATE_MODAL_TITLE,
      content: UPDATE_MODAL_CONTENT,
      confirmText: UPDATE_MODAL_CONFIRM_TEXT,
      cancelText: UPDATE_MODAL_CANCEL_TEXT,
      showCancel: true
    });
    expect(UPDATE_MODAL_TITLE).toBe("更新提示");
    expect(UPDATE_MODAL_CONTENT).toBe("新版本已准备好,是否重启应用?");
    expect(UPDATE_MODAL_CONFIRM_TEXT).toBe("重启");
    expect(UPDATE_MODAL_CANCEL_TEXT).toBe("取消");

    expect(applyUpdate).not.toHaveBeenCalled();
    options.success?.({ confirm: true });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("UP6 用户取消:不应用更新(非法状态迁移)", () => {
    const { host, callbacks, applyUpdate, showModal } = createHost();
    checkUpdate({ host, env: "prod" });
    callbacks.ready?.();
    showModal.mock.calls[0][0].success?.({ confirm: false });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("UP7 无 showModal 能力:直接应用更新(空值)", () => {
    const { callbacks, applyUpdate, getUpdateManager } = createHost();
    const host: UpdateHost = { getUpdateManager };
    checkUpdate({ host, env: "prod" });
    callbacks.ready?.();
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("UP8 下载失败:回调透传给调用方(网络失败)", () => {
    const { host, callbacks } = createHost();
    const onUpdateFailed = vi.fn();
    expect(checkUpdate({ host, env: "prod", onUpdateFailed })).toBe("registered");
    callbacks.failed?.();
    expect(onUpdateFailed).toHaveBeenCalledTimes(1);
  });

  it("UP9 test/prod 不跳过(环境门控)", () => {
    const { host } = createHost();
    expect(checkUpdate({ host, env: "test" })).toBe("registered");
    expect(checkUpdate({ host, env: "prod" })).toBe("registered");
  });

  it("UP10 manager 缺回调方法:仍 registered 不抛(空值)", () => {
    const host: UpdateHost = { getUpdateManager: () => ({}) };
    expect(checkUpdate({ host, env: "prod" })).toBe("registered");
  });
});
