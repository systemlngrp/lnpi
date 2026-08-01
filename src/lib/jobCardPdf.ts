import jsPDF from "jspdf";
import type { Company, Order, OrderSchedule, Production, Setting } from "../types";
import type { OrderCatalogItem } from "./orderItems";
import { formatDate } from "./serial";

type PdfArgs = {
  production: Production;
  schedule?: OrderSchedule | null;
  order?: Order | null;
  company?: Company | null;
  item?: OrderCatalogItem | null;
  itemErp?: string | number;
  phpItem?: OrderCatalogItem | null;
  plateItem?: OrderCatalogItem | null;
  setting?: Setting | null;
  createdBy?: string;
};

type Color = [number, number, number];

type CellOptions = {
  fill?: Color;
  bold?: boolean;
  align?: "left" | "center" | "right";
  fontSize?: number;
  textColor?: Color;
};

const ORANGE: Color = [248, 191, 143];
const LIGHT_ORANGE: Color = [252, 228, 214];
const WHITE: Color = [255, 255, 255];
const BLACK: Color = [0, 0, 0];

function hasValue(value: unknown) {
  return !(value === null || value === undefined || String(value).trim() === "");
}

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (hasValue(value)) return String(value).trim();
  }
  return "";
}

function num(value: unknown, decimals = 2) {
  if (!hasValue(value)) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function rawOf(item?: OrderCatalogItem | null) {
  return item?.raw || {};
}

function valueOf(production: Production, item: OrderCatalogItem | null | undefined, ...keys: string[]) {
  const raw = rawOf(item);
  for (const key of keys) {
    const prodValue = (production as any)[key];
    if (hasValue(prodValue)) return prodValue;
    const itemValue = (item as any)?.[key];
    if (hasValue(itemValue)) return itemValue;
    const rawValue = raw?.[key];
    if (hasValue(rawValue)) return rawValue;
  }
  return "";
}

function safeFileName(value: string) {
  return String(value || "JobCard").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "JobCard";
}

function cell(doc: jsPDF, x: number, y: number, w: number, h: number, text: unknown, options: CellOptions = {}) {
  const fill = options.fill || WHITE;
  const textColor = options.textColor || BLACK;
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, h, "FD");
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFont("helvetica", options.bold ? "bold" : "normal");
  doc.setFontSize(options.fontSize || 8);
  const content = String(text ?? "");
  const padding = 1.1;
  const maxWidth = Math.max(2, w - padding * 2);
  const lines = doc.splitTextToSize(content, maxWidth).slice(0, Math.max(1, Math.floor(h / 3.2)));
  const lineHeight = (options.fontSize || 8) * 0.35;
  const align = options.align || "center";
  let tx = x + w / 2;
  if (align === "left") tx = x + padding;
  if (align === "right") tx = x + w - padding;
  const ty = y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + lineHeight * 0.35;
  doc.text(lines, tx, ty, { align });
}

function section(doc: jsPDF, x: number, y: number, w: number, title: string) {
  cell(doc, x, y, w, 6.2, title, { fill: ORANGE, bold: true, align: "left", fontSize: 9 });
  return y + 6.2;
}

