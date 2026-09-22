import type { PaginationProps } from "@arco-design/web-react/es/Pagination";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface UseTableQueryOptions {
  /** 初始每页数量,默认 20。 */
  defaultPageSize?: number;
}

interface UseTableQueryResult {
  page: number;
  pageSize: number;
  total: number;
  /** 回到第 1 页(筛选条件变化时调用)。 */
  resetPage: () => void;
  /** 直接改页码(一般不用,分页组件已接管)。 */
  setPage: (page: number) => void;
  /** 直接改每页数量(一般不用,分页组件已接管)。 */
  setPageSize: (pageSize: number) => void;
  /** 同步服务端 total(列表查询成功后调用)。 */
  setTotal: (total: number) => void;
  /** 可直接展开给 Arco Table / Pagination 的全量分页 props(见 docs/admin.md UI 规范)。 */
  pagination: PaginationProps;
}

// 统一分页状态编排(UI 规范见 docs/admin.md):page/pageSize/total/全量 pagination props/重置页码。
// 分页 props 全量 = showTotal + 每页数量切换(10/20/50/100)+ 跳页;切 pageSize 由
// pageSizeChangeResetCurrent 重置回第 1 页。各列表页不再手写分页 state。
export function useTableQuery({
  defaultPageSize = 20
}: UseTableQueryOptions = {}): UseTableQueryResult {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [total, setTotalState] = useState(0);

  // total 收缩(如删除后)时把页码收敛回有效范围,避免停留在空页。
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > maxPage) {
      setPageState(maxPage);
    }
  }, [page, maxPage]);

  const setPage = useCallback((next: number) => setPageState(Math.max(1, next)), []);
  const setPageSize = useCallback((next: number) => setPageSizeState(Math.max(1, next)), []);
  const resetPage = useCallback(() => setPageState(1), []);
  const setTotal = useCallback((next: number) => setTotalState(next), []);

  const safePage = Math.min(page, maxPage);
  const pagination: PaginationProps = {
    total,
    current: safePage,
    pageSize,
    showTotal: true,
    sizeCanChange: true,
    sizeOptions: PAGE_SIZE_OPTIONS,
    showJumper: true,
    pageSizeChangeResetCurrent: true,
    onChange: (nextPage, nextPageSize) => {
      setPageState(nextPage);
      setPageSizeState(nextPageSize);
    }
  };

  return {
    page: safePage,
    pageSize,
    total,
    resetPage,
    setPage,
    setPageSize,
    setTotal,
    pagination
  };
}
