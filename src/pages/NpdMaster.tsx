import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Download } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { useAutoRefreshEffect } from "../hooks/useAutoRefresh";
import { useData } from "../hooks/useData";
import { findLinkedItemByErp } from "../lib/linkedLoading";
import { NPD_COLUMNS } from "../lib/npdCardConfig";
import { downloadNpdCardPdf } from "../lib/npdCardPdf";
import { normalizeOrderCatalogItem } from "../lib/orderItems";
import { calculateInternalRapc, calculateInternalUps } from "../lib/internalUps";
import type { Setting } from "../types";

type NpdRecord = {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
};

type RowSaveState = {
  status: "saving" | "success" | "error";
  message: string;
};

function getHeaderLines(label: string) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 2) {
    lines.push(words.slice(i, i + 2).join(" "));
  }
  return lines;
}

function isConsumableValue(value: NpdRecord[string]) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;

  return new Set(["1", "true", "yes", "y", "on"]).has(normalized);
}

function formatCellValue(value: NpdRecord[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatStockValue(rate: NpdRecord[string], balance: NpdRecord[string]) {
  const rateNumber = Number(rate);
  const balanceNumber = Number(balance);
  if (!Number.isFinite(rateNumber) || !Number.isFinite(balanceNumber)) return "-";
  return (rateNumber * balanceNumber).toFixed(2);
}

export function NpdMaster() {
  const [rows, setRows] = useState<NpdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [consumableDrafts, setConsumableDrafts] = useState<Record<string, boolean>>({});
  const [savingRowIds, setSavingRowIds] = useState<Record<string, boolean>>({});
  const [rowSaveStates, setRowSaveStates] = useState<Record<string, RowSaveState>>({});
  const [phpRows] = useData<any>("php_item_master", []);
  const [plateRows] = useData<any>("plate_item_master", []);
  const [settings] = useData<Setting>("settings", []);

  const tableColumns = useMemo(
    () => [...NPD_COLUMNS, { key: "consumable", label: "Consumable" }],
    []
  );

  const phpItems = useMemo(
    () => phpRows.map((row) => normalizeOrderCatalogItem(row, "PHP")).filter(Boolean),
    [phpRows]
  );
  const plateItems = useMemo(
    () => plateRows.map((row) => normalizeOrderCatalogItem(row, "PLATE")).filter(Boolean),
    [plateRows]
  );

  const loadRows = useCallback(
    async (showLoader = true, customSearchTerm = searchTerm) => {
      try {
        if (showLoader) setLoading(true);

        const token = window.localStorage.getItem("authToken") || "";
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (customSearchTerm) params.set("search", customSearchTerm);
        params.set("status", "all");

        const response = await fetch(`/api/npd?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error("Failed to fetch NPD rows.");
        }
        const result = await response.json();
        const nextRows = Array.isArray(result.rows) ? result.rows : [];

        setRows(nextRows);
        setTotal(Number(result.total || 0));
        setConsumableDrafts((previous) => {
          const next = { ...previous };
          for (const row of nextRows) {
            if (row?.id) {
              next[String(row.id)] = isConsumableValue(row.consumable);
            }
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to fetch NPD rows:", error);
        if (showLoader || !page) {
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (showLoader) setLoading(false);
      }
    },
    [page, pageSize, searchTerm]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchTerm(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useAutoRefreshEffect(() => {
    void loadRows(false, searchTerm);
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageLabel = useMemo(() => {
    if (total === 0) return "0 records";
    if (totalPages <= 1) return `${rows.length} of ${total} records`;
    const start = (page - 1) * pageSize + 1;
    const end = rows.length > 0 ? start + rows.length - 1 : start;
    return `${start}-${Math.min(total, end)} of ${total}`;
  }, [page, pageSize, rows.length, total, totalPages]);

  const handleDownloadCard = async (row: NpdRecord) => {
    setDownloadingId(row.id);
    try {
      const normalizedNpd = normalizeOrderCatalogItem(row, "FG");
      const erpCode = normalizedNpd?.erp || String(row.erp || "").trim();
      const linkedPhp = findLinkedItemByErp(phpItems as any, erpCode);
      const linkedPlate = findLinkedItemByErp(plateItems as any, erpCode);
      await downloadNpdCardPdf({
        npdRow: row,
        phpRow: (linkedPhp?.raw as Record<string, string | number | boolean | null | undefined>) || null,
        plateRow: (linkedPlate?.raw as Record<string, string | number | boolean | null | undefined>) || null,
        setting: settings[0] || null,
      });
    } catch (error) {
      console.error("Failed to download NPD card:", error);
      alert("Failed to download NPD card. Please check console for details.");
    } finally {
      setDownloadingId(null);
    }
  };

  const setConsumableDraft = (id: string, value: boolean) => {
    setConsumableDrafts((prev) => ({ ...prev, [id]: value }));
    setRowSaveStates((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      if (next[id]?.status !== "saving") delete next[id];
      return next;
    });
  };

  const handleUpdateConsumable = async (row: NpdRecord) => {
    const id = String(row.id || "").trim();
    if (!id) return;

    const payload = {
      id,
      erp: String(row.erp || "").trim(),
      consumable: isConsumableValue(consumableDrafts[id]),
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    };

    setSavingRowIds((prev) => ({ ...prev, [id]: true }));
    setRowSaveStates((prev) => ({ ...prev, [id]: { status: "saving", message: "Saving..." } }));

    try {
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/npd", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save consumable state.");
      }

      setRowSaveStates((prev) => ({ ...prev, [id]: { status: "success", message: "Saved" } }));
      await loadRows(false);
      setTimeout(() => {
        setRowSaveStates((current) => {
          if (current[id]?.status !== "success") return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      }, 2000);
    } catch (error) {
      console.error("Failed to save NPD consumable:", error);
      setRowSaveStates((prev) => ({ ...prev, [id]: { status: "error", message: (error as Error).message || "Failed" } }));
    } finally {
      setSavingRowIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">NPD Items</h2>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search NPD, customer, item, PO..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded border border-black py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      <DataSummaryTiles
        totalRecords={total}
        filteredRecords={total}
        showingRecords={rows.length}
        pageLabel={`${page} / ${totalPages}`}
      />

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-black bg-slate-50 px-4 py-3 text-sm font-semibold text-black md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {loading ? <Spinner size={18} /> : null}
            <span>{loading ? "Loading NPD items..." : pageLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-black uppercase">
              Rows
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(1);
                  setPageSize(Number(e.target.value));
                }}
                disabled={loading}
                className="rounded border border-black bg-white px-2 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {[50, 100, 250, 500].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={loading || page <= 1}
                className="rounded border border-black px-3 py-1 text-xs font-bold uppercase disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <span className="min-w-[90px] text-center text-xs font-black uppercase">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={loading || page >= totalPages}
                className="rounded border border-black px-3 py-1 text-xs font-bold uppercase disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
          </div>
        </div>

        <div className="table-sticky-scroll">
          <table className="min-w-max divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black sticky top-0 z-10">
              <tr className="divide-x divide-black">
                <th className="border border-black px-3 py-3 text-right text-xs font-bold uppercase text-black align-top min-w-[72px] whitespace-nowrap">SL No</th>
                {tableColumns.map((column) => (
                  <th key={column.key} className="border border-black px-3 py-3 text-left text-xs font-bold uppercase text-black align-top min-w-[92px] max-w-[180px] whitespace-normal break-words">
                    <span className="block leading-4">
                      {getHeaderLines(column.label).map((line, index) => (
                        <span key={`${column.key}-${index}`} className="block">
                          {line}
                        </span>
                      ))}
                    </span>
                  </th>
                ))}
                <th className="border border-black px-3 py-3 text-left text-xs font-bold uppercase text-black align-top min-w-[180px] whitespace-nowrap">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {loading ? (
                <tr>
                  <td colSpan={tableColumns.length + 2} className="px-6 py-12">
                    <div className="flex items-center justify-center gap-3 text-black">
                      <Spinner size={28} />
                      <span className="font-semibold">Loading NPD items...</span>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={tableColumns.length + 2} className="px-6 py-8 text-center font-medium italic text-black">
                    No NPD records found.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const hasConsumableChanges = isConsumableValue(consumableDrafts[row.id]) !== isConsumableValue(row.consumable);
                  const isSaving = Boolean(savingRowIds[row.id]);
                  const rowState = rowSaveStates[row.id];

                  return (
                    <tr key={row.id} className="divide-x divide-black transition-colors hover:bg-slate-50">
                      <td className="border border-black px-3 py-3 text-right text-sm font-bold text-black align-top whitespace-nowrap">
                        {(page - 1) * pageSize + index + 1}
                      </td>
                      {tableColumns.map((column) => {
                        const isWrappedText = column.key === "itemName" || column.key === "customerName";
                        const rawValue =
                          column.key === "stockValue"
                            ? formatStockValue(row.rate, row.balance)
                            : column.key === "internalUps"
                              ? row.internalUps ?? calculateInternalUps(row.rapcForSingleBox)
                            : column.key === "internalRapc"
                              ? row.internalRapc ?? calculateInternalRapc(row as any)
                            : column.key === "consumable"
                              ? isConsumableValue(consumableDrafts[row.id])
                              : row[column.key];

                        return (
                          <td
                            key={column.key}
                            className={`border border-black px-3 py-3 text-sm text-black align-top ${
                              isWrappedText
                                ? "whitespace-normal break-words min-w-[240px] max-w-[320px]"
                                : "whitespace-nowrap"
                            }`}
                          >
                            {column.key === "consumable" ? (
                              <label className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rawValue)}
                                  onChange={(event) => setConsumableDraft(row.id, event.target.checked)}
                                />
                                <span className="text-xs font-bold">{Boolean(rawValue) ? "Yes" : "No"}</span>
                              </label>
                            ) : column.key === "url" ? (
                              rawValue ? (
                                <button
                                  type="button"
                                  onClick={() => window.open(String(rawValue), "_blank", "noopener,noreferrer")}
                                  className="rounded bg-indigo-600 px-3 py-1 font-bold text-white hover:bg-indigo-700"
                                >
                                  Open
                                </button>
                              ) : (
                                "-"
                              )
                            ) : (
                              formatCellValue(rawValue)
                            )}
                          </td>
                        );
                      })}
                      <td className="border border-black px-3 py-3 text-sm text-black align-top">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDownloadCard(row)}
                            disabled={downloadingId === row.id}
                            className="inline-flex items-center gap-2 rounded border border-black bg-white px-3 py-2 text-xs font-bold uppercase hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {downloadingId === row.id ? <Spinner size={14} /> : <Download size={14} />}
                            Download Card
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdateConsumable(row)}
                            disabled={isSaving || !hasConsumableChanges}
                            className="rounded border border-black bg-black px-3 py-2 text-xs font-bold uppercase text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving ? <Spinner size={12} /> : "Update"}
                          </button>
                          {rowState ? (
                            <span
                              className={`text-[11px] font-bold ${
                                rowState.status === "success"
                                  ? "text-green-700"
                                  : rowState.status === "error"
                                    ? "text-red-700"
                                    : "text-slate-500"
                              }`}
                            >
                              {rowState.message}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
