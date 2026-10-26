import type { useAdminPagination } from "./useAdminPagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = ReturnType<typeof useAdminPagination> & { label: string };

export function AdminPagination({
  total,
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label,
}: Props) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <nav className="admin-pagination" aria-label={`${label} pagination`}>
      <p aria-live="polite">
        {start}–{end} of {total} {label.toLowerCase()}
      </p>
      <div className="admin-pagination-controls">
        <label>
          Rows{" "}
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label={`${label} rows per page`}
          >
            {[10, 15, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={`Previous ${label.toLowerCase()} page`}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span>
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label={`Next ${label.toLowerCase()} page`}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
