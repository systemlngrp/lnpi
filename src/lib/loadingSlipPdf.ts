import jsPDF from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LoadingSlip, Order, PackingDetail, Setting, Truck } from "../types";
import { summarizeLoadingSlip } from "./loadingSlipContext";
import { normalizeOrderCatalogItem } from "./orderItems";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

const PAGE_X = 12;
const PAGE_Y = 8;
const PAGE_W = 186;
const PAGE_H = 279;
const BLACK: [number, number, number] = [0, 0, 0];
const LIGHT: [number, number, number] = [245, 245, 245];
const DARK: [number, number, number] = [20, 20, 20];
const TABLE_MARGIN_X = PAGE_X + 1;
const META_FONT = 9;
const TABLE_FONT = 8.5;
const TITLE_FONT = 10;
const CONTENT_W = PAGE_W - ((TABLE_MARGIN_X - PAGE_X) * 2);
const PACKING_COL_WIDTHS = {
  lineNo: 20,
  bundles: 41,
  packSize: 41,
  extra: 41,
  total: 41,
};
const BOX_TOP_GAP = 4;

function resolveFgItem(order?: Partial<Order> | null, npdItems?: Item[]) {
  if (!order || !npdItems) return undefined;
  return npdItems.map((row) => normalizeOrderCatalogItem(row, "FG")).find((row) => row && row.id === String(order.itemId || "").trim()) || undefined;
}

function tableOptions(startY: number, head: UserOptions["head"], body: UserOptions["body"], columnStyles?: UserOptions["columnStyles"]): UserOptions {
  return {
    startY,
    margin: { left: TABLE_MARGIN_X, right: TABLE_MARGIN_X },
    head,
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: TABLE_FONT,
      textColor: 0,
      halign: "center",
      cellPadding: { top: 1.2, right: 1.2, bottom: 1.2, left: 1.2 },
      lineColor: BLACK,
      lineWidth: 0.2,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: LIGHT,
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      lineColor: BLACK,
      lineWidth: 0.22,
    },
    bodyStyles: {
      lineColor: BLACK,
      lineWidth: 0.2,
    },
    tableLineColor: BLACK,
    tableLineWidth: 0.22,
    columnStyles,
  };
}

function drawCellText(doc: jsPDF, text: string, x: number, y: number, width: number, align: "left" | "right" | "center") {
  const safeText = String(text || "-");
  const lines = doc.splitTextToSize(safeText, Math.max(4, width - 3));
  const tx = align === "left" ? x + 1.2 : align === "right" ? x + width - 1.2 : x + width / 2;
  doc.text(lines, tx, y, { align });
}

function getWrappedLines(doc: jsPDF, text: string, width: number) {
  return doc.splitTextToSize(String(text || "-"), Math.max(4, width - 3));
}

