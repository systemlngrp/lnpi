import React, { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useData } from "../hooks/useData";
import type {
  Company,
  Item,
  MaterialIssue,
  MaterialIssueLine,
  MaterialReturn,
  MaterialReturnLine,
  Order,
  OrderSchedule,
  Production,
} from "../types";
import { TableControls } from "../components/TableControls";
import { ExcelExport } from "../components/ExcelExport";
import { formatDate } from "../lib/serial";
import { exportsAllowed } from "../lib/exportPolicy";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";
import { cn } from "../lib/utils";

type ColumnId =
  | "status"
  | "lotNo"
  | "partyName"
  | "itemName"
  | "erpCode"
  | "type"
  | "planQuantity"
  | "part"
  | "printingColour"
  | "l"
  | "w"
  | "h"
  | "ply"
  | "lengthOD"
  | "widthOD"
  | "heightOD"
  | "flap"
  | "outs"
  | "upsForPlates"
  | "paperRequired"
  | "linerRequired"
  | "topPaperWeight"
  | "linerWeight"
  | "totalJobWeight"
  | "actualPaperUsed"
  | "wastagePct";

type OperationRow = {
  production: Production;
  item?: Item;
  schedule?: OrderSchedule;
  order?: Order;
  company?: Company;
  actualPaperUsed: number;
  planPaper: number;
  wastagePct: number | null;
};

type ColumnDef = {
  id: ColumnId;
  label: string;
  align?: "left" | "center" | "right";
  className?: string;
  render: (row: OperationRow) => React.ReactNode;
};

const STORAGE_HIDDEN_KEY = "lnpi.operationDashboard.columns.hidden.v1";
const STORAGE_ORDER_KEY = "lnpi.operationDashboard.columns.order.v1";

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toLocalDateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeDate(dStr: string) {
  if (!dStr) return "";
  const d = new Date(dStr);
  if (Number.isNaN(d.getTime())) return dStr;
  return toLocalDateInputValue(d);
}

