import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useData } from "../hooks/useData";
import type { SheetMasterColumn, SheetMasterFilter } from "../lib/sheetMasterConfigs";

export type SheetMasterRow = {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
};

export function formatCellValue(value: SheetMasterRow[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function SheetMasterPage({
  title,
  entity,
  columns,
  searchPlaceholder,
  filters = [],
  rowsOverride,
}: {
  title: string;
  entity: string;
  columns: SheetMasterColumn[];
  searchPlaceholder: string;
  filters?: SheetMasterFilter[];
  rowsOverride?: SheetMasterRow[];
}) {
  const [rows] = useData<SheetMasterRow>(entity, []);
  const effectiveRows = rowsOverride || rows;
  const [searchTerm, setSearchTerm] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const filterOptions = useMemo(() => {
    return filters.map((filter) => ({
      ...filter,
      options: Array.from(
        new Set(
          effectiveRows
            .map((row) => String(row[filter.key] ?? "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })),
    }));
  }, [effectiveRows, filters]);

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return effectiveRows.filter((row) => {
      const matchesSearch = !query || columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(query));
      if (!matchesSearch) return false;
      return filters.every((filter) => {
        const selectedValue = String(filterValues[filter.key] || "").trim();
        if (!selectedValue) return true;
        return String(row[filter.key] ?? "").trim() === selectedValue;
      });
    });
  }, [columns, effectiveRows, filterValues, filters, searchTerm]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedRows,
  } = useClientPagination(filteredRows, 25);

  const hasActiveFilters = Boolean(searchTerm.trim()) || filters.some((filter) => String(filterValues[filter.key] || "").trim());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">{title}</h2>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                setFilterValues({});
              }}
              className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-100"
            >
              Clear Filters
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative w-full xl:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-black py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
          {filterOptions.map((filter) => (
            <select
              key={filter.key}
              value={filterValues[filter.key] || ""}
              onChange={(e) => setFilterValues((prev) => ({ ...prev, [filter.key]: e.target.value }))}
              className="w-full rounded border border-black bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            >
              <option value="">All {filter.label}</option>
              {filter.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-black text-sm">
            <thead className="bg-slate-100">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap border border-black px-3 py-2 text-left text-xs font-bold uppercase text-black">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="border border-black px-3 py-8 text-center font-medium italic text-black">
                    No records found.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {columns.map((column) => (
                      <td key={column.key} className="whitespace-nowrap border border-black px-3 py-2 align-top">
                        {formatCellValue(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
