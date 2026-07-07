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
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle";
  fill?: [number, number, number];
  textColor?: [number, number, number];
  border?: boolean;
  padding?: number;
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 14;
const SHEET_X = 15;
const SHEET_Y = 20;
const SHEET_W = 180;
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const YELLOW: [number, number, number] = [255, 242, 0];
const TEAL: [number, number, number] = [150, 211, 217];
const CYAN: [number, number, number] = [0, 176, 240];
const GREEN: [number, number, number] = [0, 255, 0];
const PINK: [number, number, number] = [245, 204, 229];
const GOLD: [number, number, number] = [255, 204, 0];
const GRAY: [number, number, number] = [242, 242, 242];

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

function safeNumber(value: RowRecord[string]) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDimension(...values: Array<RowRecord[string]>) {
  const parts = values.map(formatValue);
  if (parts.every((part) => part === "-")) return "-";
  return parts.join(" X ");
}

function safeHeaderName(itemName: unknown, erp: unknown) {
  const name = String(itemName || "").trim();
  const erpCode = String(erp || "").trim();
  if (name && erpCode) return `${name} (${erpCode})`;
  return name || erpCode || "NPD Item";
}

function setFill(doc: jsPDF, fill?: [number, number, number]) {
  const color = fill || WHITE;
  doc.setFillColor(color[0], color[1], color[2]);
}

function setText(doc: jsPDF, color?: [number, number, number]) {
  const nextColor = color || BLACK;
  doc.setTextColor(nextColor[0], nextColor[1], nextColor[2]);
}

function drawCell(doc: jsPDF, x: number, y: number, w: number, h: number, text: RowRecord[string], options: CellOptions = {}) {
  const {
    fontSize = 4.2,
    bold = false,
    align = "center",
    valign = "middle",
    fill,
    textColor,
    border = true,
    padding = 1,
  } = options;

  setFill(doc, fill);
  doc.setDrawColor(0);
  doc.setLineWidth(0.18);
  doc.rect(x, y, w, h, border ? "FD" : "F");

  const content = formatValue(text);
  setText(doc, textColor);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);

  const maxWidth = Math.max(2, w - padding * 2);
  const lines = doc.splitTextToSize(content, maxWidth).slice(0, Math.max(1, Math.floor(h / (fontSize * 0.45))));
  const lineHeight = fontSize * 0.42;
  const totalHeight = lines.length * lineHeight;
  const startY = valign === "top" ? y + padding + lineHeight : y + h / 2 - totalHeight / 2 + lineHeight * 0.85;
  let textX = x + padding;
  if (align === "center") textX = x + w / 2;
  if (align === "right") textX = x + w - padding;
  doc.text(lines, textX, startY, { align });
}

function drawLabelValue(
  doc: jsPDF,
  x: number,
  y: number,
  labelW: number,
  valueW: number,
  h: number,
  label: string,
  value: RowRecord[string],
  labelFill: [number, number, number] = GRAY,
  valueFill: [number, number, number] = WHITE,
) {
  drawCell(doc, x, y, labelW, h, label, { bold: true, align: "left", fill: labelFill, fontSize: 3.7 });
  drawCell(doc, x + labelW, y, valueW, h, value, { bold: true, fill: valueFill, fontSize: 5 });
}

function firstNumber(row: RowRecord | null | undefined, ...keys: string[]) {
  const value = valueOf(row, ...keys);
  const numeric = safeNumber(value);
  return numeric === null ? formatValue(value) : String(numeric);
}

