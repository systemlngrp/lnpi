import { KeyboardEvent, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ClientPagination } from "../components/ClientPagination";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { Select } from "../components/Select";
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
  editableColumns = [],
}: {
  title: string;
  entity: string;
  columns: SheetMasterColumn[];
  searchPlaceholder: string;
  filters?: SheetMasterFilter[];
  rowsOverride?: SheetMasterRow[];
  editableColumns?: string[];
}) {
  const [rows, setRows] = useData<SheetMasterRow>(entity, []);
  const effectiveRows = rowsOverride || rows;
  const [searchTerm, setSearchTerm] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const editableColumnSet = useMemo(() => new Set(editableColumns), [editableColumns]);

  const filterOptions = useMemo(() => {
    return filters.map((filter) => {
      const optionMap = new Map<string, { value: string; label: string; searchText?: string }>();

      effectiveRows.forEach((row) => {
        const value = String(row[filter.key] ?? "").trim();
        if (!value || optionMap.has(value)) return;

        const labelParts = (filter.optionLabelKeys || [filter.key])
          .map((key) => String(row[key] ?? "").trim())
          .filter(Boolean);
        const searchParts = [
          ...labelParts,
          ...(filter.optionSearchKeys || []).map((key) => String(row[key] ?? "").trim()),
        ].filter(Boolean);

        optionMap.set(value, {
          value,
          label: labelParts.length ? Array.from(new Set(labelParts)).join(" - ") : value,
          searchText: Array.from(new Set(searchParts)).join(" "),
        });
      });

      return {
        ...filter,
        options: Array.from(optionMap.values()).sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })
        ),
      };
    });
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

  const getCellDraftKey = (rowId: string, columnKey: string) => `${rowId}::${columnKey}`;

  const getDisplayValue = (row: SheetMasterRow, columnKey: string) => {
    const draftKey = getCellDraftKey(row.id, columnKey);
    if (Object.prototype.hasOwnProperty.call(draftValues, draftKey)) {
      return draftValues[draftKey];
    }
    const value = row[columnKey];
    return value === null || value === undefined || value === "" ? "" : String(value);
  };

  const commitEditableCell = async (rowId: string, columnKey: string) => {
    const draftKey = getCellDraftKey(rowId, columnKey);
    if (!Object.prototype.hasOwnProperty.call(draftValues, draftKey)) return;

    const rawValue = draftValues[draftKey].trim();
    const normalizedValue = rawValue === "" ? 0 : Number(rawValue);
    if (!Number.isFinite(normalizedValue)) {
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      return;
    }

    const sourceRow = rows.find((entry) => entry.id === rowId);
    if (!sourceRow) return;
    if (Number(sourceRow[columnKey] || 0) === normalizedValue) {
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      return;
    }

    setSavingCell(draftKey);
    try {
      await setRows((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                [columnKey]: normalizedValue,
              }
            : entry
        )
      );
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
    } finally {
      setSavingCell((current) => (current === draftKey ? null : current));
    }
  };

  const handleEditableKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowId: string, columnKey: string) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      const draftKey = getCellDraftKey(rowId, columnKey);
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      event.currentTarget.blur();
    }
  };

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
          {filterOptions.map((filter) =>
            filter.searchable ? (
              <Select
                key={filter.key}
                value={filterValues[filter.key] || ""}
                onChange={(value) => setFilterValues((prev) => ({ ...prev, [filter.key]: value }))}
                options={filter.options}
                placeholder={`All ${filter.label}`}
              />
            ) : (
              <select
                key={filter.key}
                value={filterValues[filter.key] || ""}
                onChange={(e) => setFilterValues((prev) => ({ ...prev, [filter.key]: e.target.value }))}
                className="w-full rounded border border-black bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
              >
                <option value="">All {filter.label}</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )
          )}
        </div>
      </div>

      <DataSummaryTiles
        totalRecords={effectiveRows.length}
        filteredRecords={filteredRows.length}
        showingRecords={paginatedRows.length}
        pageLabel={`${page} / ${Math.max(1, Math.ceil(totalItems / pageSize))}`}
      />

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <div className="table-sticky-scroll">
          <table className="min-w-full border-collapse border border-black text-sm">
            <thead className="sticky top-0 z-30 bg-slate-100">
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
                  <td colSpan={columns.length + 1} className="border border-black px-3 py-8 text-center font-medium italic text-black">
                    No records found.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {columns.map((column) => {
                      const draftKey = getCellDraftKey(row.id, column.key);
                      const isEditable = editableColumnSet.has(column.key);
                      return (
                        <td key={column.key} className="whitespace-nowrap border border-black px-3 py-2 align-top">
                          {isEditable ? (
                            <input
                              type="number"
                              step="any"
                              value={getDisplayValue(row, column.key)}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [draftKey]: e.target.value,
                                }))
                              }
                              onBlur={() => void commitEditableCell(row.id, column.key)}
                              onKeyDown={(e) => handleEditableKeyDown(e, row.id, column.key)}
                              disabled={savingCell === draftKey}
                              className="w-24 rounded border border-black px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black disabled:bg-slate-100"
                            />
                          ) : (
                            formatCellValue(row[column.key])
                          )}
                        </td>
                      );
                    })}
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
