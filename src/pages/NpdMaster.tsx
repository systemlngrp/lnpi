import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Spinner } from "../components/Spinner";

type NpdRecord = {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
};

const NPD_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "npdId", label: "NPD ID" },
  { key: "boxType", label: "BOX TYPE" },
  { key: "companyId", label: "Company Id" },
  { key: "customerName", label: "Customer Name" },
  { key: "contactPerson", label: "Contact Person" },
  { key: "contactNumber", label: "Contact Number" },
  { key: "email", label: "Email" },
  { key: "itemName", label: "Item Name" },
  { key: "erp", label: "ERP" },
  { key: "rate", label: "Rate" },
  { key: "uom", label: "UOM" },
  { key: "fluteType", label: "Flute Type" },
  { key: "ply", label: "Ply" },
  { key: "noOfParts", label: "No Of Parts" },
  { key: "noOfUps", label: "No Of Ups" },
  { key: "idToOd2", label: "Id to Od 2" },
  { key: "openLength", label: "Open Length" },
  { key: "openWidth", label: "Open Width" },
  { key: "lengthId", label: "Length (ID)" },
  { key: "breadthId", label: "Breadth (ID)" },
  { key: "heightId", label: "Height (ID)" },
  { key: "lengthOd", label: "Length (OD)" },
  { key: "breadthOd", label: "Breadth (OD)" },
  { key: "heightOd", label: "Height (OD)" },
  { key: "psL1", label: "PS-L1" },
  { key: "psL1Bf", label: "PS L1-BF" },
  { key: "psF1", label: "PS F1" },
  { key: "psF1Bf", label: "PS F1-BF" },
  { key: "psL2", label: "PS L2" },
  { key: "psL2Bf", label: "PS L2-BF" },
  { key: "psF2", label: "PS F2" },
  { key: "psF2Bf", label: "PS F2-BF" },
  { key: "psL3", label: "PS L3" },
  { key: "psL3Bf", label: "PS L3-BF" },
  { key: "materialWeightInsideInOneBox", label: "Material Weight inside in One Box" },
  { key: "stackHeight", label: "Stack Height" },
  { key: "safetyFactor", label: "Safety Factor" },
  { key: "csKgStd", label: "CS (Kg) Std" },
  { key: "csKgTarget", label: "CS (Kg) Target" },
  { key: "bsKgCm2Std", label: "BS (kg/cm2) Std" },
  { key: "bsKgCm2Calculated", label: "BS (kg/cm2) Calculated" },
  { key: "takeUpFactor", label: "Take up Factor" },
  { key: "ups", label: "UPS" },
  { key: "rapc", label: "RAPC" },
  { key: "opening", label: "Opening" },
  { key: "receipt", label: "Receipt" },
  { key: "production", label: "Production" },
  { key: "invoiced", label: "Invoiced" },
  { key: "balance", label: "Balance" },
  { key: "gstRate", label: "GST Rate" },
  { key: "part", label: "Part" },
  { key: "cuttingWithTrimming", label: "Cutting with Trimming" },
  { key: "standardWeightGms", label: "Standard Weight(gms)" },
  { key: "calculatedWeightPerBox", label: "Calculated Weight per Box" },
  { key: "standardBGsm", label: "Standard B GSM" },
  { key: "calculatedBGsm", label: "Calculated B GSM" },
  { key: "stitchingGluing", label: "Stitching/Gluing" },
  { key: "rsl1", label: "RSL1" },
  { key: "rsl1Bf", label: "RSL1-BF" },
  { key: "rsf2", label: "RSF2" },
  { key: "rsf2Bf", label: "RSF2-BF" },
  { key: "rsl3", label: "RSL3" },
  { key: "rsl3Bf", label: "RSL3-BF" },
  { key: "rsf4", label: "RSF4" },
  { key: "rsf4Bf", label: "RSF4-BF" },
  { key: "rsl5", label: "RSL5" },
  { key: "rsf5Bf", label: "RSF5-BF" },
  { key: "flapSize", label: "Flap Size" },
  { key: "deckleSize", label: "Deckle Size" },
  { key: "topPaperShade", label: "Top Paper Shade" },
  { key: "colorId1", label: "Color Id 1" },
  { key: "printingColour1", label: "Printing Colour 1" },
  { key: "colorId2", label: "Color Id 2" },
  { key: "printingColour2", label: "Printing Colour 2" },
  { key: "plainBox", label: "PLAIN BOX" },
  { key: "whetherPlateApplicable", label: "Whether Plate Applicable" },
  { key: "whetherPhpApplicable", label: "Whether PHP Applicable" },
  { key: "dimensionsApproved", label: "Dimensions Approved" },
  { key: "artworkApproved", label: "Artwork Approved" },
  { key: "artworkUpload", label: "Artwork Upload" },
  { key: "url", label: "URL" },
  { key: "poDate", label: "PO Date" },
  { key: "poNumber", label: "PO Number" },
  { key: "supplier", label: "Supplier" },
  { key: "printingBlockItemName", label: "Printing Block Item Name" },
  { key: "blockSizeSqInch", label: "Block Size (Sq Inch)" },
  { key: "approvedRateOfSupplier", label: "Approved Rate of Supplier" },
  { key: "poPdf", label: "PO PDF" },
  { key: "chargeableToCustomer", label: "Chargeable to Customer" },
  { key: "amount", label: "Amount" },
  { key: "poPdfApproval", label: "PO PDF Approval" },
  { key: "emailSentToSupplier", label: "Email Sent to Supplier" },
  { key: "emailTimestamp", label: "Email Timestamp" },
  { key: "invoiceNo", label: "Invoice No." },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "invoiceAmount", label: "Invoice Amount" },
  { key: "geNo", label: "GE No." },
  { key: "mrrNo", label: "MRR No." },
  { key: "dateOfReceipt", label: "Date of Receipt" },
  { key: "supplierInvoiceNoMrr", label: "Supplier Invoice No.(MRR)" },
  { key: "itemValueMrr", label: "Item Value (MRR)" },
  { key: "invoiceValueMrr", label: "Invoice Value (MRR)" },
  { key: "approvalStatus", label: "Approval Status" },
  { key: "debitNoteNo", label: "Debit Note No." },
  { key: "debitNoteDate", label: "Debit Note Date" },
  { key: "debitNoteAmount", label: "Debit Note Amount" },
  { key: "customerPoNo", label: "Customer PO No." },
  { key: "customerPoDate", label: "Customer PO Date" },
  { key: "orderQuantity", label: "Order Quantity" },
  { key: "orderRate", label: "Order Rate" },
  { key: "customerPoAmount", label: "Customer PO Amount" },
  { key: "boxesPerSheetDieCut", label: "No. of Boxes per Sheet in case of Die Cut Box" },
  { key: "reelSize", label: "Reel Size" },
  { key: "cuttingSize", label: "Cutting Size" },
  { key: "rapcForSingleBox", label: "Rapc for single box" },
  { key: "dieCutUps", label: "No Of Die Cut Ups(No Of Boxes In One Die Sheet)" },
  { key: "syncInItemMaster", label: "SYNC IN ITEM MASTER" },
  { key: "platePhpWeight", label: "PLATE/PHP WEIGHT" },
  { key: "gsmLeastCost", label: "GSM Least Cost" },
  { key: "backingPaperShade", label: "Backing Paper Shade" },
  { key: "artwork", label: "Artwork" },
  { key: "spec", label: "Spec" },
];

