import jsPDF from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LinkedLoadingDetail, LoadingSlip, LoadingSlipAllocation, Order, Setting, Truck } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

const FRAME_X = 22;
const FRAME_Y = 14;
const FRAME_WIDTH = 166;
const FRAME_HEIGHT = 196;
const CONTENT_X = FRAME_X + 4;
const CONTENT_Y = FRAME_Y + 4;
const CONTENT_WIDTH = FRAME_WIDTH - 8;
const BRAND_COLOR: [number, number, number] = [23, 40, 75];
const LIGHT_HEADER: [number, number, number] = [236, 241, 248];
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

function drawOuterFrame(doc: jsPDF) {
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.35);
  doc.rect(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT);
}

function drawTitleBand(doc: jsPDF, startY: number) {
  doc.setFillColor(...BRAND_COLOR);
  doc.roundedRect(CONTENT_X, startY, CONTENT_WIDTH, 8, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("LOADING SLIP", FRAME_X + FRAME_WIDTH / 2, startY + 5.4, { align: "center" });
  doc.setTextColor(0, 0, 0);
  return startY + 10;
}

function drawSectionHeader(doc: jsPDF, title: string, startY: number) {
  doc.setFillColor(...LIGHT_HEADER);
  doc.rect(CONTENT_X, startY, CONTENT_WIDTH, 5.5, "F");
  doc.setDrawColor(...BORDER_COLOR);
  doc.rect(CONTENT_X, startY, CONTENT_WIDTH, 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(title, CONTENT_X + 2, startY + 3.8);
  return startY + 6.2;
}

function drawInfoGrid(doc: jsPDF, startY: number, details: Array<[string, string]>) {
  const rowHeight = 4.8;
  const halfWidth = CONTENT_WIDTH / 2;
  const labelWidth = 18;

  details.forEach(([label, value], index) => {
    const left = index % 2 === 0;
    const row = Math.floor(index / 2);
    const x = left ? CONTENT_X : CONTENT_X + halfWidth;
    const y = startY + row * rowHeight;

    doc.setFillColor(248, 250, 252);
    doc.rect(x, y, labelWidth, rowHeight, "F");
    doc.setDrawColor(...BORDER_COLOR);
    doc.rect(x, y, labelWidth, rowHeight);
    doc.rect(x + labelWidth, y, halfWidth - labelWidth, rowHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.1);
    doc.text(label, x + 1.4, y + 3.2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.1);
    doc.text(String(value || "-"), x + labelWidth + 1.4, y + 3.2);
  });

  return startY + Math.ceil(details.length / 2) * rowHeight + 2;
}

function drawCompanyBlock(doc: jsPDF, company: Company, startY: number) {
  const addressParts = [company.address, company.district, company.state]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const addressText = addressParts.join(", ");
  const gstText = String(company.gstNo || "").trim();

  const addressLines = addressText ? doc.splitTextToSize(addressText, CONTENT_WIDTH - 24) : [];
  const gstLines = gstText ? doc.splitTextToSize(gstText, CONTENT_WIDTH - 24) : [];
  const boxHeight = Math.max(12, 5 + addressLines.length * 3.4 + (gstLines.length ? gstLines.length * 3.4 + 2 : 0));

  doc.setDrawColor(...BORDER_COLOR);
  doc.rect(CONTENT_X, startY, CONTENT_WIDTH, boxHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.2);
  doc.text("Consignee", CONTENT_X + 1.5, startY + 4);
  doc.text("GST No.", CONTENT_X + 1.5, startY + boxHeight / 2 + 1.2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.9);
  if (addressLines.length > 0) {
    doc.text(addressLines, CONTENT_X + 18, startY + 4);
  }
  if (gstLines.length > 0) {
    doc.text(gstLines, CONTENT_X + 18, startY + boxHeight / 2 + 1.2);
  }

  return startY + boxHeight + 3;
}

function buildTableOptions(startY: number, head: UserOptions["head"], body: UserOptions["body"], columnStyles?: UserOptions["columnStyles"]): UserOptions {
  return {
    startY,
    margin: { left: CONTENT_X, right: CONTENT_X },
    head,
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 5.6,
      textColor: 0,
      cellPadding: { top: 1.2, right: 1.2, bottom: 1.2, left: 1.2 },
      lineColor: BORDER_COLOR,
      lineWidth: 0.18,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      lineColor: BORDER_COLOR,
      lineWidth: 0.2,
    },
    bodyStyles: {
      lineColor: BORDER_COLOR,
      lineWidth: 0.18,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.2,
    columnStyles,
  };
}

function drawSignatureRow(doc: jsPDF) {
  const baseY = FRAME_Y + FRAME_HEIGHT - 16;
  const segments = [
    { label: "Security", center: CONTENT_X + 18 },
    { label: "Dispatch Executive", center: FRAME_X + FRAME_WIDTH / 2 },
    { label: "Driver", center: CONTENT_X + CONTENT_WIDTH - 18 },
  ];

  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.8);
  segments.forEach((segment) => {
    doc.line(segment.center - 21, baseY, segment.center + 21, baseY);
    doc.text(segment.label, segment.center, baseY + 4.5, { align: "center" });
  });
}

function renderLinkedDetailSection(doc: jsPDF, startY: number, title: string, rows: LoadingSlip["phpDetails"]) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];

  const sectionY = drawSectionHeader(doc, title, startY);
  autoTable(
    doc,
    buildTableOptions(
      sectionY,
      [["SL", "Item Name", "Required Qty"]],
      safeRows.length > 0
        ? safeRows.map((row, index) => [index + 1, row?.itemName || "-", Number(row?.requiredQty || 0).toLocaleString()])
        : [["-", "-", "-"]],
      {
        0: { halign: "center", cellWidth: 10, fontStyle: "bold" },
        1: { cellWidth: 117 },
        2: { halign: "right", cellWidth: 28, fontStyle: "bold" },
      }
    )
  );

  return (doc as any).lastAutoTable.finalY + 3;
}