function getLayerRows(npdRow: RowRecord) {
  return [
    ["L1", valueOf(npdRow, "psL1", "rsl1"), valueOf(npdRow, "psL1Bf", "rsl1Bf")],
    ["F1", valueOf(npdRow, "psF1"), valueOf(npdRow, "psF1Bf")],
    ["L2", valueOf(npdRow, "psL2", "rsl3"), valueOf(npdRow, "psL2Bf", "rsl3Bf")],
    ["F2", valueOf(npdRow, "psF2", "rsf2"), valueOf(npdRow, "psF2Bf", "rsf2Bf")],
    ["L3", valueOf(npdRow, "psL3", "rsl5"), valueOf(npdRow, "psL3Bf", "rsf5Bf")],
    ["F3", valueOf(npdRow, "rsf4"), valueOf(npdRow, "rsf4Bf")],
  ];
}

function drawTopHeader(doc: jsPDF, npdRow: RowRecord, setting?: Setting | null) {
  const y = SHEET_Y;
  drawCell(doc, SHEET_X, y, 36, 26, `FILE NO. -\n${formatValue(npdRow.erp)}`, {
    bold: true,
    align: "left",
    fontSize: 5,
    padding: 2,
  });

  drawCell(doc, SHEET_X + 36, y, 62, 26, "", { border: true });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(82, 116, 113);
  doc.text(setting?.organizationName?.trim() || "LAXMI NARAYAN", SHEET_X + 67, y + 13, { align: "center" });
  doc.setFontSize(4.8);
  doc.setTextColor(0);
  doc.text("LAXMINARAYAN CORRUGATED BOARDS LLP", SHEET_X + 67, y + 20, { align: "center" });

  drawCell(doc, SHEET_X + 98, y, 22, 26, "Special\nRemarks", { bold: true, fontSize: 4.3 });
  drawCell(doc, SHEET_X + 120, y, 60, 26, "", { fontSize: 4.3 });

  drawLabelValue(doc, SHEET_X, y + 26, 36, 5, 6, "Sample No.-", "", WHITE, WHITE);
  drawCell(doc, SHEET_X + 41, y + 26, 44, 6, `ERP-\n${formatValue(npdRow.erp)}`, { bold: true, fontSize: 6 });
  drawCell(doc, SHEET_X + 85, y + 26, 35, 6, "ISSUE DATE :", { bold: true, fontSize: 4.2 });
  drawCell(doc, SHEET_X + 120, y + 26, 60, 6, "-", { bold: true, fontSize: 4.2 });

  drawCell(doc, SHEET_X, y + 32, SHEET_W, 4, "Rev-No.- / Rev-Date-", { align: "left", fontSize: 3.2 });
}

