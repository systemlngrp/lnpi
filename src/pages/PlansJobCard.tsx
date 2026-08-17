import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import jsPDF from "jspdf";
import { TableControls } from "../components/TableControls";

type JobCardMapping = {
  field: string;
  source: string;
  key: string;
  notes: string;
};

const jobCardMappings: JobCardMapping[] = [
  {
    field: "PDF cell text fit",
    source: "job-card PDF renderer",
    key: "cell text wrapping / min font size",
    notes: "Values wrap inside their boxes and shrink only when needed; if content still cannot fit, it is truncated with an ellipsis to prevent overlap.",
  },
  {
    field: "Date",
    source: "productions",
    key: "productions.date",
    notes: "Printed with formatDate from the selected production job.",
  },
  {
    field: "Job No.",
    source: "productions",
    key: "productions.jobCardNo, productions.transactionNo",
    notes: "Uses jobCardNo first; if blank, uses transactionNo.",
  },
  {
    field: "Box Type",
    source: "productions, npd",
    key: "productions.jobType, npd.boxType, productions.methodology",
    notes: "Uses production job type first, then NPD box type, then production methodology. If all are blank, PDF prints REGULAR.",
  },
  {
    field: "Lot No.",
    source: "productions",
    key: "productions.lotNo",
    notes: "Optional production field. Blank if not saved on the job.",
  },
  {
    field: "PO Qty",
    source: "orders, orders_schedule, productions",
    key: "orders.qty, orders_schedule.qty, productions.plannedQty, productions.qty",
    notes: "Uses the first non-blank value in this order and prints as a whole number with no decimals.",
  },
  {
    field: "Party Name",
    source: "companies, productions, npd",
    key: "companies.name, productions.companyName, npd.customerName, npd.companyName, npd.company",
    notes: "Company master name is preferred, then production company name, then NPD customer/company fields.",
  },
  {
    field: "Item Name",
    source: "npd, productions",
    key: "npd.name, npd.itemName, productions.itemId",
    notes: "NPD item name is preferred; raw NPD itemName and production itemId are fallbacks.",
  },
  {
    field: "Target CS",
    source: "npd",
    key: "npd.csKgTarget, npd.csKgStd",
    notes: "Uses csKgTarget first; if blank, uses csKgStd.",
  },
  {
    field: "Target BS",
    source: "productions, npd",
    key: "productions.boardGsmReq, npd.boardGsmReq",
    notes: "Production board GSM requirement is preferred, then NPD boardGsmReq. Prints as a whole number with no decimals.",
  },
  {
    field: "Item ERP",
    source: "productions, orders, npd",
    key: "productions.erpCode, orders.erpCode, npd.erp, npd.erpCode, npd.erpItemCode, npd.masterItemNameErpCode",
    notes: "Uses the first non-blank ERP value resolved for the Job Card.",
  },
  {
    field: "Size (ID) L x W x H",
    source: "productions, npd",
    key: "productions.lengthId, productions.length, productions.breadthId, productions.breadth, productions.heightId, productions.height, npd.lengthId, npd.length, npd.breadthId, npd.breadth, npd.heightId, npd.height",
    notes: "For each dimension, production value is checked first, then NPD raw value via the same key list.",
  },
  {
    field: "Size (OD) L x W x H",
    source: "productions, npd",
    key: "productions.lengthOd, productions.lOd, productions.length, productions.breadthOd, productions.wOd, productions.breadth, productions.heightOd, productions.hOd, productions.height, npd.lengthOd, npd.lOd, npd.length, npd.breadthOd, npd.wOd, npd.breadth, npd.heightOd, npd.hOd, npd.height",
    notes: "OD fields are preferred; length, breadth, and height are fallbacks.",
  },
  {
    field: "Flap",
    source: "npd, productions",
    key: "npd.flapSize, productions.flap",
    notes: "Uses NPD flapSize first, then production flap.",
  },
  {
    field: "Ply",
    source: "productions, npd",
    key: "productions.ply, npd.ply, npd.noOfPly",
    notes: "Production ply is preferred, then NPD ply fields.",
  },
  {
    field: "Printing Colour",
    source: "productions, npd",
    key: "productions.color1, npd.color1, npd.printingColour1",
    notes: "Current PDF prints the first available colour value from this list.",
  },
  {
    field: "Target Box weight",
    source: "npd",
    key: "npd.standardWeightGms",
    notes: "Prints Standard Weight(gms) from NPD. Blank if missing or non-numeric.",
  },
  {
    field: "Target Box",
    source: "productions, npd",
    key: "productions.targetBox, npd.targetBox, productions.rapc, npd.rapc, productions.requiredQty, productions.qty",
    notes: "Uses targetBox first, then RAPC, then required quantity, then production quantity.",
  },
  {
    field: "Deckle",
    source: "productions, npd",
    key: "productions.reelAsPerCalc, npd.deckleSize, npd.reelSize",
    notes: "Production reel calculation is preferred, then NPD deckle/reel size. Source values are in mm and print in inches with 2 decimals.",
  },
  {
    field: "Flute Type",
    source: "productions, npd",
    key: "productions.fluteType, productions.flute, npd.fluteType",
    notes: "Production flute type/flute is preferred, then NPD fluteType.",
  },
  {
    field: "Cutting",
    source: "productions, npd",
    key: "productions.cuttingWithTrimming, npd.cuttingSize, npd.cuttingWithTrimming",
    notes: "Production cutting with trimming is preferred, then NPD cutting fields. Source values are in mm and print in inches with 2 decimals.",
  },
  {
    field: "Flute %",
    source: "productions, npd",
    key: "productions.takeUpFactor, npd.takeUpFactor, npd.takeUp",
    notes: "Uses the first available take-up/flute factor and prints with exactly 2 decimals.",
  },
  {
    field: "Papers",
    source: "productions",
    key: "productions.paperRequiredNos, productions.lineRequiredNos",
    notes: "Paper required quantity is preferred; liner required is fallback.",
  },
  {
    field: "Liners",
    source: "productions",
    key: "productions.lineRequiredNos, productions.paperRequiredNos",
    notes: "Liner required quantity is preferred; paper required is fallback.",
  },
  {
    field: "No. of Outs",
    source: "productions, npd",
    key: "productions.ups, npd.ups, npd.noOfUps",
    notes: "Production UPS is preferred, then NPD UPS fields.",
  },
  {
    field: "Combination Row - Top",
    source: "productions, npd",
    key: "productions.top, npd.psL1Bf, npd.rsl1Bf, productions.reelAsPerCalc, npd.deckleSize",
    notes: "GSM uses productions.top. BF uses psL1Bf or rsl1Bf. Size uses reelAsPerCalc or deckleSize, sourced in mm and printed in inches with 2 decimals. Cutter label is A.",
  },
  {
    field: "Combination Row - Fluting 1",
    source: "productions, npd",
    key: "productions.f1, npd.psF1Bf, npd.rsf2Bf, productions.reelAsPerCalc, npd.deckleSize",
    notes: "GSM uses productions.f1. BF uses psF1Bf or rsf2Bf. Size uses reelAsPerCalc or deckleSize, sourced in mm and printed in inches with 2 decimals. Cutter label is B.",
  },
  {
    field: "Combination Row - Backing 1",
    source: "productions, npd",
    key: "productions.l1, npd.psL1Bf, npd.rsl1Bf, productions.reelAsPerCalc, npd.deckleSize",
    notes: "GSM uses productions.l1. BF uses psL1Bf or rsl1Bf. Size uses reelAsPerCalc or deckleSize, sourced in mm and printed in inches with 2 decimals. Cutter label is C.",
  },
  {
    field: "Combination Row - Fluting 2",
    source: "productions, npd",
    key: "productions.f2, npd.psF2Bf, npd.rsf4Bf",
    notes: "GSM uses productions.f2. BF uses psF2Bf or rsf4Bf. Size prints in inches when a mm source is supplied. Cutter label is D.",
  },
  {
    field: "Combination Row - Backing 2",
    source: "productions, npd",
    key: "productions.l2, npd.psL2Bf",
    notes: "GSM uses productions.l2. BF uses psL2Bf. Size prints in inches when a mm source is supplied.",
  },
  {
    field: "Overall GSM Target",
    source: "npd",
    key: "npd.standardBGsm",
    notes: "Printed as a whole number when present.",
  },
  {
    field: "Overall GSM Achieved",
    source: "productions, npd",
    key: "productions.gsm, npd.calculatedBGsm",
    notes: "Production GSM is preferred, then NPD calculatedBGsm.",
  },
  {
    field: "Remarks",
    source: "productions",
    key: "productions.remarks",
    notes: "Printed directly in the remarks section.",
  },
  {
    field: "Plate ERP",
    source: "plate_item_master",
    key: "plate_item_master.erp, plate_item_master.raw.erp, plate_item_master.raw.erpCode, plate_item_master.raw.erpItemCode, plate_item_master.raw.masterErp, plate_item_master.raw.masterErpCode, plate_item_master.raw.masterItemNameErpCode",
    notes: "Linked Plate item is found by ERP; first non-blank ERP value is printed.",
  },
  {
    field: "Plate Size (L x W)",
    source: "plate_item_master",
    key: "plate_item_master.raw.length, plate_item_master.raw.breadth",
    notes: "Printed only when linked Plate item data exists.",
  },
  {
    field: "Plate Required Qty Per CFB",
    source: "plate_item_master",
    key: "plate_item_master.raw.numberOfSetsPerBox",
    notes: "Printed only when linked Plate item data exists.",
  },
  {
    field: "Plate Flute Direction",
    source: "plate_item_master",
    key: "plate_item_master.raw.fluteType",
    notes: "Printed only when linked Plate item data exists.",
  },
  {
    field: "Plate BS",
    source: "plate_item_master",
    key: "plate_item_master.raw.boardGsmReq",
    notes: "Printed only when linked Plate item data exists.",
  },
  {
    field: "PHP ERP",
    source: "php_item_master",
    key: "php_item_master.erp, php_item_master.raw.erp, php_item_master.raw.erpCode, php_item_master.raw.erpItemCode, php_item_master.raw.masterErp, php_item_master.raw.masterErpCode, php_item_master.raw.masterItemNameErpCode",
    notes: "Linked PHP item is found by ERP; first non-blank ERP value is printed.",
  },
  {
    field: "PHP Size (L x W x H)",
    source: "php_item_master",
    key: "php_item_master.raw.length, php_item_master.raw.breadth, php_item_master.raw.height",
    notes: "Printed only when linked PHP item data exists.",
  },
  {
    field: "PHP Required Qty Per CFB",
    source: "php_item_master",
    key: "php_item_master.raw.numberOfSetsPerBox",
    notes: "Printed only when linked PHP item data exists.",
  },
  {
    field: "PHP Holes / Ply / GSM",
    source: "php_item_master",
    key: "php_item_master.raw.holesOrientationL, php_item_master.raw.holesOrientationW, php_item_master.raw.noOfPly, php_item_master.raw.fluteType, php_item_master.raw.boardGsmReq",
    notes: "Printed in the PHP specification rows and diagram area.",
  },
  {
    field: "Target Paper Weight",
    source: "productions",
    key: "productions.topPaperWeightKg, productions.totalPaperWeight",
    notes: "Source remains topPaperWeightKg first, with totalPaperWeight as fallback, but the Job Card PDF intentionally prints this value blank.",
  },
  {
    field: "Target Liner Weight",
    source: "productions",
    key: "productions.linerWeightKg",
    notes: "Source remains saved production liner weight, but the Job Card PDF intentionally prints this value blank.",
  },
  {
    field: "Total Target weight",
    source: "productions",
    key: "productions.totalJobWeight, productions.topPaperWeightKg + productions.linerWeightKg",
    notes: "Source remains totalJobWeight, falling back to target paper plus liner weights, but the Job Card PDF intentionally prints this value blank.",
  },
  {
    field: "Actual Paper weight",
    source: "productions",
    key: "productions.actualPaperUsed",
    notes: "Printed in official data when saved on the production job.",
  },
  {
    field: "Actual Consumed weight",
    source: "productions",
    key: "productions.actualPaperUsed",
    notes: "Current PDF uses the same actualPaperUsed value for consumed weight.",
  },
  {
    field: "Reel No.",
    source: "material-in-packing-slips, material-issue-reel-lines",
    key: "material-in-packing-slips.ourReelNo, material-issue-reel-lines.ourReelNo",
    notes: "Issue reel line reel number is preferred; packing slip reel number is fallback.",
  },
  {
    field: "Reel T/F/B",
    source: "productions, npd, materials",
    key: "productions.top, productions.f1, productions.l1, productions.f2, productions.l2, productions.l3, npd.psL1Bf, npd.rsl1Bf, npd.psF1Bf, npd.rsf2Bf, npd.psF2Bf, npd.rsf4Bf, npd.psL2Bf, npd.psL3Bf, npd.rsl3Bf, materials.gsm, materials.bf",
    notes: "Inferred by matching issued material GSM/BF against production/NPD paper layer values.",
  },
  {
    field: "Reel BF / GSM",
    source: "materials",
    key: "materials.bf, materials.gsm",
    notes: "Material master values for the issued reel material.",
  },
  {
    field: "Reel Weight",
    source: "material-issue-reel-lines",
    key: "material-issue-reel-lines.weightKg",
    notes: "Sums issued reel weight for this production and packing slip.",
  },
  {
    field: "Balance Reel",
    source: "material-return-reel-lines",
    key: "material-return-reel-lines.weightKg",
    notes: "Sums returned reel weight for this production and packing slip.",
  },
  {
    field: "Process Data",
    source: "production_processing",
    key: "production_processing.productionId, production_processing.machineName, production_processing.qty, production_processing.operatorName, production_processing.date, production_processing.updateTimestamp",
    notes: "Rows linked to the production job are sorted by timestamp for process data.",
  },
  {
    field: "Reports - Final FG Produced",
    source: "productions",
    key: "productions.prodFromFFG",
    notes: "Printed on the second Job Card page when available.",
  },
  {
    field: "Reports - Wastage %",
    source: "productions, material-issue-reel-lines, material-return-reel-lines",
    key: "productions.prodFromFFG, productions.sheetWeight, productions.actualPaperUsed, material-issue-reel-lines.weightKg, material-return-reel-lines.weightKg",
    notes: "Calculated as 100 - ((Prod FFG x Sheet Weight) / Actual Paper Used) x 100 when all required values exist.",
  },
  {
    field: "Organization Name",
    source: "settings",
    key: "settings.organizationName",
    notes: "Uses organizationName from settings; default is LAXMI NARAYAN PACKAGING INDUSTRIES.",
  },
  {
    field: "Created By",
    source: "createdBy argument, productions",
    key: "createdBy, productions.updatedBy",
    notes: "PDF call passes createdBy; production updatedBy is fallback. If both are blank, PDF prints System User.",
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

  const handleDownloadPdf = () => {
    const doc = new jsPDF("p", "mm", "a4");
    const marginX = 12;
    const pageBottom = 285;
    let y = 16;

    const ensureSpace = (height: number) => {
      if (y + height > pageBottom) {
        doc.addPage();
        y = 16;
      }
    };

    const addText = (text: string, x = marginX, width = 186, lineHeight = 4.2) => {
      const lines = doc.splitTextToSize(text, width) as string[];
      ensureSpace(lines.length * lineHeight + 2);
      doc.text(lines, x, y);
      y += lines.length * lineHeight + 2;
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Documentation - Job Card", marginX, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    addText("Job Card PDF field mapping with exact app table/data names, source keys, fallback logic, and PDF fit behavior.");

    const widths = [38, 40, 58, 56];
    const headers = ["Job Card Field", "Source Table/Data", "Source Column/Key", "Logic / Notes"];
    const drawHeader = () => {
      ensureSpace(8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      let x = marginX;
      headers.forEach((header, index) => {
        doc.rect(x, y, widths[index], 7);
        doc.text(doc.splitTextToSize(header, widths[index] - 2) as string[], x + 1, y + 4.5);
        x += widths[index];
      });
      y += 7;
      doc.setFont("helvetica", "normal");
    };

    drawHeader();
    jobCardMappings.forEach((row) => {
      const values = [row.field, row.source, row.key, row.notes];
      doc.setFontSize(6.4);
      const wrapped = values.map((value, index) => doc.splitTextToSize(value, widths[index] - 2) as string[]);
      const rowHeight = Math.max(9, Math.max(...wrapped.map((lines) => lines.length)) * 3.4 + 3);
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = 16;
        drawHeader();
      }
      let x = marginX;
      wrapped.forEach((lines, index) => {
        doc.rect(x, y, widths[index], rowHeight);
        doc.text(lines, x + 1, y + 4);
        x += widths[index];
      });
      y += rowHeight;
    });

    doc.save("Job_Card_Documentation.pdf");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-black pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Job Card</h2>
          <p className="mt-2 text-sm text-slate-700 font-medium">
            This page maps Job Card PDF fields to exact app table/data names, source keys, fallback logic, and PDF fit behavior.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          className="inline-flex items-center gap-2 rounded border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-red-700"
        >
          <FileText size={16} /> PDF
        </button>
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
