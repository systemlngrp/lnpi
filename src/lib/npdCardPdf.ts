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

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const SHEET_X = 12;
const SHEET_Y = 12;
const SHEET_W = 186;
const BLACK: Color = [0, 0, 0];
const WHITE: Color = [255, 255, 255];
const YELLOW: Color = [255, 242, 0];
const DARK_TEAL: Color = [21, 86, 97];
const HEADER_BLUE: Color = [204, 222, 245];
const LIGHT_CYAN: Color = [204, 246, 252];
const LIGHT_GREEN: Color = [210, 255, 226];
const LIGHT_GRAY: Color = [242, 244, 247];
const GOLD: Color = [188, 143, 0];
const PLATE_GOLD: Color = [255, 213, 51];
const PINK: Color = [245, 204, 229];
const GREEN: Color = [0, 255, 0];
const BLUE: Color = [0, 0, 180];
const RED: Color = [220, 0, 0];

const FONT_10PX = 7.5;
const FONT_12PX = 9;
const FONT_TINY = 5.4;
const FONT_MICRO = 4.4;
const FONT_TITLE = 10.5;

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

function formatBlank(value: RowRecord[string]) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
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
    fontSize = FONT_TINY,
    align = "center",
    valign = "middle",
    fill,
    textColor,
    lineWidth = 0.16,
    padding = 0.9,
  } = options;

  color(doc, fill, textColor);
  doc.setDrawColor(0);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h, "FD");

  const content = formatValue(text);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const maxWidth = Math.max(2, w - padding * 2);
  const lineHeight = fontSize * 0.36;
  const maxLines = Math.max(1, Math.floor((h - 1) / lineHeight));
  const lines = doc.splitTextToSize(content, maxWidth).slice(0, maxLines);
  let textX = x + padding;
  if (align === "center") textX = x + w / 2;
  if (align === "right") textX = x + w - padding;
  const textY = valign === "top" ? y + padding + lineHeight : y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + lineHeight * 0.35;
  doc.text(lines, textX, textY, { align });
}

function labelValue(doc: jsPDF, x: number, y: number, labelW: number, valueW: number, h: number, label: string, value: RowRecord[string], fill: Color = LIGHT_GRAY) {
  cell(doc, x, y, labelW, h, label, { bold: true, align: "left", fill, fontSize: FONT_MICRO });
  cell(doc, x + labelW, y, valueW, h, value, { bold: true, fontSize: FONT_10PX });
}

