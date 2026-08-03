import { useEffect, useState } from "react";
import { TableControls } from "../components/TableControls";

const jobCardMappings = [
  {
    field: "Date",
    source: "productions",
    key: "date",
    notes: "Printed with the app date formatter from the selected production job.",
  },
  {
    field: "Job No.",
    source: "productions",
    key: "jobCardNo, transactionNo",
    notes: "Uses Job Card No. first; if blank, uses production transaction number.",
  },
  {
    field: "Box Type",
    source: "productions / item catalog",
    key: "jobType, item.boxType, raw.boxType, methodology",
    notes: "Production job type is preferred, then item/NPD box type, then production methodology.",
  },
  {
    field: "Lot No.",
    source: "productions",
    key: "lotNo",
    notes: "Optional production field. Blank if not saved on the job.",
  },
  {
    field: "PO Qty",
    source: "orders / orders_schedule / productions",
    key: "orders.qty, orders_schedule.qty, plannedQty, qty",
    notes: "Uses order quantity first, then schedule quantity, then production planned/job quantity.",
  },
  {
    field: "Party Name",
    source: "companies / productions / item catalog",
    key: "companies.name, companyName, raw.customerName, raw.companyName, raw.company",
    notes: "Company master name is preferred, with production and NPD/customer fields as fallback.",
  },
  {
    field: "Item Name",
    source: "item catalog / NPD items / productions",
    key: "item.name, raw.itemName, itemId",
    notes: "Uses resolved item catalog name; falls back to raw NPD item name or production item id.",
  },
  {
    field: "Target CS",
    source: "productions / NPD item raw",
    key: "targetBox, rapc, requiredQty, qty",
    notes: "Uses target box from production/NPD when present, then RAPC, then required quantity or production quantity.",
  },
  {
    field: "Target BS",
    source: "productions / NPD item raw",
    key: "boardGsmReq",
    notes: "Production board GSM requirement is preferred, then NPD boardGsmReq.",
  },
  {
    field: "Item ERP",
    source: "productions / orders / item catalog / NPD raw",
    key: "erpCode, orders.erpCode, item.erp, raw.erp, raw.erpCode, raw.erpItemCode, raw.masterItemNameErpCode",
    notes: "First non-blank ERP value is printed.",
  },
  {
    field: "Size (ID) L x W x H",
    source: "productions / item catalog",
    key: "lengthId, length, breadthId, breadth, heightId, height",
    notes: "Uses saved production dimensions first, then item dimensions.",
  },
  {
    field: "Size (OD) L x W x H",
    source: "productions / item catalog",
    key: "lengthOd, lOd, breadthOd, wOd, heightOd, hOd",
    notes: "Uses OD fields where available; length/breadth/height are fallback values.",
  },
  {
    field: "Flap",
    source: "NPD item raw / productions",
    key: "raw.flapSize, flap",
    notes: "Uses NPD flap size first, then production flap field.",
  },
  {
    field: "Ply",
    source: "productions / NPD item raw",
    key: "ply, raw.ply, raw.noOfPly",
    notes: "Production ply is preferred, then NPD ply fields.",
  },
  {
    field: "Printing Colour",
    source: "productions / NPD item raw",
    key: "color1, raw.color1, raw.printingColour1",
    notes: "Current PDF prints the first available printing colour value.",
  },
  {
    field: "Target Box weight",
    source: "NPD item raw",
    key: "standardWeightGms",
    notes: "Prints Standard Weight(gms) from NPD. Blank if the value is missing or non-numeric.",
  },
  {
    field: "Target Box",
    source: "productions / NPD item raw",
    key: "targetBox, rapc, requiredQty, qty",
    notes: "Same target-size resolver as Target CS.",
  },
  {
    field: "Deckle",
    source: "productions / NPD item raw",
    key: "reelAsPerCalc, raw.deckleSize, raw.reelSize",
    notes: "Production reel calculation is preferred, then NPD deckle/reel size.",
  },
  {
    field: "Flute Type",
    source: "productions / NPD item raw",
    key: "fluteType, flute, raw.fluteType",
    notes: "Production flute type/flute values are preferred.",
  },
  {
    field: "Cutting",
    source: "productions / NPD item raw",
    key: "cuttingWithTrimming, raw.cuttingSize, raw.cuttingWithTrimming",
    notes: "Production cutting with trimming is preferred, then NPD cutting fields.",
  },
  {
    field: "Flute %",
    source: "productions / NPD item raw",
    key: "takeUpFactor, raw.takeUpFactor, raw.takeUp",
    notes: "Shows the first available take-up/flute percentage factor.",
  },
  {
    field: "Papers",
    source: "productions",
    key: "paperRequiredNos, lineRequiredNos",
    notes: "Paper required quantity is preferred; liner required is fallback.",
  },
  {
    field: "Liners",
    source: "productions",
    key: "lineRequiredNos, paperRequiredNos",
    notes: "Liner required quantity is preferred; paper required is fallback.",
  },
  {
    field: "No. of Outs",
    source: "productions / NPD item raw",
    key: "ups, raw.ups, raw.noOfUps",
    notes: "Production UPS is preferred, then NPD UPS fields.",
  },
  {
    field: "Combination Rows - GSM",
    source: "productions",
    key: "top, f1, l1, f2, l2, l3",
    notes: "Top, fluting, and backing GSM values are taken from production layer fields.",
  },
  {
    field: "Combination Rows - BF",
    source: "NPD item raw",
    key: "psL1Bf, rsl1Bf, psF1Bf, rsf2Bf, psF2Bf, rsf4Bf, psL2Bf, psL3Bf, rsl3Bf",
    notes: "BF values are read from NPD raw paper specification fields.",
  },
  {
    field: "Combination Rows - Size",
    source: "productions / NPD item raw",
    key: "reelAsPerCalc, raw.deckleSize",
    notes: "Top and first backing/fluting rows use reel calculation or NPD deckle size.",
  },
  {
    field: "Plate/PHP Specification",
    source: "PHP item master / Plate item master",
    key: "linked item ERP and raw item fields",
    notes: "Linked PHP/Plate items are found by ERP and their raw fields are printed in the lower specification section.",
  },
  {
    field: "Target Paper Weight",
    source: "productions",
    key: "topPaperWeightKg, totalPaperWeight",
    notes: "Uses top paper weight first; total paper weight is fallback.",
  },
  {
    field: "Target Liner Weight",
    source: "productions",
    key: "linerWeightKg",
    notes: "Uses saved production liner weight.",
  },
  {
    field: "Total Target weight",
    source: "productions",
    key: "totalJobWeight, topPaperWeightKg + linerWeightKg",
    notes: "Uses saved total job weight; if blank, adds target paper and liner weights.",
  },
  {
    field: "Actual Paper / Consumed Weight",
    source: "productions / material issue-return reel lines",
    key: "actualPaperUsed, material-issue-reel-lines.weightKg, material-return-reel-lines.weightKg",
    notes: "Uses saved actual paper where present; process page can derive issued minus returned reel weight.",
  },
  {
    field: "Reel Consumption Details",
    source: "material-in-packing-slips / material issue-return reel lines / materials",
    key: "ourReelNo, materialId, weightKg, gsm, bf",
    notes: "Rows are built for reels issued to this job, with returned weight as balance.",
  },
  {
    field: "Process Data",
    source: "production_processing",
    key: "productionId, machineName, qty, operatorName, date, updateTimestamp",
    notes: "Shows process entries linked to the production job, sorted by process timestamp.",
  },
];

export function PlansJobCard() {
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll("table tbody tr");
    rows.forEach((row) => {
      const txt = (row.textContent || "").toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? "none" : "";
    });
  }, [searchTerm]);

  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Job Card</h2>
        <p className="mt-2 text-sm text-slate-700 font-medium">
          This page maps Job Card PDF fields to the app data source, source key, and current fallback logic.
        </p>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Job Card Field Source Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Job Card Field</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Source Table/Data</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Source Column/Key</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Logic / Notes</th>
              </tr>
            </thead>
            <tbody>
              {jobCardMappings.map((row) => (
                <tr key={row.field} className="align-top">
                  <td className="px-4 py-3 text-sm font-bold text-black border border-black bg-white whitespace-nowrap">{row.field}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white">{row.source}</td>
                  <td className="px-4 py-3 text-sm font-mono text-black border border-black bg-white">{row.key}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white leading-6">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
