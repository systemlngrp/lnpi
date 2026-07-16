import { FileText } from "lucide-react";
import jsPDF from "jspdf";

const ruleSections = [
  {
    title: "Pending Schedule Rule",
    body: "Pending Production Plan shows FG scheduled orders whose effective pending production quantity is greater than zero and whose schedule date is up to the configured near-term cutoff. Pending quantity is calculated from scheduled quantity minus consumed production and cancelled quantity.",
  },
  {
    title: "Sample Priority",
    body: "When the selected item has a pending sample request with no cancel timestamp and no job card, it is treated as a sample item. Planned Quantity is auto-filled from the sample quantity and becomes read-only.",
  },
  {
    title: "Deviation Rule",
    body: "If there is no pending sample and the current item is the same as the latest relevant produced item, Planned Quantity cannot exceed Last Plan Qty plus the company Deviation Allowed percentage. If the company value is blank, the fallback percentage is 25.",
  },
  {
    title: "GSM Rule",
    body: "If there is no pending sample and the current item is different from the latest relevant produced item, GSM cannot exceed the Least GSM reference for the current ERP code.",
  },
  {
    title: "Production Calculations",
    body: "Planned Production (Meter) is calculated from Cutting Trim, Planned Quantity, and UPS. Sheet Weight is Total Job Weight divided by Planned Quantity. Total Paper Weight equals Total Job Weight. Realization per KG is Rate divided by Total Weight of Set.",
  },
  {
    title: "Production Plan Sorting",
    body: "Production Plan groups rows by flute batch, sorts larger meter rows by company and reel width, places smaller meter rows near the closest reel width, then groups companies by their maximum reel width.",
  },
  {
    title: "Production Plan Highlighting",
    body: "Production Plan highlights non-sample rows when Realization per KG is below 98 percent of the applicable realization target for the selected date.",
  },
];

const rules = [
  "Pending Production Plan includes only FG schedules with pending production quantity greater than zero.",
  "Pending quantity = Scheduled Qty - effective consumed production - cancelled quantity.",
  "Sample requests take first priority and lock Planned Quantity to the pending sample quantity.",
  "Same-item planning is checked against Last Plan Qty plus company Deviation Allowed, falling back to 25 percent.",
  "Different-item planning checks that current GSM does not exceed Least GSM for the ERP code.",
  "Planned Production (Meter), Sheet Weight, Total Paper Weight, and Realization/KG are calculated by the production form.",
  "Production Plan sorting uses flute batch, company, reel actual width trimming, and planned production meter rules.",
  "Non-sample rows below the realization target threshold are highlighted in the Production Plan.",
];

export function PlansProductionPlanning() {
  const handleDownloadPdf = () => {
    const doc = new jsPDF("p", "mm", "a4");
    let y = 16;

    doc.setFontSize(14);
    doc.text("Documentation - Production Planning Logic", 14, y);
    y += 10;
    doc.setFontSize(9);
    doc.text("Current production planning rules used by the app.", 14, y);
    y += 10;

    ruleSections.forEach((section) => {
      if (y > 260) {
        doc.addPage();
        y = 16;
      }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(section.title, 14, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(section.body, 180);
      doc.text(lines, 14, y);
      y += lines.length * 5 + 5;
    });

    if (y > 230) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Current Rules Summary", 14, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    rules.forEach((rule, index) => {
      const lines = doc.splitTextToSize(`${index + 1}. ${rule}`, 180);
      if (y + lines.length * 5 > 285) {
        doc.addPage();
        y = 16;
      }
      doc.text(lines, 14, y);
      y += lines.length * 5 + 3;
    });

    doc.save("Production_Planning_Logic.pdf");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-black pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Production Planning Logic</h2>
          <p className="mt-2 text-sm text-slate-700 font-medium">
            This page explains the current production planning rules in simple app language so users can refer to them later.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ruleSections.slice(0, 6).map((section) => (
          <div key={section.title} className="bg-white border border-black rounded shadow-sm p-5">
            <h3 className="text-sm font-black uppercase text-slate-600 mb-3">{section.title}</h3>
            <p className="text-sm text-black leading-6">{section.body}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black rounded shadow-sm p-5">
        <h3 className="text-sm font-black uppercase text-slate-600 mb-3">{ruleSections[6].title}</h3>
        <p className="text-sm text-black leading-6">{ruleSections[6].body}</p>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Current Rules Summary</h3>
        </div>
        <div className="p-5 space-y-3">
          {rules.map((rule) => (
            <div key={rule} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
