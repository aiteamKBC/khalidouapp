import { useEffect, useState } from "react";

export function useAdminPagination<T>(rows: readonly T[], resetKey = "", initialSize = 10) {
  const [state, setState] = useState({ key: resetKey, page: 1, size: initialSize });
  const pageCount = Math.max(1, Math.ceil(rows.length / state.size));
  useEffect(() => {
    setState((current) => {
      if (current.key !== resetKey) return { ...current, key: resetKey, page: 1 };
      return current.page > pageCount ? { ...current, page: pageCount } : current;
    });
  }, [resetKey, pageCount]);
  const page = Math.min(pageCount, state.key === resetKey ? state.page : 1);
  return {
    items: rows.slice((page - 1) * state.size, page * state.size),
    total: rows.length,
    page,
    pageCount,
    pageSize: state.size,
    onPageChange: (next: number) =>
      setState({ ...state, key: resetKey, page: Math.max(1, Math.min(pageCount, next)) }),
    onPageSizeChange: (size: number) => setState({ key: resetKey, page: 1, size }),
  };
}
