import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LoadingSlip, LoadingSlipAllocation, Order, Setting, Truck } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

function formatAllocations(allocations?: LoadingSlip["lines"][number]["allocations"], jobNos?: LoadingSlip["lines"][number]["jobNos"]) {
  if (Array.isArray(allocations) && allocations.length > 0) {
    return allocations
      .map((allocation: LoadingSlipAllocation) =>
        allocation.sourceType === "job"
          ? `${allocation.jobNo} (${Number(allocation.qty || 0).toLocaleString()})`
          : `${allocation.sourceRef} (${Number(allocation.qty || 0).toLocaleString()})`
      )
      .join(", ");
  }

  if (Array.isArray(jobNos) && jobNos.length > 0) {
    return jobNos.map((jobNo) => String(jobNo)).join(", ");
  }

  return "-";
}

function renderLinkedDetailSection(doc: jsPDF, startY: number, title: string, rows: LoadingSlip["phpDetails"]) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (safeRows.length === 0) return startY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, 14, startY);

  autoTable(doc, {
    startY: startY + 4,
    head: [["SL", "Item Name", "Required Qty"]],
    body: safeRows.map((row, index) => [index + 1, row?.itemName || "-", Number(row?.requiredQty || 0).toLocaleString()]),
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: 0 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      2: { halign: "right", cellWidth: 32, fontStyle: "bold" },
    },
  });

  return (doc as any).lastAutoTable.finalY + 8;
}

export async function downloadLoadingSlipPdf({
  slip,
  setting,
  trucks,
  plans,
  orders,
  npdItems,
  companies,
}: {
  slip: LoadingSlip;
  setting?: Setting | null;
  trucks: Truck[];
  plans: DispatchPlan[];
  orders: Order[];
  npdItems: Item[];
  companies: Company[];
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("LOADING SLIP", 105, currentY, { align: "center" });
  currentY += 10;

  const companyIds = new Set<string>();
  slip.lines.forEach((line) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    if (order?.companyId) companyIds.add(order.companyId);
  });
  const uniqueCompanies = Array.from(companyIds)
    .map((id) => companies.find((c) => c.id === id))
    .filter(Boolean) as Company[];

  const companyDisplay = uniqueCompanies.length === 1 
    ? uniqueCompanies[0].name 
    : uniqueCompanies.length > 1 
      ? "Multiple" 
      : "-";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const details: Array<[string, string]> = [
    ["Slip No", slip.slipNo || "-"],
    ["Date", formatDate(slip.date)],
    ["Total Qty", slip.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0).toLocaleString()],
    ["Company", companyDisplay],
  ];

  details.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? 14 : 110;
    const y = currentY + Math.floor(index / 2) * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 26, y);
  });
  currentY += 15;

  if (uniqueCompanies.length === 1) {
    const company = uniqueCompanies[0];
    const companyLines = [company.address, company.district, company.state]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(", ");
    const gstLine = String(company.gstNo || "").trim();

    if (companyLines) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("Address:", 14, currentY);
      doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(companyLines, 180);
      doc.text(wrapped, 30, currentY);
      currentY += wrapped.length * 5;
    }

    if (gstLine) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("GST No:", 14, currentY);
      doc.setFont("helvetica", "normal");
      doc.text(gstLine, 30, currentY);
      currentY += 6;
    }

    currentY += 2;
  }

  const rows = slip.lines.map((line, index) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    const item = npdItems.find((i) => i.id === order?.itemId);
    return [
      index + 1,
      item?.name || "Unknown Item",
      Number(line.loadedQty || 0).toLocaleString(),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "Loaded Qty"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 9.5, cellPadding: 3, textColor: 0 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 15 },
      2: { halign: "right", cellWidth: 35, fontStyle: "bold" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  currentY = renderLinkedDetailSection(doc, currentY, "PHP DETAILS", slip.phpDetails);
  currentY = renderLinkedDetailSection(doc, currentY, "PLATE DETAILS", slip.plateDetails);

  if (Array.isArray(slip.packingDetails) && slip.packingDetails.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PACKING DETAILS", 14, currentY);
    currentY += 6;

    const packingRows = slip.packingDetails.map((pd, idx) => [
      idx + 1,
      Number(pd.bundles || 0).toLocaleString(),
      Number(pd.packSize || 0).toLocaleString(),
      Number(pd.quantity || 0).toLocaleString()
    ]);

    if (slip.extraItemsQty) {
      packingRows.push(["", "Extra Items (Loose)", "", slip.extraItemsQty.toLocaleString()]);
    }

    autoTable(doc, {
      startY: currentY,
      head: [["SL", "Bundles", "Pack Size", "Quantity"]],
      body: packingRows,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 2, textColor: 0 },
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right", fontStyle: "bold" },
      },
    });
    
    currentY = (doc as any).lastAutoTable.finalY + 15;
  }

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
