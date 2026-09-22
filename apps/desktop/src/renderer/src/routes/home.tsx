import { useEffect, useState } from "react";
import { AppController } from "../api/controllers.gen";

type PingState = {
  loading: boolean;
  message: string | null;
  error: string | null;
};

const initialState: PingState = { loading: true, message: null, error: null };

// 首页 = hello world 薄切片(保留链路验收基准):挂载后经 orval 生成物(mutator 链路)
// 调用 /api/app/ping,渲染服务端返回的 message,带 loading 与失败降级;禁止绕过生成物
// 手写请求。页面经 routes/index.tsx 的 React.lazy 懒加载。
export default function Home() {
  const [state, setState] = useState<PingState>(initialState);

  useEffect(() => {
    let active = true;
    AppController.ping()
      .then((result) => {
        if (active) setState({ loading: false, message: result.message, error: null });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            loading: false,
            message: null,
            error: error instanceof Error ? error.message : "请求失败"
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>CMS Desktop</h1>
      {state.loading && <p>加载中…</p>}
      {!state.loading && state.message !== null && <p>{state.message}</p>}
      {!state.loading && state.error !== null && <p>请求失败:{state.error}</p>}
    </main>
  );
}
