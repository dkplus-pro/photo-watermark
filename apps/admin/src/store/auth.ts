import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { UserInfo } from "../api/generated/cMSAdminAPI.schemas";
import { TOKEN_STORAGE_KEY } from "../constants";

interface AuthState {
  /** JWT,登录后写入;登出/过期清空(持久化到 localStorage,见 persist.name)。 */
  token: string | null;
  /** 当前用户信息,来自 /auth/me;仅会话内保留,刷新后经查询恢复。 */
  user: UserInfo | null;
  setAuth: (token: string, user: UserInfo | null) => void;
  setUser: (user: UserInfo | null) => void;
  clear: () => void;
}

// 客户端全局状态:认证信息。规范见 docs/admin.md——每个领域一个文件,命名 useXxxStore。
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null })
    }),
    {
      name: TOKEN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 只持久化 token;user 属于服务端状态,刷新后经 /auth/me 恢复。
      partialize: (state) => ({ token: state.token })
    }
  )
);
