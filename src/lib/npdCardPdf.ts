import jsPDF from "jspdf";
import type { Setting } from "../types";

type RowRecord = Record<string, string | number | boolean | null | undefined>;

type DownloadNpdCardPdfArgs = {
  npdRow: RowRecord;
  phpRow?: RowRecord | null;
  plateRow?: RowRecord | null;
  setting?: Setting | null;
};

type CellOptions = {
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle";
  fill?: Color;
  textColor?: Color;
  lineWidth?: number;
  padding?: number;
};

type Color = [number, number, number];

const PAGE_HEIGHT = 297;
const SHEET_X = 7;
const SHEET_Y = 7;
const SHEET_W = 196;
const SHEET_H = 282;
const BLACK: Color = [0, 0, 0];
const WHITE: Color = [255, 255, 255];
const YELLOW: Color = [255, 242, 0];
const DARK_TEAL: Color = [21, 86, 97];
const HEADER_BLUE: Color = [204, 222, 245];
const LIGHT_CYAN: Color = [204, 246, 252];
const PRINT_CYAN: Color = [0, 225, 230];
const CREAM: Color = [255, 242, 204];
const LIGHT_GRAY: Color = [242, 244, 247];
const GOLD: Color = [128, 96, 0];
const PLATE_GOLD: Color = [255, 213, 51];
const PINK: Color = [245, 204, 229];
const GREEN: Color = [0, 255, 0];
const BLUE: Color = [0, 0, 180];
const RED: Color = [220, 0, 0];

const FONT_BODY_12PX = 9;
const FONT_HEADING_14PX = 10.5;
const FONT_SMALL = 7;
const FONT_MICRO = 5.6;

function valueOf(row: RowRecord | null | undefined, ...keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function formatValue(value: RowRecord[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}


function formatNumber(value: number, decimals = 3) {
  if (!Number.isFinite(value)) return "";
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}



function calculatedWeightPerBox(row: RowRecord) {
  return valueOf(row, "calculatedWeightPerBox", "standardWeightGms");
}
function calculateRatePerBoxWeight(row: RowRecord) {
  const rate = Number(valueOf(row, "rate"));
  const boxWeight = Number(valueOf(row, "calculatedWeightPerBox", "standardWeightGms"));
  if (!Number.isFinite(rate) || !Number.isFinite(boxWeight) || boxWeight === 0) return "";
  return formatNumber(rate / boxWeight / 100, 3);
}
function calculateRatePerSheetWeight(row: RowRecord) {
  const rate = Number(valueOf(row, "rate"));
  const sheetWeight = Number(valueOf(row, "sheetWeight", "calculatedSheetWeight", "calSheetWeight", "weightPerPcSetReq", "weightPerPcReq"));
  if (!Number.isFinite(rate) || !Number.isFinite(sheetWeight) || sheetWeight === 0) return "";
  return formatNumber(rate / sheetWeight / 100, 3);
}

function reelDeckleSizeCm(row: RowRecord) {
  const reelSizeMm = Number(valueOf(row, "reelSize"));
  if (Number.isFinite(reelSizeMm) && reelSizeMm !== 0) return formatNumber(reelSizeMm / 10, 1);

  const deckleSizeMm = Number(valueOf(row, "deckleSize"));
  if (!Number.isFinite(deckleSizeMm) || deckleSizeMm === 0) return "";
  return formatNumber(deckleSizeMm / 10, 1);
}

function reelDeckleInches(row: RowRecord) {
  const reelSizeCm = Number(reelDeckleSizeCm(row));
  if (!Number.isFinite(reelSizeCm) || reelSizeCm === 0) return "";
  return formatNumber(reelSizeCm / 2.54, 2);
}
function formatDimension(...values: Array<RowRecord[string]>) {
  const parts = values.map(formatValue);
  if (parts.every((part) => part === "-")) return "-";
  return parts.join("   ");
}

function safeHeaderName(itemName: unknown, erp: unknown) {
  const name = String(itemName || "").trim();
  const erpCode = String(erp || "").trim();
  if (name && erpCode) return `${name} (${erpCode})`;
  return name || erpCode || "NPD Item";
}

async function getImageDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load logo image.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image."));
    reader.readAsDataURL(blob);
  });
}