export function OperationDashboard() {
  const [productions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);

  const allowExports = exportsAllowed();

  const todayStr = useMemo(() => toLocalDateInputValue(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [searchTerm, setSearchTerm] = useState("");

  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(() => {
    const saved = safeJsonParse<ColumnId[]>(window.localStorage.getItem(STORAGE_HIDDEN_KEY));
    return new Set(Array.isArray(saved) ? saved : []);
  });

  const defaultOrder: ColumnId[] = useMemo(() => ([
    "status",
    "lotNo",
    "partyName",
    "itemName",
    "erpCode",
    "type",
    "planQuantity",
    "part",
    "printingColour",
    "l",
    "w",
    "h",
    "ply",
    "lengthOD",
    "widthOD",
    "heightOD",
    "flap",
    "outs",
    "upsForPlates",
    "paperRequired",
    "linerRequired",
    "topPaperWeight",
    "linerWeight",
    "totalJobWeight",
    "actualPaperUsed",
    "wastagePct",
  ]), []);

  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const saved = safeJsonParse<ColumnId[]>(window.localStorage.getItem(STORAGE_ORDER_KEY));
    if (!Array.isArray(saved) || saved.length === 0) return defaultOrder;
    const known = new Set(defaultOrder);
    const filtered = saved.filter((id) => known.has(id));
    const missing = defaultOrder.filter((id) => !filtered.includes(id));
    return [...filtered, ...missing];
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(Array.from(hiddenColumns)));
  }, [hiddenColumns]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    if (!isColumnsOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (columnsPanelRef.current && columnsPanelRef.current.contains(target)) return;
      setIsColumnsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isColumnsOpen]);

  const productionUsageMap = useMemo(() => {
    return buildProductionMaterialUsageMap(materialIssues, materialIssueLines, materialReturns, materialReturnLines);
  }, [materialIssues, materialIssueLines, materialReturns, materialReturnLines]);

  const getPrintingColour = (item?: Item) => {
    const c1 = String(item?.printingColour1 || "").trim();
    const c2 = String(item?.printingColour2 || "").trim();
    if (c1 && c2) return `${c1} / ${c2}`;
    return c1 || c2 || "-";
  };

  const getPlanPaper = (p: Production) => {
    const total = Number(p.totalJobWeight || 0);
    if (total > 0) return total;
    const top = Number(p.topPaperWeightKg || 0);
    const liner = Number(p.linerWeightKg || 0);
    const sum = top + liner;
    return sum > 0 ? sum : 0;
  };

  const rows: OperationRow[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return productions
      .filter((p) => normalizeDate(p.date) === selectedDate)
      .map((p) => {
        const schedule = schedules.find((s) => s.id === p.scheduleId);
        const order = orders.find((o) => o.id === schedule?.orderId);
        const company = companies.find((c) => c.id === order?.companyId);
        const item = items.find((i) => i.id === p.itemId);
        const actualPaperUsed = getProductionActualPaperUsed(p, productionUsageMap);
        const planPaper = getPlanPaper(p);
        const wastagePct = planPaper > 0 ? ((actualPaperUsed - planPaper) / planPaper) * 100 : null;
        return { production: p, schedule, order, company, item, actualPaperUsed, planPaper, wastagePct };
      })
      .filter((row) => {
        if (!q) return true;
        const blob = [
          row.production.transactionNo,
          row.item?.name || "",
          row.order?.orderNo || "",
          row.company?.name || "",
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) =>
        a.production.transactionNo.localeCompare(b.production.transactionNo, undefined, { numeric: true, sensitivity: "base" })
      );
  }, [productions, selectedDate, searchTerm, items, schedules, orders, companies, productionUsageMap]);

  const totals = useMemo(() => {
    const sumActual = rows.reduce((sum, row) => sum + Number(row.actualPaperUsed || 0), 0);
    const sumPlan = rows.reduce((sum, row) => sum + Number(row.planPaper || 0), 0);
    const overallWastagePct = sumPlan > 0 ? ((sumActual - sumPlan) / sumPlan) * 100 : null;
    return { sumActual, sumPlan, overallWastagePct };
  }, [rows]);

  const columns: ColumnDef[] = useMemo(() => ([
    { id: "status", label: "Status", render: (r) => r.production.status || "-" },
    { id: "lotNo", label: "Lot No", className: "font-bold", render: (r) => r.production.transactionNo },
    { id: "partyName", label: "Party Name", render: (r) => r.company?.name || "-" },
    { id: "itemName", label: "Item Name", render: (r) => r.item?.name || "-" },
    { id: "erpCode", label: "ERP Code", render: (r) => r.production.erpCode || "-" },
    { id: "type", label: "TYPE", render: (r) => r.item?.typeName || "-" },
    { id: "planQuantity", label: "Plan Quantity", align: "right", className: "font-bold text-emerald-700", render: (r) => r.production.qty ?? "-" },
    { id: "part", label: "PART", render: (r) => r.item?.part || "-" },
    { id: "printingColour", label: "Printing Colour", render: (r) => getPrintingColour(r.item) },
    { id: "l", label: "L", align: "right", render: (r) => r.production.length ?? "-" },
    { id: "w", label: "W", align: "right", render: (r) => r.production.breadth ?? "-" },
    { id: "h", label: "H", align: "right", render: (r) => r.production.height ?? "-" },
    { id: "ply", label: "Ply", align: "center", render: (r) => r.production.ply ?? "-" },
    { id: "lengthOD", label: "Length (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.lOd ?? "-" },
    { id: "widthOD", label: "Width (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.wOd ?? "-" },
    { id: "heightOD", label: "Height (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.hOd ?? "-" },
    { id: "flap", label: "FLAP", align: "right", render: (r) => r.item?.flap ?? "-" },
    { id: "outs", label: "No. of Outs (Reel Size)", align: "right", render: (r) => r.production.ups ?? "-" },
    { id: "upsForPlates", label: "No. of ups in Cutting (For Plates)", align: "right", render: (r) => r.production.noOfUpsInCuttingForPlates ?? "-" },
    { id: "paperRequired", label: "Paper Required", align: "right", render: (r) => r.production.paperRequiredNos ?? "-" },
    { id: "linerRequired", label: "Liner Required", align: "right", render: (r) => r.production.lineRequiredNos ?? "-" },
    { id: "topPaperWeight", label: "Top Paper Weight (KG)", align: "right", render: (r) => r.production.topPaperWeightKg ?? "-" },
    { id: "linerWeight", label: "Liner Weight (KG)", align: "right", render: (r) => r.production.linerWeightKg ?? "-" },
    { id: "totalJobWeight", label: "Total Job Weight", align: "right", className: "font-bold", render: (r) => r.production.totalJobWeight ?? "-" },
    { id: "actualPaperUsed", label: "Actual Paper Used", align: "right", className: "font-bold text-indigo-700", render: (r) => r.actualPaperUsed.toFixed(2) },
    {
      id: "wastagePct",
      label: "Wastage %",
      align: "right",
      className: "font-bold",
      render: (r) => (r.wastagePct === null ? "-" : `${r.wastagePct.toFixed(2)}%`),
    },
  ]), []);

  const columnById = useMemo(() => {
    const map = new Map<ColumnId, ColumnDef>();
    columns.forEach((c) => map.set(c.id, c));
    return map;
  }, [columns]);

  const visibleColumnIds = useMemo(() => {
    const known = new Set(columns.map((c) => c.id));
    return columnOrder.filter((id) => known.has(id) && !hiddenColumns.has(id));
  }, [columnOrder, columns, hiddenColumns]);

  const visibleColumns = useMemo(() => {
    return visibleColumnIds.map((id) => columnById.get(id)!).filter(Boolean);
  }, [visibleColumnIds, columnById]);

  const exportData = useMemo(() => {
    return rows.map((r) => {
      const base: Record<string, string | number> = {
        Status: r.production.status || "-",
        "Lot No": r.production.transactionNo || "-",
        "Party Name": r.company?.name || "-",
        "Item Name": r.item?.name || "-",
        "ERP Code": r.production.erpCode || "-",
        TYPE: r.item?.typeName || "-",
        "Plan Quantity": r.production.qty ?? "-",
        PART: r.item?.part || "-",
        "Printing Colour": getPrintingColour(r.item),
        L: r.production.length ?? "-",
        W: r.production.breadth ?? "-",
        H: r.production.height ?? "-",
        Ply: r.production.ply ?? "-",
        "Length (OD)": r.item?.lOd ?? "-",
        "Width (OD)": r.item?.wOd ?? "-",
        "Height (OD)": r.item?.hOd ?? "-",
        FLAP: r.item?.flap ?? "-",
        "No. of Outs (Reel Size)": r.production.ups ?? "-",
        "No. of ups in Cutting (For Plates)": r.production.noOfUpsInCuttingForPlates ?? "-",
        "Paper Required": r.production.paperRequiredNos ?? "-",
        "Liner Required": r.production.lineRequiredNos ?? "-",
        "Top Paper Weight (KG)": r.production.topPaperWeightKg ?? "-",
        "Liner Weight (KG)": r.production.linerWeightKg ?? "-",
        "Total Job Weight": r.production.totalJobWeight ?? "-",
        "Actual Paper Used": Number(r.actualPaperUsed.toFixed(5)),
        "Wastage %": r.wastagePct === null ? "-" : Number(r.wastagePct.toFixed(5)),
      };
      return base;
    });
  }, [rows]);

  const onToggleColumn = (id: ColumnId) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onResetColumns = () => {
    setHiddenColumns(new Set());
    setColumnOrder(defaultOrder);
  };

  const onDragStart = (id: ColumnId) => (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (targetId: ColumnId) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain") as ColumnId;
    if (!sourceId || sourceId === targetId) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(sourceId);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, sourceId);
      return next;
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Operation Dashboard</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase text-slate-600">Date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border-2 border-black rounded px-3 py-1 text-xs font-bold"
            />
          </div>
          {allowExports ? (
            <ExcelExport
              data={exportData}
              fileName={`Operation_Dashboard_${selectedDate}`}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setIsColumnsOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border-2 border-black rounded text-[11px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
          >
            <SlidersHorizontal size={14} strokeWidth={3} />
            Columns
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Actual Paper Used</div>
          <div className="text-2xl font-black text-indigo-700 tabular-nums">{totals.sumActual.toFixed(2)}</div>
        </div>
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Plan Paper</div>
          <div className="text-2xl font-black tabular-nums">{totals.sumPlan.toFixed(2)}</div>
        </div>
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Overall Wastage %</div>
          <div className={cn("text-2xl font-black tabular-nums", totals.overallWastagePct !== null && totals.overallWastagePct > 0 ? "text-red-600" : "text-emerald-700")}>
            {totals.overallWastagePct === null ? "-" : `${totals.overallWastagePct.toFixed(2)}%`}
          </div>
        </div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search lot, item, party..." />

      {isColumnsOpen ? (
        <div ref={columnsPanelRef} className="bg-white border-2 border-black rounded p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between gap-3 border-b border-black pb-2 mb-3">
            <div className="text-xs font-black uppercase tracking-widest">Show / Hide Columns</div>
            <button
              type="button"
              onClick={onResetColumns}
              className="text-[10px] font-black uppercase px-3 py-1 border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {columns.map((c) => {
              const checked = !hiddenColumns.has(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleColumn(c.id)}
                    className="h-4 w-4 border-2 border-black"
                  />
                  <span className="truncate" title={c.label}>{c.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] font-bold text-slate-600">
            Tip: drag table headers to reorder columns.
          </div>
        </div>
      ) : null}

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 bg-slate-100 border-b border-black">
          <h3 className="font-bold text-sm uppercase tracking-tight text-black">Operation Jobs</h3>
          <div className="text-xs font-bold text-slate-600">{rows.length} records</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black">
            <thead className="bg-white">
              <tr className="divide-x divide-black">
                {visibleColumns.map((c) => (
                  <th
                    key={c.id}
                    draggable
                    onDragStart={onDragStart(c.id)}
                    onDragOver={onDragOver}
                    onDrop={onDrop(c.id)}
                    className={cn(
                      "px-4 py-3 text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap select-none cursor-move",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                    )}
                    title="Drag to reorder"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length || 1} className="px-6 py-8 text-center text-black font-medium">
                    No productions found for this date.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.production.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                    {visibleColumns.map((c) => {
                      const value = c.render(row);
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap",
                            c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                            c.className
                          )}
                          title={typeof value === "string" ? value : undefined}
                        >
                          {value}
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
    </div>
  );
}