function formatCellValue(value: NpdRecord[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function NpdMaster() {
  const [rows, setRows] = useState<NpdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const pageSize = 10000;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchTerm(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    const fetchRows = async () => {
      try {
        setLoading(true);
        const token = window.localStorage.getItem("authToken") || "";
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (searchTerm) params.set("search", searchTerm);

        const response = await fetch(`/api/npd?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error("Failed to fetch NPD rows.");
        }
        const result = await response.json();
        if (cancelled) return;
        setRows(Array.isArray(result.rows) ? result.rows : []);
        setTotal(Number(result.total || 0));
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch NPD rows:", error);
        setRows([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRows();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageLabel = useMemo(() => {
    if (total === 0) return "0 records";
    if (totalPages <= 1) return `${rows.length} of ${total} records`;
    const start = (page - 1) * pageSize + 1;
    const end = rows.length > 0 ? start + rows.length - 1 : start;
    return `${start}-${Math.min(total, end)} of ${total}`;
  }, [page, pageSize, rows.length, total, totalPages]);

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

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-black bg-slate-50 px-4 py-3 text-sm font-semibold text-black md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {loading ? <Spinner size={18} /> : null}
            <span>{loading ? "Loading NPD items..." : pageLabel}</span>
          </div>
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

        <div className="table-scroll-shell">
          <table className="min-w-max divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                {NPD_COLUMNS.map((column) => (
                  <th key={column.key} className="whitespace-nowrap border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {loading ? (
                <tr>
                  <td colSpan={NPD_COLUMNS.length} className="px-6 py-12">
                    <div className="flex items-center justify-center gap-3 text-black">
                      <Spinner size={28} />
                      <span className="font-semibold">Loading NPD items...</span>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={NPD_COLUMNS.length} className="px-6 py-8 text-center font-medium italic text-black">
                    No NPD records found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="divide-x divide-black transition-colors hover:bg-slate-50">
                    {NPD_COLUMNS.map((column) => (
                      <td key={column.key} className="whitespace-nowrap border border-black px-4 py-3 text-sm text-black">
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
    </div>
  );
}