function getOrganizationLogoUrl(setting?: Setting | null) {
  if (!setting?.organizationLogo) return "";
  const encoded = setting.organizationLogo.split("/").map(encodeURIComponent).join("/");
  if (typeof window === "undefined") return `/uploads/${encoded}`;
  return new URL(`/uploads/${encoded}`, window.location.origin).toString();
}

async function drawOrganizationLogo(doc: jsPDF, setting: Setting | null | undefined, x: number, y: number, w: number, h: number) {
  const logoUrl = getOrganizationLogoUrl(setting);
  if (!logoUrl) return false;
  try {
    const imageDataUrl = await getImageDataUrl(logoUrl);
    const props = doc.getImageProperties(imageDataUrl);
    const ratio = Math.min(w / props.width, h / props.height);
    const imageW = props.width * ratio;
    const imageH = props.height * ratio;
    doc.addImage(imageDataUrl, "PNG", x + (w - imageW) / 2, y + (h - imageH) / 2, imageW, imageH, undefined, "FAST");
    return true;
  } catch (error) {
    console.warn("Organization logo could not be added to NPD card PDF:", error);
    return false;
  }
}

function color(doc: jsPDF, fill?: Color, text?: Color) {
  const f = fill || WHITE;
  const t = text || BLACK;
  doc.setFillColor(f[0], f[1], f[2]);
  doc.setTextColor(t[0], t[1], t[2]);
}

function cell(doc: jsPDF, x: number, y: number, w: number, h: number, text: RowRecord[string], options: CellOptions = {}) {
  const {
    bold = false,
    fontSize = FONT_BODY_12PX,
    align = "center",
    valign = "middle",
    fill,
    textColor,
    lineWidth = 0.14,
    padding = 0.7,
  } = options;

  color(doc, fill, textColor);
  doc.setDrawColor(0);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h, "FD");

  const content = formatValue(text);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const maxWidth = Math.max(2, w - padding * 2);
  const lineHeight = fontSize * 0.34;
  const maxLines = Math.max(1, Math.floor((h - 1) / lineHeight));
  const lines = doc.splitTextToSize(content, maxWidth).slice(0, maxLines);
  let textX = x + padding;
  if (align === "center") textX = x + w / 2;
  if (align === "right") textX = x + w - padding;
  const textY = valign === "top" ? y + padding + lineHeight : y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + lineHeight * 0.35;
  doc.text(lines, textX, textY, { align });
}

function labelValue(doc: jsPDF, x: number, y: number, labelW: number, valueW: number, h: number, label: string, value: RowRecord[string], fill: Color = LIGHT_GRAY) {
  cell(doc, x, y, labelW, h, label, { bold: true, fill, fontSize: FONT_SMALL, padding: 0.5 });
  cell(doc, x + labelW, y, valueW, h, value, { bold: true, fontSize: FONT_BODY_12PX, padding: 0.6 });
}

function sectionCell(doc: jsPDF, x: number, y: number, w: number, h: number, text: RowRecord[string], fill: Color, textColor: Color = BLACK) {
  cell(doc, x, y, w, h, text, { bold: true, fill, textColor, fontSize: FONT_HEADING_14PX });
}
function linkCell(doc: jsPDF, x: number, y: number, w: number, h: number, url: RowRecord[string]) {
  cell(doc, x, y, w, h, "", { fontSize: FONT_MICRO });
  const link = String(url || "").trim();
  if (!link) return;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_MICRO);
  doc.setTextColor(0, 0, 200);
  const padding = 0.7;
  const lineHeight = FONT_MICRO * 0.34;
  const lines = doc.splitTextToSize(link, Math.max(2, w - padding * 2)).slice(0, 2);
  const textX = x + w / 2;
  const textY = y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + lineHeight * 0.35;
  doc.text(lines, textX, textY, { align: "center" });
  doc.setDrawColor(0, 0, 200);
  doc.setLineWidth(0.08);
  const underlineY = Math.min(y + h - 0.8, textY + (lines.length - 1) * lineHeight + 0.5);
  doc.line(x + padding, underlineY, x + w - padding, underlineY);
  (doc as jsPDF & { link?: (x: number, y: number, w: number, h: number, options: { url: string }) => void }).link?.(x, y, w, h, { url: link });
  doc.setDrawColor(0);
  doc.setTextColor(0);
}

