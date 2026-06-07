import React from "react";

type ClientPaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
};

export function ClientPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 250],
}: ClientPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = totalItems === 0 ? 0 : Math.min(totalItems, safePage * pageSize);

  return (
    <div className="flex flex-col gap-3 border border-black bg-slate-50 px-3 py-3 md:flex-row md:items-center md:justify-between">
      <div className="text-sm font-medium text-black">
        Showing {start}-{end} of {totalItems}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-black">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded border border-black bg-white px-2 py-1 text-sm"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="rounded border border-black bg-white px-3 py-1 text-sm font-bold text-black disabled:opacity-50"
        >
          Prev
        </button>
        <span className="min-w-[88px] text-center text-sm font-bold text-black">
          Page {safePage} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="rounded border border-black bg-white px-3 py-1 text-sm font-bold text-black disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
