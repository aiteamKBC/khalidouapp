export function paginateRows<T>(rows: T[], requestedPage: number, pageSize: number) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), totalPages - 1);
  const start = page * safePageSize;
  const end = Math.min(start + safePageSize, rows.length);

  return {
    rows: rows.slice(start, end),
    page,
    totalPages,
    start,
    end,
  };
}