function drawMainSpec(doc: jsPDF, npdRow: RowRecord) {
  let y = SHEET_Y + 36;
  drawCell(doc, SHEET_X, y, SHEET_W, 8, "SPECIFICATION SHEET - CFB", {
    bold: true,
    fontSize: 10,
    fill: YELLOW,
  });
  y += 8;

  drawLabelValue(doc, SHEET_X, y, 36, 72, 7, "ITEM NAME", valueOf(npdRow, "itemName"), GRAY, WHITE);
  drawLabelValue(doc, SHEET_X + 108, y, 28, 44, 7, "PARTY\nNAME", valueOf(npdRow, "customerName"), GRAY, WHITE);
  y += 7;

  drawCell(doc, SHEET_X, y, 36, 7, "BOX DIMENSION (ID)", { bold: true, fontSize: 3.6, fill: GRAY });
  drawCell(doc, SHEET_X + 36, y, 72, 7, formatDimension(npdRow.lengthId, npdRow.breadthId, npdRow.heightId), {
    bold: true,
    fontSize: 7,
  });
  drawCell(doc, SHEET_X + 108, y, 28, 7, "REEL DECKLE SIZE (MM)", { bold: true, fontSize: 3.5, fill: GRAY });
  drawCell(doc, SHEET_X + 136, y, 44, 7, valueOf(npdRow, "deckleSize", "reelSize"), { bold: true, fontSize: 7, fill: GREEN });
  y += 7;

  drawCell(doc, SHEET_X, y, 36, 7, "ROTARY DIMENSION (OD)", { bold: true, fontSize: 3.6, fill: GRAY });
  drawCell(doc, SHEET_X + 36, y, 72, 7, formatDimension(npdRow.lengthOd, npdRow.breadthOd, npdRow.heightOd), {
    bold: true,
    fontSize: 7,
  });
  drawCell(doc, SHEET_X + 108, y, 28, 7, "CUTTING LENGTH (MM)", { bold: true, fontSize: 3.5, fill: GRAY });
  drawCell(doc, SHEET_X + 136, y, 44, 7, valueOf(npdRow, "cuttingSize", "cuttingWithTrimming"), { bold: true, fontSize: 7 });
  y += 7;

  const rows: Array<[string, RowRecord[string], string, RowRecord[string], [number, number, number]?]> = [
    ["NO.OF PLY", valueOf(npdRow, "ply"), "FLUTE TYPE", valueOf(npdRow, "fluteType"), undefined],
    ["FLAP", valueOf(npdRow, "flapSize"), "TRIMMING", valueOf(npdRow, "cuttingWithTrimming"), undefined],
    ["BOARD GSM", valueOf(npdRow, "standardBGsm", "calculatedBGsm"), "CAL BS", valueOf(npdRow, "bsKgCm2Calculated"), undefined],
    ["REQUIRED BOARD GSM", valueOf(npdRow, "standardBGsm"), "CAL RCT", valueOf(npdRow, "csKgStd", "csKgTarget"), undefined],
    ["REQUIRED CS", valueOf(npdRow, "csKgTarget", "csKgStd"), "TARGET CS", valueOf(npdRow, "rapc"), GREEN],
  ];

  for (const [leftLabel, leftValue, rightLabel, rightValue, rightFill] of rows) {
    drawLabelValue(doc, SHEET_X, y, 36, 28, 6, leftLabel, leftValue, GRAY, WHITE);
    drawLabelValue(doc, SHEET_X + 64, y, 23, 21, 6, rightLabel, rightValue, GRAY, rightFill || WHITE);
    y += 6;
  }

  drawCell(doc, SHEET_X + 108, SHEET_Y + 65, 72, 8, "PRINTING\nCOLOUR", { bold: true, fontSize: 4.2, fill: PINK });
  drawCell(doc, SHEET_X + 108, SHEET_Y + 73, 36, 8, valueOf(npdRow, "printingColour1"), { bold: true, fontSize: 5 });
  drawCell(doc, SHEET_X + 144, SHEET_Y + 73, 36, 8, valueOf(npdRow, "printingColour2"), { bold: true, fontSize: 5 });
  drawCell(doc, SHEET_X + 108, SHEET_Y + 81, 36, 8, "TOP", { bold: true, fontSize: 4.2, fill: PINK });
  drawCell(doc, SHEET_X + 144, SHEET_Y + 81, 36, 8, valueOf(npdRow, "topPaperShade"), { bold: true, fontSize: 5 });
  drawCell(doc, SHEET_X + 108, SHEET_Y + 89, 36, 8, "BOTTOM", { bold: true, fontSize: 4.2, fill: PINK });
  drawCell(doc, SHEET_X + 144, SHEET_Y + 89, 36, 8, valueOf(npdRow, "backingPaperShade"), { bold: true, fontSize: 5 });

  drawLabelValue(doc, SHEET_X, y, 36, 72, 7, "LAYERS", "GSM        BF", GRAY, WHITE);
  y += 7;
  const layers = getLayerRows(npdRow);
  for (const [layer, gsm, bf] of layers) {
    drawCell(doc, SHEET_X, y, 36, 5, layer, { bold: true, fontSize: 3.7, fill: GRAY });
    drawCell(doc, SHEET_X + 36, y, 36, 5, gsm, { bold: true, fontSize: 4.4 });
    drawCell(doc, SHEET_X + 72, y, 36, 5, bf, { bold: true, fontSize: 4.4 });
    y += 5;
  }

  drawCell(doc, SHEET_X + 108, SHEET_Y + 103, 72, 7, "NO OF UPS", { bold: true, fontSize: 4.5 });
  const upsLabels = ["1 UPS", "2 UPS", "3 UPS", "4 UPS", "5 UPS"];
  const upsValues = [valueOf(npdRow, "ups", "noOfUps"), "", valueOf(npdRow, "dieCutUps"), "", ""];
  upsLabels.forEach((label, index) => {
    drawCell(doc, SHEET_X + 108 + index * 14.4, SHEET_Y + 110, 14.4, 6, label, { bold: true, fontSize: 3.4, fill: GRAY });
    drawCell(doc, SHEET_X + 108 + index * 14.4, SHEET_Y + 116, 14.4, 22, upsValues[index], { bold: true, fontSize: 5 });
  });

  return Math.max(y, SHEET_Y + 138);
}

