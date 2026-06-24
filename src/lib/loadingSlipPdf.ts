import jsPDF from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LinkedLoadingDetail, LoadingSlip, LoadingSlipAllocation, Setting, Truck } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

const FRAME_X = 18;
const FRAME_Y = 12;
const FRAME_WIDTH = 174;
const FRAME_HEIGHT = 206;
const CONTENT_X = FRAME_X + 3;
const CONTENT_Y = FRAME_Y + 3;
const CONTENT_WIDTH = FRAME_WIDTH - 6;
const BLACK: [number, number, number] = [0, 0, 0];
const DARK_GRAY: [number, number, number] = [40, 40, 40];
const MID_GRAY: [number, number, number] = [120, 120, 120];
const LIGHT_GRAY: [number, number, number] = [240, 240, 240];
const VERY_LIGHT_GRAY: [number, number, number] = [248, 248, 248];

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
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.3);
  doc.rect(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT);
}

function drawWatermark(doc: jsPDF, text: string) {
  const safeText = String(text || "LOADING SLIP").trim();
  if (!safeText) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(245, 245, 245);
  doc.text(safeText, FRAME_X + FRAME_WIDTH / 2, FRAME_Y + FRAME_HEIGHT / 2, {
    align: "center",
    angle: 0,
  });
  doc.setTextColor(0, 0, 0);
}

function drawTitleBand(doc: jsPDF, startY: number) {
  doc.setFillColor(...BLACK);
  doc.roundedRect(CONTENT_X, startY, CONTENT_WIDTH, 7, 0.8, 0.8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.text("LOADING SLIP", FRAME_X + FRAME_WIDTH / 2, startY + 4.7, { align: "center" });
  doc.setTextColor(0, 0, 0);
  return startY + 8.8;
}

function drawSectionHeader(doc: jsPDF, title: string, startY: number) {
  doc.setFillColor(...LIGHT_GRAY);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.2);
  doc.rect(CONTENT_X, startY, CONTENT_WIDTH, 5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.9);
  doc.text(title, CONTENT_X + 1.8, startY + 3.35);
  return startY + 5.8;
}

