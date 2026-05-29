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

export async function downloadLoadingSlipPdf({
  slip,
  setting,
  trucks,
  plans,
  orders,
  items,
  companies,
}: {
  slip: LoadingSlip;
  setting?: Setting | null;
  trucks: Truck[];
  plans: DispatchPlan[];
  orders: Order[];
  items: Item[];
  companies: Company[];
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("LOADING SLIP", 105, currentY, { align: "center" });
  currentY += 10;

  const truckNo = trucks.find((t) => t.id === slip.truckId)?.truckNo || "Unknown";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const details: Array<[string, string]> = [
    ["Slip No", slip.slipNo || "-"],
    ["Date", formatDate(slip.date)],
    ["Truck No", truckNo],
    ["Total Qty", slip.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0).toLocaleString()],
    ["Status", slip.status === "Cancelled" ? "Cancelled" : "Active"],
  ];

  details.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? 14 : 110;
    const y = currentY + Math.floor(index / 2) * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 26, y);
  });
  currentY += 20;

  const rows = slip.lines.map((line, index) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    const item = items.find((i) => i.id === order?.itemId);
    const company = companies.find((c) => c.id === order?.companyId);
    return [
      index + 1,
      company?.name || "Unknown",
      order?.orderNo || "-",
      item?.name || "Unknown Item",
      Number(plan?.plannedQty || 0).toLocaleString(),
      Number(line.loadedQty || 0).toLocaleString(),
      formatAllocations(line.allocations, line.jobNos),
    ];
  });

  const companyIds = new Set<string>();
  slip.lines.forEach((line) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    if (order?.companyId) companyIds.add(order.companyId);
  });
  const uniqueCompanies = Array.from(companyIds)
    .map((id) => companies.find((c) => c.id === id))
    .filter(Boolean) as Company[];

  if (uniqueCompanies.length === 1) {
    const company = uniqueCompanies[0];
    const companyLines = [company.name, company.address, company.district, company.state]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(", ");
    const gstLine = String(company.gstNo || "").trim();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Company:", 14, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(company.name, 34, currentY);
    currentY += 6;

    if (companyLines) {
      const wrapped = doc.splitTextToSize(companyLines, 180);
      doc.text(wrapped, 14, currentY);
      currentY += wrapped.length * 5;
    }

    if (gstLine) {
      doc.setFont("helvetica", "bold");
      doc.text("GST No:", 14, currentY);
      doc.setFont("helvetica", "normal");
      doc.text(gstLine, 34, currentY);
      currentY += 6;
    }

    currentY += 2;
  } else if (uniqueCompanies.length > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Companies:", 14, currentY);
    doc.setFont("helvetica", "normal");
    doc.text("Multiple", 38, currentY);
    currentY += 8;
  }

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Company", "Order No", "Item", "Planned", "Loaded", "Jobs / Allocations"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: 0 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      4: { halign: "right", cellWidth: 18 },
      5: { halign: "right", cellWidth: 18 },
      6: { cellWidth: 60 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  if (slip.packingDetails && slip.packingDetails.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PACKING DETAILS", 14, currentY);
    currentY += 6;

    const packingRows = slip.packingDetails.map((pd, idx) => [
      idx + 1,
      pd.bundles.toLocaleString(),
      pd.packSize.toLocaleString(),
      pd.quantity.toLocaleString()
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

  // Highlight Balance in bottom left
  const totalLoaded = slip.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0);
  const totalPlanned = slip.lines.reduce((sum, l) => {
    const plan = plans.find(p => p.id === l.dispatchPlanId);
    return sum + Number(plan?.plannedQty || 0);
  }, 0);
  const remainingBalance = Math.max(0, totalPlanned - totalLoaded);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text(`BALANCE: ${remainingBalance.toLocaleString()}`, 14, currentY);
  
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text("(Total Planned - Total Loaded in this slip)", 14, currentY + 5);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