function drawPhpPlateSection(doc: jsPDF, startY: number, phpRow?: RowRecord | null, plateRow?: RowRecord | null) {
  const y = startY;
  drawCell(doc, SHEET_X, y, 72, 6, "PHP", { bold: true, fontSize: 5.5, fill: CYAN });
  drawCell(doc, SHEET_X + 72, y, 108, 6, "PLATE", { bold: true, fontSize: 5.5, fill: GOLD });

  const phpHeaders = ["LENGTH", "WIDTH", "HEIGHT"];
  const plateHeaders = ["LENGTH", "WIDTH", "PLY", "FLUTE", "BS", "QTY/BOX"];
  phpHeaders.forEach((header, index) => drawCell(doc, SHEET_X + index * 24, y + 6, 24, 6, header, { bold: true, fontSize: 3.5, fill: GRAY }));
  plateHeaders.forEach((header, index) => drawCell(doc, SHEET_X + 72 + index * 18, y + 6, 18, 6, header, { bold: true, fontSize: 3.5, fill: GRAY }));

  const phpValues = [valueOf(phpRow, "length"), valueOf(phpRow, "breadth", "width"), valueOf(phpRow, "height")];
  phpValues.forEach((value, index) => drawCell(doc, SHEET_X + index * 24, y + 12, 24, 7, value, { bold: true, fontSize: 4.5 }));
  const plateValues = [
    valueOf(plateRow, "length"),
    valueOf(plateRow, "breadth", "width"),
    valueOf(plateRow, "noOfPly"),
    valueOf(plateRow, "fluteType"),
    valueOf(plateRow, "brustingStrengthReq"),
    valueOf(plateRow, "numberOfSetsPerBox"),
  ];
  plateValues.forEach((value, index) => drawCell(doc, SHEET_X + 72 + index * 18, y + 12, 18, 7, value, { bold: true, fontSize: 4.5 }));

  const detailRows: Array<[string, RowRecord[string], string, RowRecord[string]]> = [
    ["NO OF PLY", firstNumber(phpRow, "noOfPly"), "V PLATE", ""],
    ["BS/BURSTING STRENGTH", valueOf(phpRow, "brustingStrengthReq"), "H PLATE", ""],
    ["HOLES (LENGTH WISE)", valueOf(phpRow, "holesOrientationL", "numberOfHolesInPhp"), "C PLATE", ""],
    ["HOLES (WIDTH WISE)", valueOf(phpRow, "holesOrientationW"), "A/H PLATE", ""],
    ["QTY/BOX", valueOf(phpRow, "numberOfSetsPerBox"), "CREASER", ""],
    ["FLUTE TYPE", valueOf(phpRow, "fluteType"), "CREASING POINT", ""],
    ["FLUTE DIRECTION", "", "1st CREASING AT", valueOf(plateRow, "creasor1")],
    ["REMARKS", "", "2nd CREASING AT", valueOf(plateRow, "creasor2")],
  ];

  let rowY = y + 19;
  for (const [phpLabel, phpValue, plateLabel, plateValue] of detailRows) {
    drawCell(doc, SHEET_X, rowY, 38, 5.5, phpLabel, { bold: true, align: "left", fontSize: 3.2, fill: TEAL });
    drawCell(doc, SHEET_X + 38, rowY, 34, 5.5, phpValue, { bold: true, fontSize: 3.6 });
    drawCell(doc, SHEET_X + 72, rowY, 38, 5.5, plateLabel, { bold: true, fontSize: 3.2, fill: PINK });
    drawCell(doc, SHEET_X + 110, rowY, 70, 5.5, plateValue, { bold: true, fontSize: 3.6 });
    rowY += 5.5;
  }

  drawCell(doc, SHEET_X, rowY, SHEET_W, 6, "PHP DIAGRAM", { bold: true, fontSize: 4.5 });
  return rowY + 6;
}