async function drawHeader(doc: jsPDF, npdRow: RowRecord, setting?: Setting | null) {
  const y = SHEET_Y;
  doc.setDrawColor(0);
  doc.setLineWidth(0.35);
  doc.rect(SHEET_X, y, SHEET_W, SHEET_H);

  cell(doc, SHEET_X, y, 39, 28, `FILE NO.-\n${formatValue(npdRow.erp)}`, { bold: true, align: "left", fontSize: FONT_BODY_12PX, padding: 1.3 });
  cell(doc, SHEET_X + 39, y, 68, 28, "", { fill: WHITE });
  const hasLogo = await drawOrganizationLogo(doc, setting, SHEET_X + 55, y + 2, 36, 14);
  if (!hasLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT_HEADING_14PX);
    doc.setTextColor(140, 120, 35);
    doc.text("L", SHEET_X + 73, y + 14, { align: "center" });
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(0);
  doc.text("LAXMINARAYAN CORRUGATED BOARDS LLP", SHEET_X + 73, y + 25, { align: "center" });

  cell(doc, SHEET_X + 107, y, 23, 28, "Special\nRemarks", { bold: true, fontSize: FONT_SMALL });
  cell(doc, SHEET_X + 130, y, 66, 28, "", { fontSize: FONT_BODY_12PX });

  const y2 = y + 28;
  cell(doc, SHEET_X, y2, 39, 8, "Sample No.-", { bold: true, align: "left", fontSize: FONT_BODY_12PX, padding: 0.8 });
  cell(doc, SHEET_X + 39, y2, 68, 8, `ERP-      ${formatValue(npdRow.erp)}`, { bold: true, fontSize: FONT_HEADING_14PX });
  cell(doc, SHEET_X + 107, y2, 24, 8, "ISSUE DATE :", { bold: true, fontSize: FONT_SMALL });
  cell(doc, SHEET_X + 131, y2, 65, 8, new Date().toLocaleDateString("en-GB"), { bold: true, fontSize: FONT_BODY_12PX });

  const y3 = y2 + 8;
  cell(doc, SHEET_X, y3, 55, 5, "Doc.No. L.N./NPD/", { align: "left", fontSize: FONT_MICRO, padding: 0.7 });
  linkCell(doc, SHEET_X + 55, y3, 86, 5, valueOf(npdRow, "url", "URL", "link", "driveLink"));
  cell(doc, SHEET_X + 141, y3, 55, 5, "Rev.No./Date - 01/25.02.26", { align: "right", fontSize: FONT_MICRO, padding: 0.7 });
  return y3 + 5;
}