function drawTopMeta(doc: jsPDF, startY: number, meta: { slipNo: string; date: string; truckNo: string; erpCode: string; company: string; itemName: string }) {
  const leftX = TABLE_MARGIN_X;
  const totalW = CONTENT_W;
  const labelW = 26;
  const valueW = totalW - labelW;
  const x1 = leftX + labelW;
  const rows = [
    { label: "Date", value: meta.date, align: "left" as const },
    { label: "Customer", value: meta.company, align: "left" as const },
    { label: "ERP Code", value: meta.erpCode, align: "left" as const },
    { label: "Item Name", value: meta.itemName, align: "left" as const },
    { label: "Truck No", value: meta.truckNo, align: "left" as const },
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(META_FONT);
  doc.text(`SL No: ${meta.slipNo || "-"}`, PAGE_X + PAGE_W - 1, startY - 1, { align: "right" });

  const rowHeights = rows.map((row) => {
    const wrapped = getWrappedLines(doc, row.value, valueW);
    const lineCount = Math.max(1, Array.isArray(wrapped) ? wrapped.length : 1);
    return Math.max(7.5, 4.8 + lineCount * 3.7);
  });
  const totalH = rowHeights.reduce((sum, height) => sum + height, 0);

  doc.setLineWidth(0.22);
  doc.roundedRect(leftX, startY, totalW, totalH, 4, 4);
  doc.line(x1, startY, x1, startY + totalH);
  let runningY = startY;
  for (let rowIndex = 0; rowIndex < rowHeights.length - 1; rowIndex += 1) {
    runningY += rowHeights[rowIndex];
    doc.line(leftX, runningY, leftX + totalW, runningY);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(META_FONT);
  let textY = startY;
  rows.forEach((row, index) => {
    const baselineY = textY + 4.9;
    drawCellText(doc, row.label, leftX, baselineY, labelW, "left");
    drawCellText(doc, row.value, x1, baselineY, valueW, row.align);
    textY += rowHeights[index];
  });

  return startY + totalH + 3;
}

function drawSectionTitle(doc: jsPDF, title: string, startY: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TITLE_FONT);
  doc.text(title, PAGE_X + PAGE_W / 2, startY, { align: "center" });
  return startY + 0.8;
}

function drawCenteredText(doc: jsPDF, text: string, x: number, y: number, width: number) {
  const safeText = String(text || "").trim();
  const lines = doc.splitTextToSize(safeText || " ", Math.max(4, width - 2));
  doc.text(lines, x + width / 2, y, { align: "center" });
}

function toPackingRows(details?: PackingDetail[]) {
  return (Array.isArray(details) ? details : []).map((row, index) => [
    index + 1,
    Number(row.bundles || 0).toLocaleString(),
    Number(row.packSize || 0).toLocaleString(),
    Number(row.extra || 0) ? Number(row.extra || 0).toLocaleString() : "",
    Number(row.quantity || 0).toLocaleString(),
  ]);
}

function renderSamplePackingTable(
  doc: jsPDF,
  startY: number,
  title: string,
  rows: PackingDetail[] | undefined,
  requiredQty?: number,
  extraQty?: number
) {
  const sectionTitle = requiredQty != null ? `${title} (Required Qty = ${Number(requiredQty || 0).toLocaleString()})` : title;
  const titleY = drawSectionTitle(doc, sectionTitle, startY + BOX_TOP_GAP);
  const body = toPackingRows(rows);
  const safeBody = body.length > 0 ? body : [["", "", "", "", ""]];
  const totalBundles = (rows || []).reduce((sum, row) => sum + Number(row.bundles || 0), 0);
  const totalQty = (rows || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const totalExtra = Number(extraQty || 0);
  const header = ["Line No", "Total Bundles", "Pack Size", "Extra", "Total"];
  const columns = [
    PACKING_COL_WIDTHS.lineNo,
    PACKING_COL_WIDTHS.bundles,
    PACKING_COL_WIDTHS.packSize,
    PACKING_COL_WIDTHS.extra,
    PACKING_COL_WIDTHS.total,
  ];
  const leftX = TABLE_MARGIN_X;
  const topY = titleY + 1;
  const rowH = 8;
  const totalW = columns.reduce((sum, width) => sum + width, 0);
  const totalRows = 1 + safeBody.length + 1;
  const totalH = rowH * totalRows;

  doc.setLineWidth(0.22);
  doc.roundedRect(leftX, topY, totalW, totalH, 4, 4);

  let runningX = leftX;
  columns.slice(0, -1).forEach((width) => {
    runningX += width;
    doc.line(runningX, topY, runningX, topY + totalH);
  });

  for (let index = 1; index < totalRows; index += 1) {
    const y = topY + rowH * index;
    doc.line(leftX, y, leftX + totalW, y);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TABLE_FONT);

  let cellX = leftX;
  header.forEach((label, index) => {
    drawCenteredText(doc, label, cellX, topY + 5.4, columns[index]);
    cellX += columns[index];
  });

  safeBody.forEach((row, rowIndex) => {
    let rowX = leftX;
    row.forEach((value, cellIndex) => {
      drawCenteredText(doc, String(value || ""), rowX, topY + rowH * (rowIndex + 1) + 5.4, columns[cellIndex]);
      rowX += columns[cellIndex];
    });
  });

  const totalsRow = [
    "Totals",
    totalBundles ? totalBundles.toLocaleString() : "",
    "",
    totalExtra ? totalExtra.toLocaleString() : "",
    totalQty || totalExtra ? (totalQty + totalExtra).toLocaleString() : "",
  ];
  let totalX = leftX;
  totalsRow.forEach((value, cellIndex) => {
    drawCenteredText(doc, value, totalX, topY + rowH * (safeBody.length + 1) + 5.4, columns[cellIndex]);
    totalX += columns[cellIndex];
  });

  return topY + totalH + 2;
}

function drawTotalPhpPlate(doc: jsPDF, startY: number, totalQty: number) {
  autoTable(doc, tableOptions(
    startY,
    [],
    [["Total of PHP and Plate", Number(totalQty || 0).toLocaleString()]],
    {
      0: { halign: "center", fontStyle: "bold", cellWidth: PACKING_COL_WIDTHS.lineNo + PACKING_COL_WIDTHS.bundles + PACKING_COL_WIDTHS.packSize + PACKING_COL_WIDTHS.extra },
      1: { halign: "center", cellWidth: PACKING_COL_WIDTHS.total, fontStyle: "bold" },
    }
  ));
  return (doc as any).lastAutoTable.finalY + 5;
}

function drawSignatures(doc: jsPDF) {
  const y = PAGE_Y + PAGE_H - 14;
  const points = [
    { x: PAGE_X + 22, label: "Security" },
    { x: PAGE_X + PAGE_W / 2, label: "Dispatch Executive" },
    { x: PAGE_X + PAGE_W - 22, label: "Driver" },
  ];
  doc.setLineWidth(0.22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.8);
  points.forEach((point) => {
    doc.line(point.x - 18, y, point.x + 18, y);
    doc.text(point.label, point.x, y + 4, { align: "center" });
  });
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

  let currentY = (await renderOrganizationHeader(doc, setting, {
    startY: PAGE_Y + 3,
    drawDivider: false,
  } as any)).currentY;

  const resolveOrderItem = (order?: Partial<Order> | null) => resolveFgItem(order, npdItems);
  const summary = summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem: (order) => resolveOrderItem(order) as any });
  const firstContext = summary.lineContexts[0];
  const companyName = summary.companyNames[0] || firstContext?.companyName || slip.companyName || "-";
  const erpCode = summary.erpCodes[0] || firstContext?.erpCode || "-";
  const itemName = summary.itemNames[0] || firstContext?.itemName || slip.lines[0]?.itemName || "-";
  const truckNo = String(slip.truckNo || trucks.find((row) => row.id === slip.truckId)?.truckNo || "-").trim() || "-";
  const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);
  const boxExtraQty = Number(slip.extraItemsQty || 0) || 0;
  const phpRequiredQty = (slip.phpDetails || []).reduce((sum, detail) => sum + Number(detail.requiredQty || 0), 0);
  const plateRequiredQty = (slip.plateDetails || []).reduce((sum, detail) => sum + Number(detail.requiredQty || 0), 0);
  const phpExtraQty = (slip.phpDetails || []).reduce((sum, detail) => sum + Number(detail.extraItemsQty || 0), 0);
  const plateExtraQty = (slip.plateDetails || []).reduce((sum, detail) => sum + Number(detail.extraItemsQty || 0), 0);

  currentY = drawTopMeta(doc, currentY + 2, {
    slipNo: String(slip.slipNo || "-"),
    date: formatDate(slip.date),
    truckNo,
    erpCode,
    company: companyName,
    itemName,
  });

  currentY = renderSamplePackingTable(doc, currentY, "Box Loading Details", slip.packingDetails, totalQty, boxExtraQty);

  const phpPacking = slip.phpDetails?.flatMap((detail) => detail.packingDetails || []) || [];
  currentY = renderSamplePackingTable(doc, currentY, "PHP Loading Details", phpPacking, phpRequiredQty || undefined, phpExtraQty);

  const platePacking = slip.plateDetails?.flatMap((detail) => detail.packingDetails || []) || [];
  currentY = renderSamplePackingTable(doc, currentY, "Plate Loading Details", platePacking, plateRequiredQty || undefined, plateExtraQty);

  const totalPhpPlate =
    phpPacking.reduce((sum, row) => sum + Number(row.quantity || 0), 0) +
    platePacking.reduce((sum, row) => sum + Number(row.quantity || 0), 0) +
    phpExtraQty +
    plateExtraQty;
  currentY = drawTotalPhpPlate(doc, currentY, totalPhpPlate);

  drawSignatures(doc);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
