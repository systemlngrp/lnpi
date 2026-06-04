import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";

type NpdRecord = {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
};

const NPD_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "npdId", label: "NPD ID" },
  { key: "timestamp", label: "Timestamp" },
  { key: "date", label: "Date" },
  { key: "boxType", label: "BOX TYPE" },
  { key: "companyId", label: "Company Id" },
  { key: "customerName", label: "Customer Name" },
  { key: "contactPerson", label: "Contact Person" },
  { key: "contactNumber", label: "Contact Number" },
  { key: "email", label: "Email" },
  { key: "itemName", label: "Item Name" },
  { key: "erp", label: "ERP" },
  { key: "rate", label: "Rate" },
  { key: "fluteType", label: "Flute Type" },
  { key: "ply", label: "Ply" },
  { key: "noOfParts", label: "No Of Parts" },
  { key: "noOfUps", label: "No Of Ups" },
  { key: "idToOd2", label: "Id to Od 2" },
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
];

function getSearchableText(row: NpdRecord) {
  return NPD_COLUMNS.map((column) => String(row[column.key] ?? "")).join(" ").toLowerCase();
}

function formatCellValue(value: NpdRecord[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function NpdMaster() {
  const [rows, , loading] = useData<NpdRecord>("npd", []);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) => getSearchableText(row).includes(search));
  }, [rows, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">NPD Master</h2>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search NPD, customer, item, PO..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                {NPD_COLUMNS.map((column) => (
                  <th key={column.key} className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={NPD_COLUMNS.length} className="px-6 py-8 text-center text-black font-medium italic">
                    No NPD records found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                    {NPD_COLUMNS.map((column) => (
                      <td key={column.key} className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">
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