function renderPackingSection(
  doc: jsPDF,
  startY: number,
  title: string,
  packingDetails?: LoadingSlip["packingDetails"],
  extraItemsQty?: number
) {
  const sectionY = drawSectionHeader(doc, title, startY);
  const packingRows: Array<Array<string | number>> = Array.isArray(packingDetails) && packingDetails.length > 0
    ? packingDetails.map((detail, index) => [
        index + 1,
        Number(detail.bundles || 0).toLocaleString(),
        Number(detail.packSize || 0).toLocaleString(),
        Number(detail.quantity || 0).toLocaleString(),
      ])
    : [["-", "-", "-", "-"]];

  if (extraItemsQty) {
    packingRows.push(["", "Extra Items (Loose)", "", Number(extraItemsQty || 0).toLocaleString()]);
  }

  autoTable(
    doc,
    buildTableOptions(
      sectionY,
      [["SL", "Bundles", "Pack Size", "Quantity"]],
      packingRows,
      {
        0: { halign: "center", cellWidth: 10, fontStyle: "bold" },
        1: { halign: "right", cellWidth: 46 },
        2: { halign: "right", cellWidth: 46 },
        3: { halign: "right", cellWidth: 43, fontStyle: "bold" },
      }
    )
  );

  return (doc as any).lastAutoTable.finalY + 3;
}

function getLinkedPackingRows(details?: LinkedLoadingDetail[]) {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const rows = details.flatMap((detail) => Array.isArray(detail.packingDetails) ? detail.packingDetails : []);
  return rows.length > 0 ? rows : undefined;
}

function getLinkedExtraQty(details?: LinkedLoadingDetail[]) {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const total = details.reduce((sum, detail) => sum + Number(detail.extraItemsQty || 0), 0);
  return total > 0 ? total : undefined;
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
  drawOuterFrame(doc);

  let currentY = (await renderOrganizationHeader(doc, setting, {
    startY: CONTENT_Y,
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

  const companyDisplay = uniqueCompanies.length === 1 ? uniqueCompanies[0].name : uniqueCompanies.length > 1 ? "Multiple" : "-";
  const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);
  const truckDisplay = getTruckDisplay(trucks, slip.truckId);

  currentY = drawInfoGrid(doc, currentY, [
    ["Slip No", slip.slipNo || "-"],
    ["Date", formatDate(slip.date)],
    ["Company", companyDisplay],
    ["Truck No", truckDisplay],
    ["Total Qty", totalQty.toLocaleString()],
    ["Status", slip.status || "Active"],
  ]);

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
        0: { halign: "center", cellWidth: 10, fontStyle: "bold" },
        1: { cellWidth: 72 },
        2: { cellWidth: 52, textColor: SUBTLE_TEXT },
        3: { halign: "right", cellWidth: 21, fontStyle: "bold" },
      }
    )
  );

  currentY = (doc as any).lastAutoTable.finalY + 4;
  currentY = renderLinkedDetailSection(doc, currentY, "PHP DETAILS", slip.phpDetails);
  currentY = renderPackingSection(doc, currentY, "PHP PACKING DETAILS", getLinkedPackingRows(slip.phpDetails), getLinkedExtraQty(slip.phpDetails));
  currentY = renderLinkedDetailSection(doc, currentY, "PLATE DETAILS", slip.plateDetails);
  currentY = renderPackingSection(doc, currentY, "PLATE PACKING DETAILS", getLinkedPackingRows(slip.plateDetails), getLinkedExtraQty(slip.plateDetails));
  currentY = renderPackingSection(doc, currentY, "FG PACKING DETAILS", slip.packingDetails, slip.extraItemsQty) + 1;

  const footerY = Math.min(currentY + 3, FRAME_Y + FRAME_HEIGHT - 20);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(4.8);
  doc.setTextColor(...SUBTLE_TEXT);
  doc.text("System generated loading slip", FRAME_X + FRAME_WIDTH / 2, footerY, { align: "center" });
  doc.setTextColor(0, 0, 0);
  drawSignatureRow(doc);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
