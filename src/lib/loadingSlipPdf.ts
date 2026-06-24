import jsPDF from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LinkedLoadingDetail, LoadingSlip, Order, PackingDetail, Setting, Truck } from "../types";
import { resolveLoadingSlipLineContext, summarizeLoadingSlip } from "./loadingSlipContext";
import { normalizeOrderCatalogItem } from "./orderItems";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

const PAGE_X = 12;
const PAGE_Y = 8;
const PAGE_W = 186;
const PAGE_H = 279;
const BLACK: [number, number, number] = [0, 0, 0];
const LIGHT: [number, number, number] = [245, 245, 245];
const DARK: [number, number, number] = [20, 20, 20];

function resolveFgItem(order?: Partial<Order> | null, npdItems?: Item[]) {
  if (!order || !npdItems) return undefined;
  return npdItems.map((row) => normalizeOrderCatalogItem(row, "FG")).find((row) => row && row.id === String(order.itemId || "").trim()) || undefined;
}

function tableOptions(startY: number, head: UserOptions["head"], body: UserOptions["body"], columnStyles?: UserOptions["columnStyles"]): UserOptions {
  return {
    startY,
    margin: { left: PAGE_X + 4, right: PAGE_X + 4 },
    head,
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 5.2,
      textColor: 0,
      cellPadding: { top: 1, right: 1, bottom: 1, left: 1 },
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

function drawPageBorder(doc: jsPDF) {
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.25);
  doc.rect(PAGE_X, PAGE_Y, PAGE_W, PAGE_H);
}

function drawTopMeta(doc: jsPDF, startY: number, meta: { slipNo: string; date: string; truckNo: string; erpCode: string; company: string; itemName: string }) {
  const leftX = PAGE_X + 4;
  const totalW = PAGE_W - 8;
  const halfW = totalW / 2;
  const labelW = 18;
  const rowH = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(`SL No: ${meta.slipNo || "-"}`, PAGE_X + PAGE_W - 6, startY - 1, { align: "right" });

  const rows: Array<[string, string, string, string]> = [
    ["Date", meta.date, "Truck No", meta.truckNo],
    ["ERP Code", meta.erpCode, "Company", meta.company],
    ["Item Name", meta.itemName, "", ""],
  ];

  rows.forEach((row, idx) => {
    const y = startY + idx * rowH;
    const rightValueW = halfW - labelW;
    doc.rect(leftX, y, labelW, rowH);
    doc.rect(leftX + labelW, y, rightValueW, rowH);
    doc.rect(leftX + halfW, y, labelW, rowH);
    doc.rect(leftX + halfW + labelW, y, rightValueW, rowH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    doc.text(row[0], leftX + 1, y + 4.8);
    doc.text(row[2], leftX + halfW + 1, y + 4.8);

    doc.setFont("helvetica", "bold");
    const leftValueLines = doc.splitTextToSize(String(row[1] || "-"), rightValueW - 2);
    const rightValueLines = doc.splitTextToSize(String(row[3] || "-"), rightValueW - 2);
    doc.text(leftValueLines, leftX + labelW + 1, y + 4.2);
    if (row[2]) doc.text(rightValueLines, leftX + halfW + labelW + 1, y + 4.2);
  });

  return startY + rows.length * rowH + 4;
}

function drawSectionTitle(doc: jsPDF, title: string, startY: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(title, PAGE_X + PAGE_W / 2, startY, { align: "center" });
  return startY + 2;
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
      1: { halign: "right", cellWidth: 38, fontStyle: "bold" },
      2: { halign: "right", cellWidth: 36, fontStyle: "bold" },
      3: { halign: "center", cellWidth: 28 },
      4: { halign: "right", cellWidth: 40, fontStyle: "bold" },
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
      1: { halign: "right", cellWidth: 38, fontStyle: "bold" },
      2: { cellWidth: 36 },
      3: { cellWidth: 28 },
      4: { halign: "right", cellWidth: 40, fontStyle: "bold" },
    }
  ));
  return (doc as any).lastAutoTable.finalY + 5;
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
  return (doc as any).lastAutoTable.finalY + 8;
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
  drawPageBorder(doc);

  let currentY = (await renderOrganizationHeader(doc, setting, {
    startY: PAGE_Y + 3,
    drawDivider: false,
    titleFontSize: 11,
    subtitleFontSize: 6,
  })).currentY;

  const resolveOrderItem = (order?: Partial<Order> | null) => resolveFgItem(order, npdItems);
  const summary = summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem: (order) => resolveOrderItem(order) as any });
  const firstContext = summary.lineContexts[0];
  const companyName = summary.companyNames[0] || firstContext?.companyName || slip.companyName || "-";
  const erpCode = summary.erpCodes[0] || firstContext?.erpCode || "-";
  const itemName = summary.itemNames[0] || firstContext?.itemName || slip.lines[0]?.itemName || "-";
  const truckNo = String(trucks.find((row) => row.id === slip.truckId)?.truckNo || "-").trim() || "-";
  const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);

  currentY = drawTopMeta(doc, currentY + 3, {
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
