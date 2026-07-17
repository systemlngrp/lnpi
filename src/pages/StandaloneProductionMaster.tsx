import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { OrderItemSource, Production } from "../types";
import { ClientPagination } from "../components/ClientPagination";
import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";
import { resolvePhpPlateFgLink } from "../lib/phpPlateFgLink";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

type StandaloneProductionMasterProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

const formatItemFilterLabel = (name: string, erp: string) => {
  if (!name) return erp;
  if (!erp || name.toLowerCase().includes(erp.toLowerCase())) return name;
  return `${name} - ${erp}`;
};

function formatCell(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "-";
  return String(value);
}

function formatNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "-";
}

function formatFgNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "0";
}

function getFgCellClasses(isBlocked: boolean, requiresFgGate: boolean) {
  if (requiresFgGate && isBlocked) return "bg-red-100 text-red-700 font-bold";
  if (requiresFgGate) return "bg-emerald-50 text-emerald-700 font-bold";
  return "bg-slate-50 text-black font-semibold";
}

export function StandaloneProductionMaster({ source }: StandaloneProductionMasterProps) {
  const [productions, setProductions] = useData<Production>(getJobMasterEntityName(source), []);
  const [fgProductions] = useData<Production>("productions", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");

  const productionFilterRows = useMemo(() => {
    return productions.map((production) => {
      const item = items.find((entry) => entry.id === String(production.itemId || "").trim());
      const itemName = String(item?.name || "").trim();
      const itemErp = String(production.erpCode || item?.erp || "").trim();
      const companyName = String(production.companyName || "").trim();
      const itemKey = itemName || itemErp ? `${itemName}::${itemErp}` : "";

      return {
        production,
        itemName,
        itemErp,
        itemKey,
        companyName,
        searchText: [
          production.transactionNo,
          production.date,
          production.shift,
          production.category,
          production.masterErp,
          production.erpCode,
          companyName,
          production.status,
          production.remarks,
          production.planningId,
          production.scheduledDate,
          production.methodology,
          production.jobType,
          production.sequence,
          production.jobCompletionTimeOutput,
          production.printingColor,
          itemName,
          itemErp,
        ].join(" ").toLowerCase(),
      };
    });
  }, [items, productions]);

  const companyOptions = useMemo(() => {
    const names = Array.from(new Set(productionFilterRows.map((row) => row.companyName).filter(Boolean)));
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((name) => ({ value: name, label: name }));
  }, [productionFilterRows]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; searchText: string }>();
    productionFilterRows.forEach((row) => {
      if (!row.itemKey || map.has(row.itemKey)) return;
      map.set(row.itemKey, { value: row.itemKey, label: formatItemFilterLabel(row.itemName, row.itemErp), searchText: `${row.itemName} ${row.itemErp}` });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [productionFilterRows]);

  const filteredList = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return productionFilterRows
      .filter((row) => {
        if (companyFilter && row.companyName !== companyFilter) return false;
        if (itemFilter && row.itemKey !== itemFilter) return false;
        return !normalizedSearch || row.searchText.includes(normalizedSearch);
      })
      .map((row) => row.production)
      .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime());
  }, [companyFilter, itemFilter, productionFilterRows, searchTerm]);
  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(filteredList, 25);

  const handleCancel = async (id: string) => {
    const remarks = window.prompt("Enter cancel reason");
    if (!remarks?.trim()) return;
    const timestamp = new Date().toISOString();
    await setProductions((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              status: "Cancelled",
              cancelRemarks: remarks.trim(),
              cancelTimestamp: timestamp,
              cancelEmailId: "System User",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            }
          : row
      )
    );
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Production Master</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(260px,1.1fr)_auto] md:items-center">
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search job, ERP, company, item..." />
        <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>
      <div className="bg-white border border-black rounded shadow-sm overflow-auto">
        <table className="min-w-[3320px] w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Shift</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Category</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Master ERP</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">ERP</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Sets/Pcs per Box</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Length</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Breadth</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Height</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Ply</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">No of Holes in PHP</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Flute Type</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">L1</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">F1</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">L2</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">F2</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">L3</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Board GSM (Req)</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Brusting Strength (Req)</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Weight/Pc Set (Req)</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Printing Colour</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Required Qnt</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Planning ID</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Scheduled Date</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Planned Qnt</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Methodology</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">FG Value</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job Type</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Sequence</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job Completion Time</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Output</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">UOM</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Remarks</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={38} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => {
                const item = items.find((entry) => entry.id === String(row.itemId || "").trim());
                const fgState = resolvePhpPlateFgLink(row, fgProductions, source);
                return (
                  <tr key={row.id} className="border-t border-black">
                    <td className="px-3 py-2 text-sm font-semibold">{formatCell(row.transactionNo)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.date)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.shift)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.category)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.masterErp)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.erpCode || item?.erp)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(item?.name || row.itemId)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.setsPerBox)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.length)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.breadth)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.height)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.ply)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.noOfHolesInPhp)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.fluteType || row.flute)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.l1)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.f1)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.l2)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.f2)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.l3)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.boardGsmReq || row.gsm)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.brustingStrengthReq)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.weightPerPcSetReq || row.plateWeight)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.printingColor)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.requiredQty || row.qty)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.planningId || row.scheduleId)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.scheduledDate)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.plannedQty || row.qty)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.methodology)}</td>
                    <td className={`px-3 py-2 text-sm text-right ${getFgCellClasses(fgState.isBlocked, fgState.requiresFgGate)}`}>{formatFgNumber(fgState.fgValue)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.jobType)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.sequence)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.jobCompletionTimeOutput)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.productionOutputQty)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(row.qty)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.uom || item?.uom)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.status)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(row.cancelRemarks || row.remarks)}</td>
                    <td className="px-3 py-2 text-center text-sm">
                      <button
                        type="button"
                        disabled={row.status === "Cancelled"}
                        onClick={() => void handleCancel(row.id)}
                        className="rounded border border-black px-2 py-1 font-bold uppercase disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
