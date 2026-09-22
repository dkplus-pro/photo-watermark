import { create } from "zustand";
import { persist } from "zustand/middleware";

// 壳层 UI 状态(客户端全局态,分区约定见 AGENTS.md 规则 7):只放跨组件的交互偏好,
// 服务端数据与本站无关,不进 store。
export interface UiState {
  /** 桌面侧栏整栏折叠,属用户偏好,持久化到本地 */
  siderCollapsed: boolean;
  /** 移动端导航抽屉开合,一次性交互态,不持久化 */
  mobileNavOpen: boolean;
  toggleSider: () => void;
  setMobileNavOpen: (open: boolean) => void;
}

// 组件外读写(事件回调、渲染函数之外)统一走 useUiStore.getState()。
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      siderCollapsed: false,
      mobileNavOpen: false,
      toggleSider: () => set((state) => ({ siderCollapsed: !state.siderCollapsed })),
      // 同值写入直接返回原 state:zustand 以引用相等判定是否通知订阅者,
      // 从而保证重复 setMobileNavOpen(false) 不产生多余渲染。
      setMobileNavOpen: (open) =>
        set((state) => (state.mobileNavOpen === open ? state : { mobileNavOpen: open }))
    }),
    {
      name: "watermark-frame.ui",
      partialize: (state) => ({ siderCollapsed: state.siderCollapsed })
    }
  )
);
