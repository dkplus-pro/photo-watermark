// use-table-query 用例(UI 规范「分页统一全量」的编排逻辑)。
// 边界:total=0;删除末页最后一条后页码越界回退;setPage 负数/0 收敛回 1。
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useTableQuery } from "../../src/hooks/use-table-query";

describe("useTableQuery", () => {
  test("初始态:page=1、pageSize 默认 20、total=0", () => {
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.total).toBe(0);
  });

  test("自定义初始 pageSize", () => {
    const { result } = renderHook(() => useTableQuery({ defaultPageSize: 50 }));
    expect(result.current.pageSize).toBe(50);
  });

  test("pagination props 全量:showTotal / sizeCanChange / sizeOptions / showJumper / pageSizeChangeResetCurrent", () => {
    const { result } = renderHook(() => useTableQuery());
    const { pagination } = result.current;
    expect(pagination.showTotal).toBe(true);
    expect(pagination.sizeCanChange).toBe(true);
    expect(pagination.sizeOptions).toEqual([10, 20, 50, 100]);
    expect(pagination.showJumper).toBe(true);
    expect(pagination.pageSizeChangeResetCurrent).toBe(true);
    expect(pagination.current).toBe(1);
    expect(pagination.total).toBe(0);
  });

  test("pagination.onChange 更新页码与每页数量(翻页)", () => {
    const { result } = renderHook(() => useTableQuery());
    // total=0 时页码恒被收敛到 1,翻页语义需在有效 total 下验证
    act(() => {
      result.current.setTotal(1000);
    });
    act(() => {
      result.current.pagination.onChange?.(3, 100);
    });
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(100);
  });

  test("切 pageSize 时 Arco 按 pageSizeChangeResetCurrent 回调 page=1(重置回第 1 页)", () => {
    const { result } = renderHook(() => useTableQuery());
    act(() => {
      result.current.setTotal(100);
      result.current.pagination.onChange?.(4, 20);
    });
    expect(result.current.page).toBe(4);
    // Arco Pagination 在 size 变化且 reset 开启时以 page=1 回调 onChange
    act(() => {
      result.current.pagination.onChange?.(1, 50);
    });
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
  });

  test("resetPage 回到第 1 页(筛选条件变化)", () => {
    const { result } = renderHook(() => useTableQuery());
    act(() => {
      result.current.setTotal(100);
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);
    act(() => {
      result.current.resetPage();
    });
    expect(result.current.page).toBe(1);
  });

  test("setPage 越界收敛:0 与负数回 1", () => {
    const { result } = renderHook(() => useTableQuery());
    act(() => {
      result.current.setPage(0);
    });
    expect(result.current.page).toBe(1);
    act(() => {
      result.current.setPage(-5);
    });
    expect(result.current.page).toBe(1);
  });

  test("total=0:maxPage 收敛为 1,页码不越界", () => {
    const { result } = renderHook(() => useTableQuery());
    act(() => {
      result.current.setTotal(0);
    });
    expect(result.current.page).toBe(1);
    expect(result.current.pagination.current).toBe(1);
  });

  test("删除末页最后一条后页码越界回退(total 收缩触发 maxPage 收敛)", () => {
    const { result } = renderHook(() => useTableQuery());
    // 共 41 条、每页 20(默认)→ 3 页,当前第 3 页
    act(() => {
      result.current.setTotal(41);
      result.current.setPage(3);
    });
    expect(result.current.page).toBe(3);
    // 删除末页最后一条 → 40 条 → 2 页,页码自动回退
    act(() => {
      result.current.setTotal(40);
    });
    expect(result.current.page).toBe(2);
    expect(result.current.pagination.current).toBe(2);
  });
});
