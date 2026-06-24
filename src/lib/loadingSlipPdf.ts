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
const TABLE_FONT = 12;
const TITLE_FONT = 12;

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

function drawTopMeta(doc: jsPDF, startY: number, meta: { slipNo: string; date: string; truckNo: string; erpCode: string; company: string; itemName: string }) {
  const leftX = TABLE_MARGIN_X;
  const totalW = PAGE_W - ((TABLE_MARGIN_X - PAGE_X) * 2);
  const labelW = 22;
  const leftValueW = 44;
  const rightLabelW = 28;
  const rightValueW = totalW - labelW - leftValueW - rightLabelW;
  const rowH = 11;
  const x1 = leftX + labelW;
  const x2 = x1 + leftValueW;
  const x3 = x2 + rightLabelW;
  const y1 = startY + rowH;
  const y2 = startY + rowH * 2;
  const totalH = rowH * 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(META_FONT);
  doc.text(`SL No: ${meta.slipNo || "-"}`, PAGE_X + PAGE_W - 1, startY - 1.5, { align: "right" });

  doc.setLineWidth(0.22);
  doc.roundedRect(leftX, startY, totalW, totalH, 4, 4);
  doc.line(x1, startY, x1, startY + totalH);
  doc.line(x2, startY, x2, startY + totalH);
  doc.line(x3, startY, x3, startY + totalH);
  doc.line(leftX, y1, leftX + totalW, y1);
  doc.line(leftX, y2, leftX + totalW, y2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(META_FONT);

  drawCellText(doc, "Date", leftX, startY + 6.8, labelW, "left");
  drawCellText(doc, meta.date, x1, startY + 6.8, leftValueW, "left");
  drawCellText(doc, "Customer", x2, startY + 6.8, rightLabelW, "left");
  drawCellText(doc, meta.company, x3, startY + 6.8, rightValueW, "right");

  drawCellText(doc, "ERP Code", leftX, y1 + 6.8, labelW, "left");
  drawCellText(doc, meta.erpCode, x1, y1 + 6.8, leftValueW, "left");
  drawCellText(doc, "Item Name", x2, y1 + 6.8, rightLabelW, "left");
  drawCellText(doc, meta.itemName, x3, y1 + 6.8, rightValueW, "right");

  drawCellText(doc, "Truck No", leftX, y2 + 6.8, labelW, "left");
  drawCellText(doc, meta.truckNo, x1, y2 + 6.8, leftValueW, "left");

  return startY + totalH + 3;
}

function drawSectionTitle(doc: jsPDF, title: string, startY: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TITLE_FONT);
  doc.text(title, PAGE_X + PAGE_W / 2, startY, { align: "center" });
  return startY + 1.5;
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

function renderSamplePackingTable(doc: jsPDF, startY: number, title: string, rows: PackingDetail[] | undefined, requiredQty?: number) {
  const sectionTitle = requiredQty != null ? `${title} (Required Qty = ${Number(requiredQty || 0).toLocaleString()})` : title;
  const titleY = drawSectionTitle(doc, sectionTitle, startY);
  const body = toPackingRows(rows);
  const safeBody = body.length > 0 ? body : [["", "", "", "", ""]];
  autoTable(doc, tableOptions(
    titleY,
    [["Line No", "Total Bundles", "Pack Size", "Extra", "Total"]],
    safeBody,
    {
      0: { halign: "center", cellWidth: 20, fontStyle: "bold" },
      1: { halign: "center", cellWidth: 38, fontStyle: "bold" },
      2: { halign: "center", cellWidth: 36, fontStyle: "bold" },
      3: { halign: "center", cellWidth: 28 },
      4: { halign: "center", cellWidth: 40, fontStyle: "bold" },
    }
  ));
  const finalY = (doc as any).lastAutoTable.finalY;
  const totalBundles = (rows || []).reduce((sum, row) => sum + Number(row.bundles || 0), 0);
  const totalQty = (rows || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  autoTable(doc, tableOptions(
    finalY,
    [],
    [["Totals", totalBundles ? totalBundles.toLocaleString() : "", "", "", totalQty ? totalQty.toLocaleString() : ""]],
    {
      0: { fontStyle: "bold", cellWidth: 20 },
      1: { halign: "center", cellWidth: 38, fontStyle: "bold" },
      2: { cellWidth: 36 },
      3: { cellWidth: 28 },
      4: { halign: "center", cellWidth: 40, fontStyle: "bold" },
    }
  ));
  return (doc as any).lastAutoTable.finalY + 3;
}

function drawTotalPhpPlate(doc: jsPDF, startY: number, totalQty: number) {
  autoTable(doc, tableOptions(
    startY,
    [],
    [["Total of PHP and Plate", Number(totalQty || 0).toLocaleString()]],
    {
      0: { fontStyle: "bold", cellWidth: 140 },
      1: { halign: "center", cellWidth: 30, fontStyle: "bold" },
    }
  ));
  return (doc as any).lastAutoTable.finalY + 6;
}

function drawSignatures(doc: jsPDF) {
  const y = PAGE_Y + PAGE_H - 18;
  const points = [
    { x: PAGE_X + 22, label: "Security" },
    { x: PAGE_X + PAGE_W / 2, label: "Dispatch Executive" },
    { x: PAGE_X + PAGE_W - 22, label: "Driver" },
  ];
  doc.setLineWidth(0.22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.2);
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
  const truckNo = String(trucks.find((row) => row.id === slip.truckId)?.truckNo || "-").trim() || "-";
  const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);

  currentY = drawTopMeta(doc, currentY + 2, {
    slipNo: String(slip.slipNo || "-"),
    date: formatDate(slip.date),
    truckNo,
    erpCode,
    company: companyName,
    itemName,
  });

  currentY = renderSamplePackingTable(doc, currentY, "Box Loading Details", slip.packingDetails, totalQty);

  const phpPacking = slip.phpDetails?.flatMap((detail) => detail.packingDetails || []) || [];
  currentY = renderSamplePackingTable(doc, currentY, "PHP Loading Details", phpPacking, undefined);

  const platePacking = slip.plateDetails?.flatMap((detail) => detail.packingDetails || []) || [];
  currentY = renderSamplePackingTable(doc, currentY, "Plate Loading Details", platePacking, undefined);

  const totalPhpPlate = phpPacking.reduce((sum, row) => sum + Number(row.quantity || 0), 0) + platePacking.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  currentY = drawTotalPhpPlate(doc, currentY, totalPhpPlate);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(4.5);
  doc.setTextColor(...DARK);
  doc.text("System generated loading slip", PAGE_X + PAGE_W / 2, Math.min(currentY + 2, PAGE_Y + PAGE_H - 24), { align: "center" });
  drawSignatures(doc);

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