function drawSpecBlock(doc: jsPDF, y: number, npdRow: RowRecord) {
  sectionCell(doc, SHEET_X, y, SHEET_W, 8, "SPECIFICATION SHEET - CFB", YELLOW);
  y += 8;

  const rowH = 6;
  const itemRowH = 10;
  const rightX = SHEET_X + 90;

  labelValue(doc, SHEET_X, y, 39, 65, itemRowH, "ITEM NAME", valueOf(npdRow, "itemName"));
  labelValue(doc, SHEET_X + 104, y, 20, 72, itemRowH, "PARTY\nNAME", valueOf(npdRow, "customerName"));
  y += itemRowH;

  labelValue(doc, SHEET_X, y, 39, 51, rowH, "BOX DIMENSION (ID)", formatDimension(npdRow.lengthId, npdRow.breadthId, npdRow.heightId));
  labelValue(doc, rightX, y, 27, 33, rowH, "REEL\nDECKLE", reelDeckleInches(npdRow));
  cell(doc, rightX + 60, y, 32, rowH, "REEL DECKLE SIZE", { bold: true, fill: GREEN, fontSize: FONT_SMALL });
  cell(doc, rightX + 92, y, 14, rowH, reelDeckleSizeCm(npdRow), { bold: true, fill: GREEN, fontSize: FONT_HEADING_14PX });
  y += rowH;

  labelValue(doc, SHEET_X, y, 39, 51, rowH, "ROTARY DIMENSION (OD)", formatDimension(npdRow.lengthOd, npdRow.breadthOd, npdRow.heightOd));
  labelValue(doc, rightX, y, 27, 79, rowH, "CUTTING\nLENGTH", valueOf(npdRow, "cuttingSize", "cuttingWithTrimming"));
  y += rowH;

  const rows: Array<[string, RowRecord[string], string, RowRecord[string], RowRecord[string], RowRecord[string], Color?]> = [
    ["NO.OF PLY", valueOf(npdRow, "ply"), "FLUTING %", "B-37%", "A-45%", calculatedWeightPerBox(npdRow)],
    ["FLAP", valueOf(npdRow, "flapSize"), "CREASEING\nTYPE (M/F)", "M/F", "Glue / Stitch", calculatedWeightPerBox(npdRow)],
    ["TRIMMING", 16, "PRINTING\nCOLOUR", valueOf(npdRow, "printingColour1"), valueOf(npdRow, "printingColour2"), valueOf(npdRow, "printingColour2") ? 2 : valueOf(npdRow, "printingColour1") ? 1 : "", PINK],
    ["REQUIRED BS", valueOf(npdRow, "bsKgCm2Calculated", "bsKgCm2Std"), "FLUTE", valueOf(npdRow, "fluteType"), "Box\nType", "RSC"],
    ["REQUIRED BOARD GSM", valueOf(npdRow, "standardBGsm", "calculatedBGsm"), "Cal. BGSM", valueOf(npdRow, "calculatedBGsm", "standardBGsm"), "TOP", valueOf(npdRow, "topPaperShade"), PINK],
    ["REQUIRED CS", valueOf(npdRow, "csKgTarget", "csKgStd"), "TARGET CS", valueOf(npdRow, "rapc"), "BOTTOM", valueOf(npdRow, "backingPaperShade"), PINK],
  ];

  for (const [leftLabel, leftValue, middleLabel, middleValue, rightLabel, rightValue, rightFill] of rows) {
    labelValue(doc, SHEET_X, y, 39, 51, rowH, leftLabel, leftValue);

    if (middleLabel === "FLUTING %") {
      cell(doc, rightX, y, 27, rowH, middleLabel, { bold: true, fill: LIGHT_GRAY, fontSize: FONT_SMALL, padding: 0.5 });
      cell(doc, rightX + 27, y, 24, rowH, middleValue, { bold: true, fontSize: FONT_SMALL });
      cell(doc, rightX + 51, y, 24, rowH, rightLabel, { bold: true, fontSize: FONT_SMALL });
      cell(doc, rightX + 75, y, 17, rowH, calculateRatePerBoxWeight(npdRow), { bold: true, fontSize: FONT_SMALL, padding: 0.3 });
      cell(doc, rightX + 92, y, 8, rowH, "Cal. Sheet\nWeight", { bold: true, fill: LIGHT_GRAY, fontSize: FONT_MICRO, padding: 0.2 });
      cell(doc, rightX + 100, y, 6, rowH, rightValue, { bold: true, fontSize: FONT_MICRO, padding: 0.2 });
      y += rowH;
      continue;
    }
    if (middleLabel === "CREASEING\nTYPE (M/F)") {
      cell(doc, rightX, y, 27, rowH, middleLabel, { bold: true, fill: LIGHT_GRAY, fontSize: FONT_SMALL, padding: 0.5 });
      cell(doc, rightX + 27, y, 21, rowH, middleValue, { bold: true, fontSize: FONT_SMALL });
      cell(doc, rightX + 48, y, 22, rowH, rightLabel, { bold: true, fill: CREAM, fontSize: FONT_SMALL });
      cell(doc, rightX + 70, y, 16, rowH, "GLUED", { bold: true, fill: PINK, fontSize: FONT_SMALL });
      cell(doc, rightX + 86, y, 12, rowH, "Cal. Box\nWeight", { bold: true, fill: LIGHT_GRAY, fontSize: FONT_MICRO, padding: 0.4 });
      cell(doc, rightX + 98, y, 8, rowH, rightValue, { bold: true, fontSize: FONT_SMALL, padding: 0.3 });
      y += rowH;
      continue;
    }

    if (middleLabel === "PRINTING\nCOLOUR") {
      cell(doc, rightX, y, 27, rowH, middleLabel, { bold: true, fill: LIGHT_GRAY, fontSize: FONT_SMALL, padding: 0.5 });
      cell(doc, rightX + 27, y, 30, rowH, middleValue, { bold: true, fill: PRINT_CYAN, fontSize: FONT_SMALL });
      cell(doc, rightX + 57, y, 28, rowH, rightLabel, { bold: true, fill: CREAM, fontSize: FONT_SMALL });
      cell(doc, rightX + 85, y, 16, rowH, "NO.OF\nCOLOUR", { bold: true, fill: WHITE, fontSize: FONT_MICRO, padding: 0.4 });
      cell(doc, rightX + 101, y, 5, rowH, rightValue, { bold: true, fontSize: FONT_SMALL, padding: 0.2 });
      y += rowH;
      continue;
    }

    labelValue(doc, rightX, y, 27, 32, rowH, middleLabel, middleValue);
    labelValue(doc, rightX + 59, y, 26, 20, rowH, String(rightLabel || ""), rightValue, rightFill || LIGHT_GRAY);
    y += rowH;
  }

  cell(doc, SHEET_X, y, 130, 6, "QTY.PER BUNDLE", { bold: true, fill: WHITE, fontSize: FONT_SMALL });
  cell(doc, SHEET_X + 130, y, 66, 6, valueOf(npdRow, "qtyPerBundle"), { bold: true, fill: PINK, fontSize: FONT_BODY_12PX });
  return y + 6;
}