function drawInfoGrid(doc: jsPDF, startY: number, details: Array<[string, string]>) {
  const rowHeight = 4.5;
  const halfWidth = CONTENT_WIDTH / 2;
  const labelWidth = 16;

  details.forEach(([label, value], index) => {
    const left = index % 2 === 0;
    const row = Math.floor(index / 2);
    const x = left ? CONTENT_X : CONTENT_X + halfWidth;
    const y = startY + row * rowHeight;

    doc.setFillColor(...VERY_LIGHT_GRAY);
    doc.rect(x, y, labelWidth, rowHeight, "F");
    doc.setDrawColor(...BLACK);
    doc.rect(x, y, labelWidth, rowHeight);
    doc.rect(x + labelWidth, y, halfWidth - labelWidth, rowHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.text(label, x + 1, y + 3);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text(String(value || "-"), x + labelWidth + 1, y + 3);
  });

  return startY + Math.ceil(details.length / 2) * rowHeight + 1.8;
}

function drawCompanyBlock(doc: jsPDF, company: Company, startY: number) {
  const addressParts = [company.address, company.district, company.state]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const addressText = addressParts.join(", ");
  const gstText = String(company.gstNo || "").trim();

  const addressLines = addressText ? doc.splitTextToSize(addressText, CONTENT_WIDTH - 22) : [];
  const gstLines = gstText ? doc.splitTextToSize(gstText, CONTENT_WIDTH - 22) : [];
  const boxHeight = Math.max(10.5, 4.2 + addressLines.length * 3 + (gstLines.length ? gstLines.length * 3 + 1.2 : 0));

  doc.setDrawColor(...BLACK);
  doc.rect(CONTENT_X, startY, CONTENT_WIDTH, boxHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.text("Consignee", CONTENT_X + 1, startY + 3.2);
  doc.text("GST No.", CONTENT_X + 1, startY + boxHeight / 2 + 0.9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.3);
  if (addressLines.length > 0) doc.text(addressLines, CONTENT_X + 16, startY + 3.2);
  if (gstLines.length > 0) doc.text(gstLines, CONTENT_X + 16, startY + boxHeight / 2 + 0.9);

  return startY + boxHeight + 2.2;
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
      fontSize: 5.2,
      textColor: 0,
      cellPadding: { top: 1.1, right: 1.1, bottom: 1.1, left: 1.1 },
      lineColor: BLACK,
      lineWidth: 0.16,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: DARK_GRAY,
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      lineColor: BLACK,
      lineWidth: 0.18,
    },
    bodyStyles: {
      lineColor: BLACK,
      lineWidth: 0.16,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    tableLineColor: BLACK,
    tableLineWidth: 0.18,
    columnStyles,
  };
}

function drawSignatureRow(doc: jsPDF) {
  const baseY = FRAME_Y + FRAME_HEIGHT - 14;
  const segments = [
    { label: "Security", center: CONTENT_X + 19 },
    { label: "Dispatch Executive", center: FRAME_X + FRAME_WIDTH / 2 },
    { label: "Driver", center: CONTENT_X + CONTENT_WIDTH - 19 },
  ];

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.7);
  segments.forEach((segment) => {
    doc.line(segment.center - 18, baseY, segment.center + 18, baseY);
    doc.text(segment.label, segment.center, baseY + 4, { align: "center" });
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
        1: { cellWidth: 120 },
        2: { halign: "right", cellWidth: 28, fontStyle: "bold" },
      }
    )
  );

  return (doc as any).lastAutoTable.finalY + 2.4;
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
        1: { halign: "right", cellWidth: 49 },
        2: { halign: "right", cellWidth: 49 },
        3: { halign: "right", cellWidth: 49, fontStyle: "bold" },
      }
    )
  );

  return (doc as any).lastAutoTable.finalY + 2.4;
}

function getLinkedPackingRows(details?: LinkedLoadingDetail[]) {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const rows = details.flatMap((detail) => (Array.isArray(detail.packingDetails) ? detail.packingDetails : []));
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
  orders: any[];
  npdItems: Item[];
  companies: Company[];
}) {
  const doc = new jsPDF("p", "mm", "a4");
  drawOuterFrame(doc);
  drawWatermark(doc, String(setting?.organizationName || "LAXMI NARAYAN"));

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
        1: { cellWidth: 78 },
        2: { cellWidth: 47, textColor: MID_GRAY },
        3: { halign: "right", cellWidth: 27, fontStyle: "bold" },
      }
    )
  );

  currentY = (doc as any).lastAutoTable.finalY + 3;
  currentY = renderPackingSection(doc, currentY, "FG PACKING DETAILS", slip.packingDetails, slip.extraItemsQty);
  currentY = renderLinkedDetailSection(doc, currentY, "PHP DETAILS", slip.phpDetails);
  currentY = renderPackingSection(doc, currentY, "PHP PACKING DETAILS", getLinkedPackingRows(slip.phpDetails), getLinkedExtraQty(slip.phpDetails));
  currentY = renderLinkedDetailSection(doc, currentY, "PLATE DETAILS", slip.plateDetails);
  currentY = renderPackingSection(doc, currentY, "PLATE PACKING DETAILS", getLinkedPackingRows(slip.plateDetails), getLinkedExtraQty(slip.plateDetails));

  const footerY = Math.min(currentY + 2, FRAME_Y + FRAME_HEIGHT - 18);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(4.6);
  doc.setTextColor(...MID_GRAY);
  doc.text("System generated loading slip", FRAME_X + FRAME_WIDTH / 2, footerY, { align: "center" });
  doc.setTextColor(0, 0, 0);
  drawSignatureRow(doc);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
