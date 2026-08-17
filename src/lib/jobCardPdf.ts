import jsPDF from "jspdf";
import type { Company, Material, MaterialInPackingSlip, MaterialIssueReelLine, MaterialReturnReelLine, Order, OrderSchedule, Production, ProductionProcessing, Setting } from "../types";
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
  materials?: Material[];
  packingSlips?: MaterialInPackingSlip[];
  issueReelLines?: MaterialIssueReelLine[];
  returnReelLines?: MaterialReturnReelLine[];
  processingEntries?: ProductionProcessing[];
  setting?: Setting | null;
  createdBy?: string;
};

type Color = [number, number, number];

type CellOptions = {
  fill?: Color;
  bold?: boolean;
  align?: "left" | "center" | "right";
  fontSize?: number;
  minFontSize?: number;
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

function wholeNum(value: unknown) {
  if (!hasValue(value)) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fixedNum(value: unknown, decimals = 2) {
  if (!hasValue(value)) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function mmToInch(value: unknown) {
  if (!hasValue(value)) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return fixedNum(n / 25.4, 2);
}

function rawOf(item?: OrderCatalogItem | null) {
  return item?.raw || {};
}
function getStandardBoxWeight(item?: OrderCatalogItem | null) {
  const raw = rawOf(item);
  const value = raw.standardWeightGms ?? (item as any)?.standardWeightGms;
  if (!hasValue(value)) return "";
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : "";
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

function fittedCellText(doc: jsPDF, content: string, maxWidth: number, maxHeight: number, fontSize: number, minFontSize: number) {
  let size = fontSize;
  let lineHeight = size * 0.35;
  let maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  let lines = doc.splitTextToSize(content, maxWidth) as string[];

  while ((lines.length > maxLines || lines.some((line) => doc.getTextWidth(line) > maxWidth)) && size > minFontSize) {
    size = Math.max(minFontSize, size - 0.5);
    doc.setFontSize(size);
    lineHeight = size * 0.35;
    maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
    lines = doc.splitTextToSize(content, maxWidth) as string[];
  }

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIndex = lines.length - 1;
    if (lastIndex >= 0 && content.trim()) {
      let lastLine = lines[lastIndex];
      while (lastLine.length > 1 && doc.getTextWidth(`${lastLine}...`) > maxWidth) {
        lastLine = lastLine.slice(0, -1);
      }
      lines[lastIndex] = `${lastLine}...`;
    }
  }

  return { lines, fontSize: size, lineHeight };
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
  const fontSize = options.fontSize || 8;
  doc.setFontSize(fontSize);
  const content = String(text ?? "");
  const padding = 1.1;
  const maxWidth = Math.max(2, w - padding * 2);
  const maxHeight = Math.max(2, h - padding * 1.4);
  const fitted = fittedCellText(doc, content, maxWidth, maxHeight, fontSize, options.minFontSize || 5);
  doc.setFontSize(fitted.fontSize);
  const align = options.align || "center";
  let tx = x + w / 2;
  if (align === "left") tx = x + padding;
  if (align === "right") tx = x + w - padding;
  const ty = y + h / 2 - ((fitted.lines.length - 1) * fitted.lineHeight) / 2 + fitted.lineHeight * 0.35;
  doc.text(fitted.lines, tx, ty, { align });
}

function section(doc: jsPDF, x: number, y: number, w: number, title: string) {
  cell(doc, x, y, w, 6.2, title, { fill: ORANGE, bold: true, align: "left", fontSize: 9 });
  return y + 6.2;
}

function layerRow(doc: jsPDF, x: number, y: number, label: string, gsm: unknown, bf: unknown, size: unknown, cutterLabel?: string) {
  cell(doc, x, y, 38, 6, label, { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 28, 6, num(gsm, 0), { bold: true });
  cell(doc, x + 66, y, 24, 6, firstValue(bf), { bold: true });
  cell(doc, x + 90, y, 28, 6, mmToInch(size), { bold: true });
  cell(doc, x + 118, y, 45, 6, cutterLabel || "", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 163, y, 33, 6, "");
}


type ReelConsumptionPdfRow = {
  reelNo: string;
  tfb: string;
  bf: string;
  gsm: string;
  weight: number;
  balance: number;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizedNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? round2(n) : undefined;
}

function inferTfb(production: Production, raw: any, material?: Material) {
  const materialGsm = normalizedNumber(material?.gsm);
  const materialBf = normalizedNumber(material?.bf);
  if (!materialGsm) return "";

  const candidates = [
    { label: "T", gsm: production.top, bf: raw.psL1Bf || raw.rsl1Bf },
    { label: "F", gsm: production.f1, bf: raw.psF1Bf || raw.rsf2Bf },
    { label: "B", gsm: production.l1, bf: raw.psL1Bf || raw.rsl1Bf },
    { label: "F", gsm: production.f2, bf: raw.psF2Bf || raw.rsf4Bf },
    { label: "B", gsm: production.l2, bf: raw.psL2Bf },
    { label: "B", gsm: production.l3, bf: raw.psL3Bf || raw.rsl3Bf },
  ].filter((row) => {
    const rowGsm = normalizedNumber(row.gsm);
    if (!rowGsm || rowGsm !== materialGsm) return false;
    const rowBf = normalizedNumber(row.bf);
    return !materialBf || !rowBf || rowBf === materialBf;
  });

  const labels = Array.from(new Set(candidates.map((row) => row.label)));
  return labels.length === 1 ? labels[0] : "";
}

function buildReelConsumptionRows({
  production,
  raw,
  materials = [],
  packingSlips = [],
  issueReelLines = [],
  returnReelLines = [],
}: {
  production: Production;
  raw: any;
  materials?: Material[];
  packingSlips?: MaterialInPackingSlip[];
  issueReelLines?: MaterialIssueReelLine[];
  returnReelLines?: MaterialReturnReelLine[];
}): ReelConsumptionPdfRow[] {
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
  const jobReturnedBySlip = new Map<string, number>();

  returnReelLines.forEach((line) => {
    if (line.productionId !== production.id) return;
    jobReturnedBySlip.set(line.packingSlipId, (jobReturnedBySlip.get(line.packingSlipId) || 0) + Number(line.weightKg || 0));
  });

  const rowsBySlip = new Map<string, ReelConsumptionPdfRow>();
  issueReelLines
    .filter((line) => line.productionId === production.id)
    .forEach((line) => {
      const slip = packingSlipMap.get(line.packingSlipId);
      const material = materialMap.get(line.materialId || slip?.materialId || "");
      const issuedForJobSlip = issueReelLines
        .filter((entry) => entry.productionId === production.id && entry.packingSlipId === line.packingSlipId)
        .reduce((sum, entry) => sum + Number(entry.weightKg || 0), 0);
      const returnedForJobSlip = jobReturnedBySlip.get(line.packingSlipId) || 0;

      rowsBySlip.set(line.packingSlipId, {
        reelNo: firstValue(line.ourReelNo, slip?.ourReelNo),
        tfb: inferTfb(production, raw, material),
        bf: firstValue(material?.bf),
        gsm: firstValue(material?.gsm),
        weight: round2(issuedForJobSlip),
        balance: round2(returnedForJobSlip),
      });
    });

  return Array.from(rowsBySlip.values()).filter((row) => row.weight > 0);
}

function processingTimestamp(entry: ProductionProcessing) {
  return firstValue(entry.updateTimestamp, entry.date);
}

function processingTimeValue(entry: ProductionProcessing) {
  return new Date(processingTimestamp(entry) || 0).getTime() || 0;
}

function processingDateLabel(entry?: ProductionProcessing) {
  if (!entry) return "";
  const timestamp = processingTimestamp(entry);
  if (!timestamp) return "";
  if (!entry.updateTimestamp) return formatDate(timestamp);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleString();
}


function actualPaperUsedForJob(
  production: Production,
  issueReelLines: MaterialIssueReelLine[] = [],
  returnReelLines: MaterialReturnReelLine[] = []
) {
  const savedActualPaperUsed = Number(production.actualPaperUsed || 0);
  if (savedActualPaperUsed > 0) return savedActualPaperUsed;
  const issued = issueReelLines
    .filter((line) => line.productionId === production.id)
    .reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
  const returned = returnReelLines
    .filter((line) => line.productionId === production.id)
    .reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
  return Math.max(0, round2(issued - returned));
}

function calculatedWastagePercent(
  production: Production,
  issueReelLines: MaterialIssueReelLine[] = [],
  returnReelLines: MaterialReturnReelLine[] = []
) {
  const prodFromFFG = Number(production.prodFromFFG || 0);
  const sheetWeight = Number(production.sheetWeight || 0);
  const actualPaperUsed = actualPaperUsedForJob(production, issueReelLines, returnReelLines);
  if (!(prodFromFFG > 0 && sheetWeight > 0 && actualPaperUsed > 0)) return "";
  return round2(100 - ((prodFromFFG * sheetWeight) / actualPaperUsed) * 100);
}
function normalizeProcessMachineName(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function sumProcessingQty(entries: ProductionProcessing[], machineName: string) {
  const normalized = normalizeProcessMachineName(machineName);
  return entries
    .filter((entry) => normalizeProcessMachineName(entry.machineName) === normalized)
    .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
}

function pageSection(doc: jsPDF, x: number, y: number, w: number, title: string) {
  return section(doc, x, y, w, title);
}

function ensureSecondPageSpace(doc: jsPDF, y: number, needed: number, x: number, w: number, title?: string) {
  if (y + needed <= 286) return y;
  doc.addPage();
  const nextY = 12;
  return title ? pageSection(doc, x, nextY, w, title) : nextY;
}

function drawJobCardOperationsPage(doc: jsPDF, args: {
  production: Production;
  raw: any;
  materials?: Material[];
  packingSlips?: MaterialInPackingSlip[];
  issueReelLines?: MaterialIssueReelLine[];
  returnReelLines?: MaterialReturnReelLine[];
  processingEntries?: ProductionProcessing[];
}) {
  const x = 7;
  const w = 196;
  let y = 12;
  doc.addPage();

  const reelRows = buildReelConsumptionRows(args);
  y = pageSection(doc, x, y, w, "Reel Consumption Details");
  const widths = [36, 26, 18, 18, 42, 56];
  const headers = ["Reel No.", "T/F/B", "BF", "GSM", "Weight", "Balance Reel"];
  const drawReelHeader = (headerY: number) => {
    let cx = x;
    headers.forEach((header, index) => {
      cell(doc, cx, headerY, widths[index], 6, header, { fill: WHITE, bold: true });
      cx += widths[index];
    });
    return headerY + 6;
  };
  y = drawReelHeader(y);

  const rowsToDraw = reelRows.length ? reelRows : Array.from({ length: 8 }, () => null as ReelConsumptionPdfRow | null);
  rowsToDraw.forEach((row) => {
    if (y + 6 > 286) {
      doc.addPage();
      y = pageSection(doc, x, 12, w, "Reel Consumption Details");
      y = drawReelHeader(y);
    }
    const values = row ? [row.reelNo, row.tfb, row.bf, row.gsm, num(row.weight, 2), num(row.balance, 2)] : ["", "", "", "", "", ""];
    let rowX = x;
    values.forEach((value, index) => {
      cell(doc, rowX, y, widths[index], 6, value, { bold: Boolean(row) });
      rowX += widths[index];
    });
    y += 6;
  });

  y = ensureSecondPageSpace(doc, y + 8, 50, x, w);
  y = pageSection(doc, x, y, w, "PROCESS DATA");
  const processing = (args.processingEntries || []).filter((entry) => entry.productionId === args.production.id);
  const sortedProcessing = [...processing].sort((a, b) => processingTimeValue(a) - processingTimeValue(b));
  const operatorNames = Array.from(new Set(processing.map((entry) => String(entry.operatorName || "").trim()).filter(Boolean))).join(" / ");
  const processRows: Array<[string, unknown]> = [
    ["Job Start Time", processingDateLabel(sortedProcessing[0])],
    ["Job End Time", processingDateLabel(sortedProcessing[sortedProcessing.length - 1])],
    ["Paper Produced", sumProcessingQty(processing, "Corrugation Paper") ? num(sumProcessingQty(processing, "Corrugation Paper"), 2) : ""],
    ["Liner Produced", sumProcessingQty(processing, "Corrugation Liner") ? num(sumProcessingQty(processing, "Corrugation Liner"), 2) : ""],
    ["Operator Name", operatorNames],
    ["Operator Signature", ""],
  ];
  processRows.forEach(([label, value]) => {
    const rowH = label === "Operator Signature" ? 10 : 6;
    cell(doc, x, y, 80, rowH, label, { bold: true });
    cell(doc, x + 80, y, 116, rowH, value, { bold: true, align: "left" });
    y += rowH;
  });

  y = ensureSecondPageSpace(doc, y + 8, 28, x, w);
  y = pageSection(doc, x, y, w, "REPORTS");
  const calculatedWastage = calculatedWastagePercent(args.production, args.issueReelLines, args.returnReelLines);
  const reportRows: Array<[string, unknown]> = [
    ["Final FG Produced", args.production.prodFromFFG ? num(args.production.prodFromFFG, 2) : ""],
    ["Corrugation Wastage %", calculatedWastage === "" ? "" : num(calculatedWastage, 2)],
    ["Overall Wastage %", calculatedWastage === "" ? "" : num(calculatedWastage, 2)],
  ];
  reportRows.forEach(([label, value]) => {
    cell(doc, x, y, 86, 9, label, { bold: true });
    cell(doc, x + 86, y, 110, 9, value, { bold: true, align: "left" });
    y += 9;
  });
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

export async function downloadJobCardPdf({ production, schedule, order, company, item, itemErp, phpItem, plateItem, materials, packingSlips, issueReelLines, returnReelLines, processingEntries, setting, createdBy }: PdfArgs) {
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
  const hasPlateData = hasValue(plateErp);
  const hasPhpData = hasValue(phpErp);

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
  cell(doc, c1 + 94, y, 38, 6, wholeNum(poQty), { bold: true });
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
  cell(doc, x + 149, y, 47, 6, wholeNum(firstValue(production.boardGsmReq, raw.boardGsmReq)));
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
  cell(doc, x + 149, y, 47, 6, num(getStandardBoxWeight(item)), { bold: true });
  y += 6;

  y = section(doc, x, y, w, "CFB SPECIFICATION");
  cell(doc, x, y, 42, 6, "Target Box", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, targetSize(production, item), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Deckle", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, mmToInch(firstValue(production.reelAsPerCalc, raw.deckleSize, raw.reelSize)), { bold: true });
  y += 6;
  cell(doc, x, y, 42, 6, "Flute Type", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, firstValue(production.fluteType, production.flute, raw.fluteType), { bold: true });
  cell(doc, x + 111, y, 45, 6, "Cutting", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 156, y, 40, 6, mmToInch(firstValue(production.cuttingWithTrimming, raw.cuttingSize, raw.cuttingWithTrimming)), { bold: true });
  y += 6;
  cell(doc, x, y, 42, 6, "Flute %", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 42, y, 50, 6, fixedNum(firstValue(production.takeUpFactor, raw.takeUpFactor, raw.takeUp), 2), { bold: true });
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
  cell(doc, x + 38, y, 46, 6, hasPlateData ? formatDimension(plateRaw.length, plateRaw.breadth) : "");
  cell(doc, x + 84, y, 18, 6, "PLY", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 102, y, 46, 6, "Required Qty Per CFB", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, hasPlateData ? firstValue(plateRaw.numberOfSetsPerBox) : "");
  y += 6;
  cell(doc, x, y, 84, 6, "Flute Direction", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 84, y, 18, 6, hasPlateData ? firstValue(plateRaw.fluteType) : "");
  cell(doc, x + 102, y, 46, 6, "BS", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, hasPlateData ? firstValue(plateRaw.boardGsmReq) : "");
  y += 6;

  y = section(doc, x, y, w, "PHP SPECIFICATION");
  cell(doc, x, y, 38, 6, "PHP ERP", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 158, 6, phpErp, { bold: true, align: "left" });
  y += 6;
  cell(doc, x, y, 38, 6, "Size (L X W X H)", { fill: LIGHT_ORANGE, bold: true, align: "left" });
  cell(doc, x + 38, y, 64, 6, hasPhpData ? formatDimension(phpRaw.length, phpRaw.breadth, phpRaw.height) : "");
  cell(doc, x + 102, y, 46, 6, "Required Qty Per CFB", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 148, y, 48, 6, hasPhpData ? firstValue(phpRaw.numberOfSetsPerBox) : "");
  y += 6;
  const phpRows = [
    ["Holes (Length)", hasPhpData ? firstValue(phpRaw.holesOrientationL) : ""],
    ["Holes (Width)", hasPhpData ? firstValue(phpRaw.holesOrientationW) : ""],
    ["Ply", hasPhpData ? firstValue(phpRaw.noOfPly) : ""],
    ["Flute Direction", hasPhpData ? firstValue(phpRaw.fluteType) : ""],
    ["GSM", hasPhpData ? firstValue(phpRaw.boardGsmReq) : ""],
  ];
  cell(doc, x + 68, y, 128, 30, "PHP DIAGRAM", { fill: [253, 233, 217], bold: true });
  phpRows.forEach(([label, value], index) => {
    cell(doc, x, y + index * 6, 38, 6, label, { fill: LIGHT_ORANGE, bold: true, align: "left" });
    cell(doc, x + 38, y + index * 6, 30, 6, value, { bold: true });
  });
  y += 30;

  y = section(doc, x, y, w, "OFFICIAL DATA");
  cell(doc, x, y, 66, 7, "Target Paper Weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 7, "", { bold: true });
  cell(doc, x + 104, y, 45, 7, "Actual Paper weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 7, production.actualPaperUsed ? num(production.actualPaperUsed, 2) : "");
  y += 7;
  cell(doc, x, y, 66, 7, "Target Liner Weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 7, "", { bold: true });
  cell(doc, x + 104, y, 45, 7, "Actual Liner weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 7, "");
  y += 7;
  cell(doc, x, y, 66, 12, "Total Target weight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 66, y, 38, 12, "", { bold: true });
  cell(doc, x + 104, y, 45, 12, "Actual Consumed\nweight", { fill: LIGHT_ORANGE, bold: true });
  cell(doc, x + 149, y, 47, 12, production.actualPaperUsed ? num(production.actualPaperUsed, 2) : "");
  y += 17;

  const signatureY = Math.min(y + 8, 292);
  doc.setFont("helvetica", "bolditalic");
  doc.setTextColor(0, 32, 96);
  doc.setFontSize(8);
  doc.text("PREPARED BY", x + 10, signatureY);
  doc.text("APPROVED BY", x + w - 10, signatureY, { align: "right" });

  drawJobCardOperationsPage(doc, {
    production,
    raw,
    materials,
    packingSlips,
    issueReelLines,
    returnReelLines,
    processingEntries,
  });

  doc.save(`JobCard_${safeFileName(jobNo)}.pdf`);
}
