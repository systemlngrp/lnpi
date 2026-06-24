import jsPDF from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LoadingSlip, LoadingSlipAllocation, Order, Setting, Truck } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

const PAGE_MARGIN = 14;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const BRAND_COLOR: [number, number, number] = [24, 40, 72];
const ACCENT_COLOR: [number, number, number] = [226, 232, 240];
const TABLE_HEADER_COLOR: [number, number, number] = [37, 52, 77];
const BORDER_COLOR: [number, number, number] = [15, 23, 42];
const SUBTLE_TEXT: [number, number, number] = [71, 85, 105];

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

function getTruckDisplay(trucks: Truck[], truckId: string) {
  const truck = trucks.find((row) => row.id === truckId);
  return String(truck?.truckNo || "-").trim() || "-";
}

function drawTitleBand(doc: jsPDF, startY: number) {
  doc.setFillColor(...BRAND_COLOR);
  doc.roundedRect(PAGE_MARGIN, startY, CONTENT_WIDTH, 12, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("LOADING SLIP", PAGE_WIDTH / 2, startY + 7.8, { align: "center" });
  doc.setTextColor(0, 0, 0);
  return startY + 16;
}

function drawSectionHeader(doc: jsPDF, title: string, startY: number) {
  doc.setFillColor(...ACCENT_COLOR);
  doc.rect(PAGE_MARGIN, startY, CONTENT_WIDTH, 8, "F");
  doc.setDrawColor(...BORDER_COLOR);
  doc.rect(PAGE_MARGIN, startY, CONTENT_WIDTH, 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(title, PAGE_MARGIN + 3, startY + 5.3);
  return startY + 10;
}

function drawInfoGrid(doc: jsPDF, startY: number, details: Array<[string, string]>) {
  const rowHeight = 8;
  const labelWidth = 26;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + CONTENT_WIDTH / 2;
  const valueWidth = CONTENT_WIDTH / 2 - labelWidth;

  details.forEach(([label, value], index) => {
    const isLeft = index % 2 === 0;
    const row = Math.floor(index / 2);
    const x = isLeft ? leftX : rightX;
    const y = startY + row * rowHeight;

    doc.setFillColor(248, 250, 252);
    doc.rect(x, y, labelWidth, rowHeight, "F");
    doc.setDrawColor(...BORDER_COLOR);
    doc.rect(x, y, labelWidth, rowHeight);
    doc.rect(x + labelWidth, y, valueWidth, rowHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, x + 2.5, y + 5.2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(String(value || "-"), x + labelWidth + 2.5, y + 5.2);
  });

  return startY + Math.ceil(details.length / 2) * rowHeight + 4;
}

function drawCompanyBlock(doc: jsPDF, company: Company, startY: number) {
  const boxY = startY;
  const addressLines = [company.address, company.district, company.state]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const addressText = addressLines.join(", ");
  const gstText = String(company.gstNo || "").trim();

  const wrappedAddress = addressText ? doc.splitTextToSize(addressText, CONTENT_WIDTH - 34) : [];
  const wrappedGst = gstText ? doc.splitTextToSize(gstText, CONTENT_WIDTH - 34) : [];
  const boxHeight = 10 + wrappedAddress.length * 5 + (wrappedGst.length > 0 ? wrappedGst.length * 5 + 2 : 0);

  doc.setDrawColor(...BORDER_COLOR);
  doc.roundedRect(PAGE_MARGIN, boxY, CONTENT_WIDTH, boxHeight, 1.2, 1.2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Consignee", PAGE_MARGIN + 3, boxY + 5.5);

  let currentY = boxY + 5.5;

  if (addressText) {
    doc.setFont("helvetica", "normal");
    doc.text(wrappedAddress, PAGE_MARGIN + 24, currentY);
    currentY += wrappedAddress.length * 5;
  }

  if (gstText) {
    doc.setFont("helvetica", "bold");
    doc.text("GST No.", PAGE_MARGIN + 3, currentY + 1);
    doc.setFont("helvetica", "normal");
    doc.text(wrappedGst, PAGE_MARGIN + 24, currentY + 1);
    currentY += wrappedGst.length * 5 + 2;
  }

  return boxY + boxHeight + 5;
}

function buildTableOptions(startY: number, head: UserOptions["head"], body: UserOptions["body"], columnStyles?: UserOptions["columnStyles"]): UserOptions {
  return {
    startY,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head,
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: 0,
      cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
      lineColor: BORDER_COLOR,
      lineWidth: 0.2,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: TABLE_HEADER_COLOR,
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      lineColor: BORDER_COLOR,
      lineWidth: 0.25,
    },
    bodyStyles: {
      lineColor: BORDER_COLOR,
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.25,
    columnStyles,
  };
}

function renderLinkedDetailSection(doc: jsPDF, startY: number, title: string, rows: LoadingSlip["phpDetails"]) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (safeRows.length === 0) return startY;

  const sectionY = drawSectionHeader(doc, title, startY);

  autoTable(
    doc,
    buildTableOptions(
      sectionY,
      [["SL", "Item Name", "Required Qty"]],
      safeRows.map((row, index) => [index + 1, row?.itemName || "-", Number(row?.requiredQty || 0).toLocaleString()]),
      {
        0: { halign: "center", cellWidth: 15, fontStyle: "bold" },
        1: { cellWidth: 132 },
        2: { halign: "right", cellWidth: 35, fontStyle: "bold" },
      }
    )
  );

  return (doc as any).lastAutoTable.finalY + 7;
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
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.5);
  doc.rect(8, 8, 194, 281);

  let currentY = (await renderOrganizationHeader(doc, setting, {
    startY: 14,
    drawDivider: false,
  })).currentY;

  currentY = drawTitleBand(doc, currentY);

  const companyIds = new Set<string>();
  slip.lines.forEach((line) => {
    const plan = plans.find((row) => row.id === line.dispatchPlanId);
    const order = orders.find((row) => row.id === plan?.orderId);
    if (order?.companyId) companyIds.add(order.companyId);
  });

  const uniqueCompanies = Array.from(companyIds)
    .map((id) => companies.find((company) => company.id === id))
    .filter(Boolean) as Company[];

  const companyDisplay =
    uniqueCompanies.length === 1 ? uniqueCompanies[0].name : uniqueCompanies.length > 1 ? "Multiple" : "-";

  const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);
  const truckDisplay = getTruckDisplay(trucks, slip.truckId);
  const details: Array<[string, string]> = [
    ["Slip No", slip.slipNo || "-"],
    ["Date", formatDate(slip.date)],
    ["Company", companyDisplay],
    ["Truck No", truckDisplay],
    ["Total Qty", totalQty.toLocaleString()],
    ["Status", slip.status || "Active"],
  ];

  currentY = drawInfoGrid(doc, currentY, details);

  if (uniqueCompanies.length === 1) {
    currentY = drawCompanyBlock(doc, uniqueCompanies[0], currentY);
  }

  currentY = drawSectionHeader(doc, "FG DETAILS", currentY);

  const fgRows = slip.lines.map((line, index) => {
    const plan = plans.find((row) => row.id === line.dispatchPlanId);
    const order = orders.find((row) => row.id === plan?.orderId);
    const item = npdItems.find((row) => row.id === order?.itemId);
    return [
      index + 1,
      item?.name || line.itemName || "Unknown Item",
      formatAllocations(line.allocations, line.jobNos),
      Number(line.loadedQty || 0).toLocaleString(),
    ];
  });

  autoTable(
    doc,
    buildTableOptions(
      currentY,
      [["SL", "Item Name", "Allocation / Source", "Loaded Qty"]],
      fgRows,
      {
        0: { halign: "center", cellWidth: 15, fontStyle: "bold" },
        1: { cellWidth: 88 },
        2: { cellWidth: 57, textColor: SUBTLE_TEXT },
        3: { halign: "right", cellWidth: 22, fontStyle: "bold" },
      }
    )
  );

  currentY = (doc as any).lastAutoTable.finalY + 7;
  currentY = renderLinkedDetailSection(doc, currentY, "PHP DETAILS", slip.phpDetails);
  currentY = renderLinkedDetailSection(doc, currentY, "PLATE DETAILS", slip.plateDetails);

  if (Array.isArray(slip.packingDetails) && slip.packingDetails.length > 0) {
    currentY = drawSectionHeader(doc, "PACKING DETAILS", currentY);

    const packingRows: Array<Array<string | number>> = slip.packingDetails.map((detail, index) => [
      index + 1,
      Number(detail.bundles || 0).toLocaleString(),
      Number(detail.packSize || 0).toLocaleString(),
      Number(detail.quantity || 0).toLocaleString(),
    ]);

    if (slip.extraItemsQty) {
      packingRows.push(["", "Extra Items (Loose)", "", Number(slip.extraItemsQty || 0).toLocaleString()]);
    }

    autoTable(
      doc,
      buildTableOptions(
        currentY,
        [["SL", "Bundles", "Pack Size", "Quantity"]],
        packingRows,
        {
          0: { halign: "center", cellWidth: 15, fontStyle: "bold" },
          1: { halign: "right", cellWidth: 55 },
          2: { halign: "right", cellWidth: 55 },
          3: { halign: "right", cellWidth: 55, fontStyle: "bold" },
        }
      )
    );

    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.25);
  doc.line(PAGE_MARGIN, currentY, PAGE_MARGIN + CONTENT_WIDTH, currentY);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...SUBTLE_TEXT);
  doc.text("System generated loading slip", PAGE_WIDTH / 2, currentY + 5, { align: "center" });
  doc.setTextColor(0, 0, 0);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