function drawRevisionFooter(doc: jsPDF, startY: number) {
  let y = startY;
  drawCell(doc, SHEET_X, y, 34, 7, "REMARK", { bold: true, align: "left", fontSize: 7 });
  drawCell(doc, SHEET_X + 34, y, 146, 7, "", { fontSize: 4 });
  y += 7;

  drawCell(doc, SHEET_X, y, SHEET_W, 6, "Revision", { bold: true, align: "left", fontSize: 5 });
  y += 6;
  drawCell(doc, SHEET_X, y, 18, 6, "No.", { bold: true, fontSize: 4 });
  drawCell(doc, SHEET_X + 18, y, 24, 6, "Rev.Date", { bold: true, fontSize: 4 });
  drawCell(doc, SHEET_X + 42, y, 54, 6, "Description of revision", { bold: true, fontSize: 4 });
  drawCell(doc, SHEET_X + 96, y, 84, 6, "Reason for Revision", { bold: true, fontSize: 4 });
  y += 6;

  drawCell(doc, SHEET_X, y, 18, 10, "0", { fontSize: 4 });
  drawCell(doc, SHEET_X + 18, y, 24, 10, "-", { fontSize: 4 });
  drawCell(doc, SHEET_X + 42, y, 54, 10, "As per uploaded sheet", { fontSize: 4 });
  drawCell(doc, SHEET_X + 96, y, 84, 10, "For better accuracy", { fontSize: 4 });
  y += 10;

  drawCell(doc, SHEET_X, y, 52, 8, "PREPARED BY", { bold: true, align: "left", fontSize: 4.5 });
  drawCell(doc, SHEET_X + 52, y, 76, 8, "MASTER COPY", { bold: true, fontSize: 7, textColor: [0, 0, 180] });
  drawCell(doc, SHEET_X + 128, y, 52, 8, "APPROVED BY", { bold: true, fontSize: 4.5, textColor: [220, 0, 0] });
}

export async function downloadNpdCardPdf({ npdRow, phpRow, plateRow, setting }: DownloadNpdCardPdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");

  doc.setProperties({
    title: `NPD Card - ${safeHeaderName(npdRow.itemName, npdRow.erp)}`,
    subject: "Specification Sheet - CFB",
  });

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(5, 5, PAGE_WIDTH - 10, PAGE_HEIGHT - 10);

  drawTopHeader(doc, npdRow, setting);
  const afterSpecY = drawMainSpec(doc, npdRow);
  const afterLinkedY = drawPhpPlateSection(doc, afterSpecY, phpRow, plateRow);
  drawRevisionFooter(doc, Math.min(afterLinkedY + 2, 245));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(3);
  doc.setTextColor(120);
  doc.text("Generated from NPD Master", MARGIN_X, PAGE_HEIGHT - 7);

  const safeFileName = safeHeaderName(npdRow.itemName, npdRow.erp).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "NPD_Item";
  doc.save(`NPD_Card_${safeFileName}.pdf`);
}
