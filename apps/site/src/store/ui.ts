import { create } from "zustand";

// 客户端全局 UI 状态(见 docs/site.md「状态管理」):
// 服务端数据(站点信息等)一律走 loader,不进 zustand;这里只放跨组件的交互态。
interface UiState {
  /** 移动端导航抽屉开合 */
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen }))
}));