function drawLayersAndUps(doc: jsPDF, y: number, npdRow: RowRecord) {
  cell(doc, SHEET_X, y, 130, 6, "", { fill: DARK_TEAL });
  cell(doc, SHEET_X + 130, y, 44, 6, "NO OF UPS", { bold: true, fill: WHITE, fontSize: FONT_HEADING_14PX });
  cell(doc, SHEET_X + 174, y, 22, 6, valueOf(npdRow, "ups", "noOfUps"), { bold: true, fill: WHITE, fontSize: FONT_HEADING_14PX });
  y += 6;

  const layerW = 90;
  const upsX = SHEET_X + layerW;
  const upsW = SHEET_W - layerW;

  cell(doc, SHEET_X, y, 39, 6, "LAYERS", { bold: true, fill: HEADER_BLUE, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 39, y, 26, 6, "GSM", { bold: true, fill: HEADER_BLUE, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 65, y, 25, 6, "BF", { bold: true, fill: HEADER_BLUE, fontSize: FONT_BODY_12PX });

  const upsHeaders = ["1 UPS", "2 UPS", "3 UPS", "4 UPS", "5 UPS"];
  upsHeaders.forEach((label, index) => cell(doc, upsX + index * (upsW / 5), y, upsW / 5, 6, label, { bold: true, fill: HEADER_BLUE, fontSize: FONT_BODY_12PX }));
  y += 6;

  const layerRows: RowRecord[string][][] = [
    ["Top Layer", valueOf(npdRow, "psL1"), valueOf(npdRow, "psL1Bf")],
    ["Fluting 1     A FLUTING", valueOf(npdRow, "psF1"), valueOf(npdRow, "psF1Bf")],
    ["Backing 1     A BACKING", valueOf(npdRow, "psL2"), valueOf(npdRow, "psL2Bf")],
    ["Fluting 2     B FLUTING", valueOf(npdRow, "psF2"), valueOf(npdRow, "psF2Bf")],
    ["Backing 2     B BACKING", "", ""],
  ];

  const selectedUps = Number(valueOf(npdRow, "ups", "noOfUps"));
  for (const row of layerRows) {
    cell(doc, SHEET_X, y, 39, 6, row[0], { bold: true, fontSize: FONT_SMALL });
    cell(doc, SHEET_X + 39, y, 26, 6, row[1], { bold: true, fontSize: FONT_BODY_12PX });
    cell(doc, SHEET_X + 65, y, 25, 6, row[2], { bold: true, fontSize: FONT_BODY_12PX });
    for (let index = 0; index < 5; index += 1) {
      const mark = index + 1 === selectedUps && row === layerRows[2] ? "X" : "";
      const fallbackValue = index === 0 && row === layerRows[2] && !mark ? valueOf(npdRow, "ups", "noOfUps") : "";
      cell(doc, upsX + index * (upsW / 5), y, upsW / 5, 6, mark || fallbackValue, { bold: true, fontSize: FONT_BODY_12PX });
    }
    y += 6;
  }

  return y;
}

function drawPhpPlateSection(doc: jsPDF, y: number, phpRow?: RowRecord | null, plateRow?: RowRecord | null) {
  sectionCell(doc, SHEET_X, y, 58, 6, "PHP", YELLOW);
  sectionCell(doc, SHEET_X + 58, y, 138, 6, "PLATE", GOLD, WHITE);
  y += 6;

  const phpHeaders = ["LENGTH", "WIDTH", "HEIGHT"];
  phpHeaders.forEach((header, index) => cell(doc, SHEET_X + index * (58 / 3), y, 58 / 3, 6, header, { bold: true, fill: LIGHT_CYAN, fontSize: FONT_BODY_12PX }));
  const plateHeaders = ["PLATE TYPE", "ERP", "LENGTH", "WIDTH", "PLY", "FLUTE", "BS", "QTY/BOX"];
  const plateWidths = [20, 20, 18, 20, 20, 16, 13, 11];
  let x = SHEET_X + 58;
  plateHeaders.forEach((header, index) => {
    cell(doc, x, y, plateWidths[index], 6, header, { bold: true, fill: PLATE_GOLD, fontSize: FONT_SMALL, padding: 0.5 });
    x += plateWidths[index];
  });
  y += 6;

  const phpValues = [valueOf(phpRow, "length"), valueOf(phpRow, "breadth", "width"), valueOf(phpRow, "height")];
  phpValues.forEach((value, index) => cell(doc, SHEET_X + index * (58 / 3), y, 58 / 3, 8, value, { bold: true, fontSize: FONT_BODY_12PX }));
  const plateValues = [valueOf(plateRow, "typeOfPlate"), valueOf(plateRow, "erpItemCode", "erp"), valueOf(plateRow, "length"), valueOf(plateRow, "breadth", "width"), valueOf(plateRow, "noOfPly"), valueOf(plateRow, "fluteType"), valueOf(plateRow, "brustingStrengthReq"), valueOf(plateRow, "numberOfSetsPerBox")];
  x = SHEET_X + 58;
  plateValues.forEach((value, index) => {
    cell(doc, x, y, plateWidths[index], 8, value, { bold: true, fontSize: FONT_SMALL, fill: index === 1 ? LIGHT_GRAY : WHITE });
    x += plateWidths[index];
  });
  y += 8;

  const detailRows: Array<[string, RowRecord[string], string]> = [
    ["NO.OF PLY", valueOf(phpRow, "noOfPly"), "V PLATE"],
    ["BS/BURSTING STRENGTH", valueOf(phpRow, "brustingStrengthReq"), "H PLATE"],
    ["HOLES (LENGTH WISE)", valueOf(phpRow, "holesOrientationL", "numberOfHolesInPhp"), "Z PLATE"],
    ["HOLES (WIDTH WISE)", valueOf(phpRow, "holesOrientationW"), "U PLATE"],
    ["QTY/BOX", valueOf(phpRow, "numberOfSetsPerBox"), "C PLATE"],
    ["FLUTE TYPE", valueOf(phpRow, "fluteType"), "GAP FILLER"],
  ];

  for (const [phpLabel, phpValue, plateLabel] of detailRows) {
    labelValue(doc, SHEET_X, y, 39, 19, 5.5, phpLabel, phpValue, LIGHT_CYAN);
    cell(doc, SHEET_X + 58, y, 20, 5.5, plateLabel, { bold: true, fill: plateLabel === "GAP FILLER" ? PLATE_GOLD : PINK, fontSize: FONT_SMALL, align: "left", padding: 0.8 });
    cell(doc, SHEET_X + 78, y, 118, 5.5, "", { fontSize: FONT_BODY_12PX });
    y += 5.5;
  }

  labelValue(doc, SHEET_X, y, 39, 19, 5.5, "FLUTE DIRECTION", "", LIGHT_CYAN);
  cell(doc, SHEET_X + 58, y, 138, 5.5, "CREASER", { bold: true, fill: PINK, fontSize: FONT_HEADING_14PX });
  y += 5.5;

  labelValue(doc, SHEET_X, y, 39, 19, 5.5, "REMARKS", "", LIGHT_CYAN);
  cell(doc, SHEET_X + 58, y, 39, 5.5, "CREASING POINT", { bold: true, fill: PINK, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 97, y, 33, 5.5, "Z PLATE", { bold: true, fill: PINK, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 130, y, 33, 5.5, "U PLATE", { bold: true, fill: PINK, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 163, y, 33, 5.5, "O PLATE", { bold: true, fill: PINK, fontSize: FONT_BODY_12PX });
  y += 5.5;

  const creaserRows: Array<[string, RowRecord[string]]> = [
    ["1st CREASING AT", valueOf(plateRow, "creasor1")],
    ["2nd CREASING AT", valueOf(plateRow, "creasor2")],
    ["3rd CREASING AT", valueOf(plateRow, "creasor3")],
  ];
  for (const [label, value] of creaserRows) {
    cell(doc, SHEET_X, y, 58, 5.5, "", { fontSize: FONT_BODY_12PX });
    cell(doc, SHEET_X + 58, y, 39, 5.5, label, { bold: true, align: "left", fontSize: FONT_BODY_12PX, padding: 0.7 });
    cell(doc, SHEET_X + 97, y, 99, 5.5, value, { bold: true, fontSize: FONT_BODY_12PX });
    y += 5.5;
  }

  cell(doc, SHEET_X, y, SHEET_W, 5.5, "PHP DIAGRAM", { bold: true, fontSize: FONT_BODY_12PX });
  return y + 5.5;
}

function drawRevisionFooter(doc: jsPDF, y: number) {
  cell(doc, SHEET_X, y, 39, 7, "REMARK", { bold: true, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 39, y, 157, 7, "", { fontSize: FONT_BODY_12PX });
  y += 7;

  cell(doc, SHEET_X, y, 39, 6, "Revision", { bold: true, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 39, y, 67, 12, "Description of revision", { bold: true, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 106, y, 90, 12, "Reason for Revision", { bold: true, fontSize: FONT_BODY_12PX });
  y += 6;
  cell(doc, SHEET_X, y, 15, 6, "No.", { bold: true, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 15, y, 24, 6, "Date", { bold: true, fontSize: FONT_BODY_12PX });
  y += 6;

  cell(doc, SHEET_X, y, 15, 9, "4", { bold: true, fontSize: FONT_BODY_12PX });
  cell(doc, SHEET_X + 15, y, 24, 9, "2/25/2026", { bold: true, fontSize: FONT_SMALL });
  cell(doc, SHEET_X + 39, y, 67, 9, "Auto calculated sheet weight/B.S.Gsm\nadded.", { bold: true, align: "left", fontSize: FONT_SMALL });
  cell(doc, SHEET_X + 106, y, 90, 9, "For better accuracy.", { bold: true, fontSize: FONT_BODY_12PX });
  y += 9;

  cell(doc, SHEET_X, y, 39, 9, "PREPARED BY", { bold: true, fontSize: FONT_HEADING_14PX });
  cell(doc, SHEET_X + 39, y, 67, 9, "MASTER COPY", { bold: true, textColor: BLUE, fontSize: FONT_HEADING_14PX });
  cell(doc, SHEET_X + 106, y, 90, 9, "APPROVED BY", { bold: true, textColor: RED, fontSize: FONT_HEADING_14PX });
}

export async function downloadNpdCardPdf({ npdRow, phpRow, plateRow, setting }: DownloadNpdCardPdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");

  doc.setProperties({
    title: `NPD Card - ${safeHeaderName(npdRow.itemName, npdRow.erp)}`,
    subject: "Specification Sheet - CFB",
  });

  let y = await drawHeader(doc, npdRow, setting);
  y = drawSpecBlock(doc, y, npdRow);
  y = drawLayersAndUps(doc, y, npdRow);
  y = drawPhpPlateSection(doc, y, phpRow, plateRow);
  drawRevisionFooter(doc, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_MICRO);
  doc.setTextColor(120);
  doc.text("Generated from NPD Master", SHEET_X, PAGE_HEIGHT - 4);

  const safeFileName = safeHeaderName(npdRow.itemName, npdRow.erp).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "NPD_Item";
  doc.save(`NPD_Card_${safeFileName}.pdf`);
}