async function drawHeader(doc: jsPDF, npdRow: RowRecord, setting?: Setting | null) {
  const y = SHEET_Y;
  doc.setDrawColor(0);
  doc.setLineWidth(0.35);
  doc.rect(SHEET_X, y, SHEET_W, 257);

  cell(doc, SHEET_X, y, 38, 28, `FILE NO.-\n${formatValue(npdRow.erp)}`, { bold: true, align: "left", fontSize: FONT_TINY, padding: 1.5 });
  cell(doc, SHEET_X + 38, y, 64, 28, "", { fill: WHITE });
  const hasLogo = await drawOrganizationLogo(doc, setting, SHEET_X + 52, y + 3, 36, 14);
  if (!hasLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT_TITLE);
    doc.setTextColor(140, 120, 35);
    doc.text("L", SHEET_X + 70, y + 11, { align: "center" });
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_MICRO);
  doc.setTextColor(0);
  doc.text("LAXMINARAYAN CORRUGATED BOARDS LLP", SHEET_X + 70, y + 24, { align: "center" });

  cell(doc, SHEET_X + 102, y, 24, 28, "Special\nRemarks", { bold: true, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 126, y, 60, 28, "", { fontSize: FONT_TINY });

  const y2 = y + 28;
  cell(doc, SHEET_X, y2, 38, 7, "Sample No.-", { bold: true, align: "left", fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 38, y2, 64, 7, `ERP-      ${formatValue(npdRow.erp)}`, { bold: true, fontSize: FONT_10PX });
  cell(doc, SHEET_X + 102, y2, 28, 7, "ISSUE DATE :", { bold: true, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 130, y2, 56, 7, new Date().toLocaleDateString("en-GB"), { bold: true, fontSize: FONT_MICRO });

  const y3 = y2 + 7;
  cell(doc, SHEET_X, y3, 93, 5, "Doc.No. L.N./NPD/", { align: "left", fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 93, y3, 93, 5, "Rev.No./Date :", { align: "right", fontSize: FONT_MICRO });
  return y3 + 5;
}

function drawSpecBlock(doc: jsPDF, y: number, npdRow: RowRecord) {
  cell(doc, SHEET_X, y, SHEET_W, 8, "SPECIFICATION SHEET - CFB", { bold: true, fontSize: FONT_TITLE, fill: YELLOW });
  y += 8;

  labelValue(doc, SHEET_X, y, 35, 70, 7, "ITEM NAME", valueOf(npdRow, "itemName"));
  labelValue(doc, SHEET_X + 105, y, 30, 51, 7, "PARTY\nNAME", valueOf(npdRow, "customerName"));
  y += 7;

  labelValue(doc, SHEET_X, y, 35, 70, 7, "BOX DIMENSION (ID)", formatDimension(npdRow.lengthId, npdRow.breadthId, npdRow.heightId));
  labelValue(doc, SHEET_X + 105, y, 30, 51, 7, "REEL DECKLE SIZE (MM)", valueOf(npdRow, "deckleSize", "reelSize"), LIGHT_GRAY);
  cell(doc, SHEET_X + 168, y, 18, 7, valueOf(npdRow, "rapc", "rapcForSingleBox"), { bold: true, fill: GREEN, fontSize: FONT_10PX });
  y += 7;

  labelValue(doc, SHEET_X, y, 35, 70, 7, "ROTARY DIMENSION (OD)", formatDimension(npdRow.lengthOd, npdRow.breadthOd, npdRow.heightOd));
  labelValue(doc, SHEET_X + 105, y, 30, 51, 7, "CUTTING\nLENGTH", valueOf(npdRow, "cuttingSize", "cuttingWithTrimming"));
  y += 7;

  const rowH = 6;
  const leftRows: Array<[string, RowRecord[string]]> = [
    ["NO.OF PLY", valueOf(npdRow, "ply")],
    ["FLAP", valueOf(npdRow, "flapSize")],
    ["TRIMMING", valueOf(npdRow, "cuttingWithTrimming")],
    ["REQUIRED BS", valueOf(npdRow, "bsKgCm2Calculated", "bsKgCm2Std")],
    ["REQUIRED BOARD GSM", valueOf(npdRow, "standardBGsm", "calculatedBGsm")],
    ["REQUIRED CS", valueOf(npdRow, "csKgTarget", "csKgStd")],
  ];
  const middleRows: Array<[string, RowRecord[string]]> = [
    ["FLUTE TYPE", valueOf(npdRow, "fluteType")],
    ["CUTTING SIZE", valueOf(npdRow, "cuttingSize")],
    ["PER BOX", valueOf(npdRow, "standardWeightGms", "calculatedWeightPerBox")],
    ["CAL BS", valueOf(npdRow, "bsKgCm2Calculated")],
    ["CAL RCT", valueOf(npdRow, "csKgStd")],
    ["TARGET CS", valueOf(npdRow, "rapc")],
  ];
  const rightRows: Array<[string, RowRecord[string]]> = [
    ["BF %", ""],
    ["Color Match", ""],
    ["Cal. Burst\nWeight", ""],
    ["PRINTING\nCOLOUR", valueOf(npdRow, "printingColour1")],
    ["NO.OF COLOUR", valueOf(npdRow, "printingColour2") ? 2 : valueOf(npdRow, "printingColour1") ? 1 : ""],
    ["FLUTE", valueOf(npdRow, "fluteType")],
  ];

  for (let index = 0; index < leftRows.length; index += 1) {
    labelValue(doc, SHEET_X, y, 35, 42, rowH, leftRows[index][0], leftRows[index][1]);
    labelValue(doc, SHEET_X + 77, y, 28, 28, rowH, middleRows[index][0], middleRows[index][1], LIGHT_GRAY);
    labelValue(doc, SHEET_X + 133, y, 28, 25, rowH, rightRows[index][0], rightRows[index][1], index === 3 ? PINK : LIGHT_GRAY);
    y += rowH;
  }

  cell(doc, SHEET_X + 105, y - rowH * 2, 28, rowH, "TOP", { bold: true, fill: PINK, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 133, y - rowH * 2, 53, rowH, valueOf(npdRow, "topPaperShade"), { bold: true, fontSize: FONT_TINY });
  cell(doc, SHEET_X + 105, y - rowH, 28, rowH, "BOTTOM", { bold: true, fill: PINK, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 133, y - rowH, 53, rowH, valueOf(npdRow, "backingPaperShade"), { bold: true, fontSize: FONT_TINY });

  return y;
}

function drawLayersAndUps(doc: jsPDF, y: number, npdRow: RowRecord) {
  const layerW = 92;
  const upsX = SHEET_X + layerW;
  const upsW = SHEET_W - layerW;
  const headerFill: Color = HEADER_BLUE;

  cell(doc, SHEET_X, y, 38, 7, "LAYERS", { bold: true, fill: headerFill, fontSize: FONT_TINY });
  cell(doc, SHEET_X + 38, y, 27, 7, "GSM", { bold: true, fill: headerFill, fontSize: FONT_TINY });
  cell(doc, SHEET_X + 65, y, 27, 7, "BF", { bold: true, fill: headerFill, fontSize: FONT_TINY });
  cell(doc, upsX, y, upsW, 7, "NO OF UPS", { bold: true, fill: LIGHT_GRAY, fontSize: FONT_TINY });
  y += 7;

  const layerRows: RowRecord[string][][] = [
    ["Top Layer", valueOf(npdRow, "psL1"), valueOf(npdRow, "psL1Bf")],
    ["Fluting 1    C FLUTING", valueOf(npdRow, "psF1"), valueOf(npdRow, "psF1Bf")],
    ["Backing 1    C BACKING", valueOf(npdRow, "psL2"), valueOf(npdRow, "psL2Bf")],
    ["Fluting 2    B FLUTING", valueOf(npdRow, "psF2"), valueOf(npdRow, "psF2Bf")],
    ["Backing 2    B BACKING", "", ""],
  ];

  const upsHeaders = ["1 UPS", "2 UPS", "3 UPS", "4 UPS", "5 UPS"];
  upsHeaders.forEach((label, index) => cell(doc, upsX + index * (upsW / 5), y, upsW / 5, 6, label, { bold: true, fill: LIGHT_GRAY, fontSize: FONT_MICRO }));
  const upsStartY = y + 6;
  for (let index = 0; index < 5; index += 1) {
    cell(doc, upsX + index * (upsW / 5), upsStartY, upsW / 5, 29, index === 0 ? valueOf(npdRow, "ups", "noOfUps") : index === 2 ? valueOf(npdRow, "dieCutUps") : "", { bold: true, fontSize: FONT_TINY });
  }

  for (const row of layerRows) {
    cell(doc, SHEET_X, y, 38, 7, row[0], { bold: true, fontSize: FONT_MICRO });
    cell(doc, SHEET_X + 38, y, 27, 7, row[1], { bold: true, fontSize: FONT_TINY });
    cell(doc, SHEET_X + 65, y, 27, 7, row[2], { bold: true, fontSize: FONT_TINY });
    y += 7;
  }

  return y;
}

function drawPhpPlateSection(doc: jsPDF, y: number, phpRow?: RowRecord | null, plateRow?: RowRecord | null) {
  cell(doc, SHEET_X, y, 86, 7, "PHP", { bold: true, fill: LIGHT_CYAN, fontSize: FONT_10PX });
  cell(doc, SHEET_X + 86, y, 100, 7, "PLATE", { bold: true, fill: GOLD, textColor: WHITE, fontSize: FONT_10PX });
  y += 7;

  const phpHeaders = ["LENGTH", "WIDTH", "HEIGHT"];
  phpHeaders.forEach((header, index) => cell(doc, SHEET_X + index * (86 / 3), y, 86 / 3, 6, header, { bold: true, fill: LIGHT_CYAN, fontSize: FONT_MICRO }));
  const plateHeaders = ["PLATE TYPE", "ERP", "LENGTH", "WIDTH", "PLY", "FLUTE", "BS", "QTY/BOX"];
  const plateWidths = [18, 18, 15, 15, 12, 14, 12, 16];
  let x = SHEET_X + 86;
  plateHeaders.forEach((header, index) => {
    cell(doc, x, y, plateWidths[index], 6, header, { bold: true, fill: PLATE_GOLD, fontSize: FONT_MICRO });
    x += plateWidths[index];
  });
  y += 6;

  const phpValues = [valueOf(phpRow, "length"), valueOf(phpRow, "breadth", "width"), valueOf(phpRow, "height")];
  phpValues.forEach((value, index) => cell(doc, SHEET_X + index * (86 / 3), y, 86 / 3, 8, value, { bold: true, fontSize: FONT_TINY }));
  const plateValues = [valueOf(plateRow, "typeOfPlate"), valueOf(plateRow, "erpItemCode", "erp"), valueOf(plateRow, "length"), valueOf(plateRow, "breadth", "width"), valueOf(plateRow, "noOfPly"), valueOf(plateRow, "fluteType"), valueOf(plateRow, "brustingStrengthReq"), valueOf(plateRow, "numberOfSetsPerBox")];
  x = SHEET_X + 86;
  plateValues.forEach((value, index) => {
    cell(doc, x, y, plateWidths[index], 8, value, { bold: true, fontSize: FONT_MICRO });
    x += plateWidths[index];
  });
  y += 8;

  const detailRows: Array<[string, RowRecord[string], string, RowRecord[string]]> = [
    ["NO.OF PLY", valueOf(phpRow, "noOfPly"), "V PLATE", ""],
    ["BS/BURSTING STRENGTH", valueOf(phpRow, "brustingStrengthReq"), "H PLATE", ""],
    ["HOLES (LENGTH WISE)", valueOf(phpRow, "holesOrientationL", "numberOfHolesInPhp"), "C PLATE", ""],
    ["HOLES (WIDTH WISE)", valueOf(phpRow, "holesOrientationW"), "A/H PLATE", ""],
    ["QTY/BOX", valueOf(phpRow, "numberOfSetsPerBox"), "GAP FILLER", ""],
    ["FLUTE TYPE", valueOf(phpRow, "fluteType"), "CREASER", ""],
    ["FLUTE DIRECTION", "", "1st CREASING AT", valueOf(plateRow, "creasor1")],
    ["REMARKS", "", "2nd CREASING AT", valueOf(plateRow, "creasor2")],
  ];

  for (const [phpLabel, phpValue, plateLabel, plateValue] of detailRows) {
    labelValue(doc, SHEET_X, y, 38, 48, 6, phpLabel, phpValue, LIGHT_CYAN);
    labelValue(doc, SHEET_X + 86, y, 36, 64, 6, plateLabel, plateValue, plateLabel === "CREASER" ? PINK : PINK);
    y += 6;
  }

  cell(doc, SHEET_X, y, SHEET_W, 7, "PHP DIAGRAM", { bold: true, fontSize: FONT_TINY });
  return y + 7;
}

function drawRevisionFooter(doc: jsPDF, y: number) {
  cell(doc, SHEET_X, y, 38, 8, "REMARK", { bold: true, align: "left", fontSize: FONT_10PX });
  cell(doc, SHEET_X + 38, y, 148, 8, "", { fontSize: FONT_TINY });
  y += 8;

  cell(doc, SHEET_X, y, SHEET_W, 6, "Revision", { bold: true, align: "left", fontSize: FONT_TINY });
  y += 6;
  cell(doc, SHEET_X, y, 16, 6, "No.", { bold: true, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 16, y, 28, 6, "Rev Date", { bold: true, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 44, y, 58, 6, "Description of revision", { bold: true, fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 102, y, 84, 6, "Reason for Revision", { bold: true, fontSize: FONT_MICRO });
  y += 6;
  cell(doc, SHEET_X, y, 16, 10, "4", { fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 16, y, 28, 10, "", { fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 44, y, 58, 10, "Auto calculated sheet weight/B.S.Gsm", { fontSize: FONT_MICRO });
  cell(doc, SHEET_X + 102, y, 84, 10, "For better accuracy.", { fontSize: FONT_MICRO });
  y += 10;

  cell(doc, SHEET_X, y, 62, 9, "PREPARED BY", { bold: true, align: "left", fontSize: FONT_TINY });
  cell(doc, SHEET_X + 62, y, 62, 9, "MASTER COPY", { bold: true, textColor: BLUE, fontSize: FONT_10PX });
  cell(doc, SHEET_X + 124, y, 62, 9, "APPROVED BY", { bold: true, textColor: RED, fontSize: FONT_TINY });
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
  doc.text("Generated from NPD Master", SHEET_X, PAGE_HEIGHT - 8);

  const safeFileName = safeHeaderName(npdRow.itemName, npdRow.erp).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "NPD_Item";
  doc.save(`NPD_Card_${safeFileName}.pdf`);
}