function layerRow(doc: jsPDF, x: number, y: number, label: string, gsm: unknown, bf: unknown, size: unknown, cutterLabel?: string) {
  cell(doc, x, y, 38, 6, label, { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 28, 6, num(gsm, 0), { bold: true });
  cell(doc, x + 66, y, 24, 6, firstValue(bf), { bold: true });
  cell(doc, x + 90, y, 28, 6, num(size), { bold: true });
  cell(doc, x + 118, y, 45, 6, cutterLabel || "", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 163, y, 33, 6, "");
}

function targetSize(production: Production, item?: OrderCatalogItem | null) {
  return firstValue(
    valueOf(production, item, "targetBox"),
    valueOf(production, item, "rapc"),
    production.requiredQty,
    production.qty
  );
}

function formatDimension(...values: unknown[]) {
  const parts = values.map((value) => firstValue(value));
  return parts.some(Boolean) ? parts.join("   ") : "";
}

export async function downloadJobCardPdf({ production, schedule, order, company, item, itemErp, phpItem, plateItem, setting, createdBy }: PdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");
  const raw = rawOf(item);
  const phpRaw = rawOf(phpItem);
  const plateRaw = rawOf(plateItem);
  const displayItemErp = firstValue(itemErp, production.erpCode, order?.erpCode, item?.erp, raw.erp, raw.erpCode, raw.erpItemCode, raw.masterItemNameErpCode);
  const phpErp = firstValue(phpItem?.erp, phpRaw.erp, phpRaw.erpCode, phpRaw.erpItemCode, phpRaw.masterErp, phpRaw.masterErpCode, phpRaw.masterItemNameErpCode);
  const plateErp = firstValue(plateItem?.erp, plateRaw.erp, plateRaw.erpCode, plateRaw.erpItemCode, plateRaw.masterErp, plateRaw.masterErpCode, plateRaw.masterItemNameErpCode);
  const x = 7;
  const w = 196;
  let y = 8;
  const orgName = firstValue(setting?.organizationName, "LAXMI NARAYAN PACKAGING INDUSTRIES");
  const jobNo = firstValue(production.jobCardNo, production.transactionNo);
  const partyName = firstValue(company?.name, production.companyName, item?.companyName, raw.customerName, raw.companyName, raw.company);
  const itemName = firstValue(item?.name, raw.itemName, production.itemId);
  const boxType = firstValue(production.jobType, item?.boxType, raw.boxType, production.methodology);
  const poQty = firstValue(order?.qty, schedule?.qty, production.plannedQty, production.qty);
  const lId = valueOf(production, item, "lengthId", "length");
  const wId = valueOf(production, item, "breadthId", "breadth");
  const hId = valueOf(production, item, "heightId", "height");
  const lOd = valueOf(production, item, "lengthOd", "lOd", "length");
  const wOd = valueOf(production, item, "breadthOd", "wOd", "breadth");
  const hOd = valueOf(production, item, "heightOd", "hOd", "height");
  const targetPaper = Number(production.topPaperWeightKg || production.totalPaperWeight || 0);
  const targetLiner = Number(production.linerWeightKg || 0);
  const totalTarget = Number(production.totalJobWeight || 0) || targetPaper + targetLiner;
  const hasPlateData = [plateItem?.erp, plateRaw.erpItemCode, plateRaw.masterItemNameErpCode, plateRaw.length, plateRaw.breadth, plateRaw.numberOfSetsPerBox].some(hasValue);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(`Created by:${firstValue(createdBy, production.updatedBy, "System User")}`, x, y + 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(orgName.toUpperCase(), x + w / 2, y + 5, { align: "center" });
  doc.line(x + 54, y + 6, x + 142, y + 6);
  y += 12;

  cell(doc, x, y, w, 11, "JOB CARD", { fill: ORANGE, bold: true, fontSize: 10 });
  cell(doc, x + 150, y, 29, 11, "SL. NO. -", { fill: ORANGE, bold: true, fontSize: 10 });
  cell(doc, x + 179, y, 17, 11, "", { fill: WHITE, bold: true });
  y += 11;

  const c1 = x;
  cell(doc, c1, y, 38, 6, "DATE", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, c1 + 38, y, 28, 6, formatDate(production.date), { bold: true });
  cell(doc, c1 + 66, y, 28, 6, "JOB NO.", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, c1 + 94, y, 38, 6, jobNo, { bold: true });
  cell(doc, c1 + 132, y, 44, 6, "Box Type", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, c1 + 176, y, 20, 6, boxType || "REGULAR", { bold: true, fontSize: 7 });
  y += 6;
  cell(doc, c1, y, 38, 6, "Lot No.", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, c1 + 38, y, 28, 6, firstValue((production as any).lotNo));
  cell(doc, c1 + 66, y, 28, 6, "PO QTY", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, c1 + 94, y, 38, 6, poQty, { bold: true });
  cell(doc, c1 + 132, y, 64, 6, "");
  y += 8;

  cell(doc, x, y, 38, 6, "Party Name", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, partyName, { bold: true });
  cell(doc, x + 104, y, 45, 6, "Target CS", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 149, y, 47, 6, firstValue(raw.csKgTarget, raw.csKgStd));
  y += 6;
  cell(doc, x, y, 38, 6, "Item Name", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, itemName, { bold: true });
  cell(doc, x + 104, y, 45, 6, "Target BS", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 149, y, 47, 6, firstValue(production.boardGsmReq, raw.boardGsmReq));
  y += 6;
  cell(doc, x, y, 38, 6, "Item ERP", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, displayItemErp, { bold: true });
  cell(doc, x + 104, y, 92, 6, "");
  y += 6;
  cell(doc, x, y, 38, 6, "Size (ID) L X W X H", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, formatDimension(lId, wId, hId), { bold: true });
  cell(doc, x + 104, y, 45, 6, "Flap", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 149, y, 47, 6, firstValue(raw.flapSize, (production as any).flap), { bold: true });
  y += 6;
  cell(doc, x, y, 38, 6, "Size (OD) L X W X H", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, formatDimension(lOd, wOd, hOd), { bold: true });
  cell(doc, x + 104, y, 45, 6, "Ply", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 149, y, 47, 6, firstValue(production.ply, raw.ply, raw.noOfPly), { bold: true });
  y += 6;
  cell(doc, x, y, 38, 6, "Printing Colour", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 66, 6, firstValue(production.color1, raw.color1, raw.printingColour1), { bold: true });
  cell(doc, x + 104, y, 45, 6, "Target Box weight", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 149, y, 47, 6, num(firstValue(production.weightPerPcSetReq, production.plateWeight, raw.calculatedWeightPerBox, raw.standardWeightGms)), { bold: true });
  y += 6;

  y = section(doc, x, y, w, "CFB SPECIFICATION");
  cell(doc, x, y, 42, 6, "Target Box", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, targetSize(production, item), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Deckle", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, num(firstValue(production.reelAsPerCalc, raw.deckleSize, raw.reelSize)), { bold: true });
  y += 6;
  cell(doc, x, y, 42, 6, "Flute Type", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, firstValue(production.fluteType, production.flute, raw.fluteType), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Cutting", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, num(firstValue(production.cuttingWithTrimming, raw.cuttingSize, raw.cuttingWithTrimming)), { bold: true });
  y += 6;
  cell(doc, x, y, 42, 6, "Flute %", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, firstValue(production.takeUpFactor, raw.takeUpFactor, raw.takeUp), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Papers", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, num(firstValue(production.paperRequiredNos, production.lineRequiredNos)), { bold: true });
  y += 6;
  cell(doc, x, y, 42, 6, "No. of Outs", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, firstValue(production.ups, raw.ups, raw.noOfUps), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Liners", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, num(firstValue(production.lineRequiredNos, production.paperRequiredNos)), { bold: true });
  y += 6;

  y = section(doc, x, y, w, "COMBINATION AND CUTTER SIZE");
  cell(doc, x, y, 38, 6, "POSITION", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 38, y, 28, 6, "GSM", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 24, 6, "BF", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 90, y, 28, 6, "SIZE", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 118, y, 78, 6, "CUTTER SIZE", { fill: LIGHT_ORANGE, bold: true });
  y += 6;
  layerRow(doc, x, y, "Top", production.top, raw.psL1Bf || raw.rsl1Bf, production.reelAsPerCalc || raw.deckleSize, "A");
  y += 6;
  layerRow(doc, x, y, "Fluting 1", production.f1, raw.psF1Bf || raw.rsf2Bf, production.reelAsPerCalc || raw.deckleSize, "B");
  y += 6;
  layerRow(doc, x, y, "Backing 1", production.l1, raw.psL1Bf || raw.rsl1Bf, production.reelAsPerCalc || raw.deckleSize, "C");
  y += 6;
  layerRow(doc, x, y, "Fluting 2", production.f2, raw.psF2Bf || raw.rsf4Bf, "", "D");
  y += 6;
  layerRow(doc, x, y, "Backing 2", production.l2, raw.psL2Bf, "");
  y += 6;
  layerRow(doc, x, y, "Fluting 3", "", "", "");
  y += 6;
  layerRow(doc, x, y, "Backing 3", production.l3, raw.psL3Bf || raw.rsl3Bf, "");
  cell(doc, x + 118, y - 6, 45, 6, "Overall GSM Target", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 163, y - 6, 33, 6, num(raw.standardBGsm, 0), { bold: true });
  cell(doc, x + 118, y, 45, 6, "Overall GSM Achieved", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 163, y, 33, 6, num(firstValue(production.gsm, raw.calculatedBGsm), 0), { bold: true });
  y += 6;

  y = section(doc, x, y, w, "REMARKS (if any)");
  cell(doc, x, y, w, 12, production.remarks || "", { align: "left" });
  y += 12;

  y = section(doc, x, y, w, "PLATE SPECIFICATION");
  cell(doc, x, y, 38, 6, "Plate ERP", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 158, 6, plateErp, { bold: true, align: "left" });
  y += 6;
  cell(doc, x, y, 38, 6, "Size (L X W)", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 46, 6, formatDimension(plateRaw.length, plateRaw.breadth, raw.cuttingSizeLengthPiece, raw.cuttingSizeWidthPiece));
  cell(doc, x + 84, y, 18, 6, "PLY", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 102, y, 46, 6, "Required Qty Per CFB", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, firstValue(plateRaw.numberOfSetsPerBox, production.setsPerBox, raw.numberOfSetsPerBox));
  y += 6;
  cell(doc, x, y, 84, 6, "Flute Direction", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 84, y, 18, 6, firstValue(plateRaw.fluteType, production.fluteType, production.flute, raw.fluteType));
  cell(doc, x + 102, y, 46, 6, "BS", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, hasPlateData ? firstValue(plateRaw.boardGsmReq, production.boardGsmReq, raw.boardGsmReq) : "");
  y += 6;

  y = section(doc, x, y, w, "PHP SPECIFICATION");
  cell(doc, x, y, 38, 6, "PHP ERP", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 158, 6, phpErp, { bold: true, align: "left" });
  y += 6;
  cell(doc, x, y, 38, 6, "Size (L X W X H)", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 64, 6, formatDimension(phpRaw.length, phpRaw.breadth, phpRaw.height, lOd, wOd, hOd));
  cell(doc, x + 102, y, 46, 6, "Required Qty Per CFB", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, firstValue(phpRaw.numberOfSetsPerBox, production.setsPerBox, raw.numberOfSetsPerBox));
  y += 6;
  const phpRows = [
    ["Holes (Length)", firstValue(phpRaw.holesOrientationL, raw.holesOrientationL, production.noOfHolesInPhp)],
    ["Holes (Width)", firstValue(phpRaw.holesOrientationW, raw.holesOrientationW)],
    ["Ply", firstValue(phpRaw.noOfPly, production.ply, raw.noOfPly)],
    ["Flute Direction", firstValue(phpRaw.fluteType, production.fluteType, production.flute, raw.fluteType)],
    ["GSM", firstValue(phpRaw.boardGsmReq, production.gsm, production.boardGsmReq, raw.calculatedBGsm)],
  ];
  cell(doc, x + 68, y, 128, 30, "PHP DIAGRAM", { fill: [253, 233, 217], bold: true });
  phpRows.forEach(([label, value], index) => {
    cell(doc, x, y + index * 6, 38, 6, label, { fill: LIGHT_ORANGE, bold: true, align: "left" });
    cell(doc, x + 38, y + index * 6, 30, 6, value, { bold: true });
  });
  y += 30;

  y = section(doc, x, y, w, "OFFICIAL DATA");
  cell(doc, x, y, 66, 7, "Target Paper Weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 7, targetPaper ? num(targetPaper, 0) : "", { bold: true });
  cell(doc, x + 104, y, 45, 7, "Actual Paper weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 7, production.actualPaperUsed ? num(production.actualPaperUsed, 2) : "");
  y += 7;
  cell(doc, x, y, 66, 7, "Target Liner Weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 7, targetLiner ? num(targetLiner, 0) : "", { bold: true });
  cell(doc, x + 104, y, 45, 7, "Actual Liner weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 7, "");
  y += 7;
  cell(doc, x, y, 66, 12, "Total Target weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 12, totalTarget ? num(totalTarget, 0) : "", { bold: true });
  cell(doc, x + 104, y, 45, 12, "Actual Consumed\nweight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 12, production.actualPaperUsed ? num(production.actualPaperUsed, 2) : "");
  y += 17;

  doc.setFont("helvetica", "bolditalic");
  doc.setTextColor(0, 32, 96);
  doc.setFontSize(8);
  doc.text("PREPARED BY", x + 10, 286);
  doc.text("APPROVED BY", x + w - 10, 286, { align: "right" });

  doc.save(`JobCard_${safeFileName(jobNo)}.pdf`);
}
