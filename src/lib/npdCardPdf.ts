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
  fill?: [number, number, number];
  textColor?: [number, number, number];
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const LEFT = 12;
const TOP = 12;
const CONTENT_WIDTH = 186;
const FONT_10PX = 7.5;
const FONT_12PX = 9;
const FONT_TITLE = 13;
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const LIGHT_GRAY: [number, number, number] = [245, 247, 250];
const MID_GRAY: [number, number, number] = [225, 229, 235];
const DARK_BLUE: [number, number, number] = [15, 45, 83];
const HEADER_BLUE: [number, number, number] = [217, 232, 252];
const YELLOW: [number, number, number] = [255, 242, 0];
const GREEN: [number, number, number] = [220, 252, 231];
const CYAN: [number, number, number] = [207, 250, 254];
const ORANGE: [number, number, number] = [254, 243, 199];

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

function formatDimension(...values: Array<RowRecord[string]>) {
  const parts = values.map(formatValue);
  if (parts.every((part) => part === "-")) return "-";
  return parts.join(" × ");
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

function setColors(doc: jsPDF, fill?: [number, number, number], textColor?: [number, number, number]) {
  const background = fill || WHITE;
  const foreground = textColor || BLACK;
  doc.setFillColor(background[0], background[1], background[2]);
  doc.setTextColor(foreground[0], foreground[1], foreground[2]);
}

function drawCell(doc: jsPDF, x: number, y: number, w: number, h: number, text: RowRecord[string], options: CellOptions = {}) {
  const { bold = false, fontSize = FONT_10PX, align = "left", fill, textColor } = options;
  setColors(doc, fill, textColor);
  doc.setDrawColor(0);
  doc.setLineWidth(0.16);
  doc.rect(x, y, w, h, "FD");

  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const padding = 2;
  const lines = doc.splitTextToSize(formatValue(text), Math.max(2, w - padding * 2));
  const lineHeight = fontSize * 0.42;
  const maxLines = Math.max(1, Math.floor((h - 2) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  const textX = align === "center" ? x + w / 2 : align === "right" ? x + w - padding : x + padding;
  const textY = y + h / 2 - ((visibleLines.length - 1) * lineHeight) / 2 + lineHeight * 0.35;
  doc.text(visibleLines, textX, textY, { align });
}

function drawSectionTitle(doc: jsPDF, title: string, y: number, fill: [number, number, number] = HEADER_BLUE) {
  drawCell(doc, LEFT, y, CONTENT_WIDTH, 8, title, {
    bold: true,
    fontSize: FONT_12PX,
    align: "center",
    fill,
    textColor: DARK_BLUE,
  });
  return y + 8;
}

function drawInfoGrid(doc: jsPDF, y: number, rows: Array<[string, RowRecord[string], string, RowRecord[string]]>) {
  const labelW = 34;
  const valueW = 59;
  const rowH = 9;
  for (const [labelA, valueA, labelB, valueB] of rows) {
    drawCell(doc, LEFT, y, labelW, rowH, labelA, { bold: true, fill: LIGHT_GRAY });
    drawCell(doc, LEFT + labelW, y, valueW, rowH, valueA, { bold: true, fontSize: FONT_12PX });
    drawCell(doc, LEFT + labelW + valueW, y, labelW, rowH, labelB, { bold: true, fill: LIGHT_GRAY });
    drawCell(doc, LEFT + labelW + valueW + labelW, y, valueW, rowH, valueB, { bold: true, fontSize: FONT_12PX });
    y += rowH;
  }
  return y;
}

function drawSimpleTable(doc: jsPDF, y: number, headers: string[], rows: RowRecord[string][][], widths: number[], headerFill: [number, number, number]) {
  let x = LEFT;
  headers.forEach((header, index) => {
    drawCell(doc, x, y, widths[index], 8, header, { bold: true, align: "center", fill: headerFill });
    x += widths[index];
  });
  y += 8;

  for (const row of rows) {
    x = LEFT;
    row.forEach((value, index) => {
      drawCell(doc, x, y, widths[index], 8, value, { align: "center", fontSize: FONT_10PX });
      x += widths[index];
    });
    y += 8;
  }
  return y;
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

async function drawHeader(doc: jsPDF, npdRow: RowRecord, setting?: Setting | null) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.rect(6, 6, PAGE_WIDTH - 12, PAGE_HEIGHT - 12);

  const hasLogo = await drawOrganizationLogo(doc, setting, LEFT, TOP, 34, 18);
  if (!hasLogo) {
    drawCell(doc, LEFT, TOP, 34, 18, "LOGO", { bold: true, align: "center", fill: LIGHT_GRAY, textColor: DARK_BLUE });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_TITLE);
  doc.setTextColor(DARK_BLUE[0], DARK_BLUE[1], DARK_BLUE[2]);
  doc.text(setting?.organizationName?.trim() || "LAXMI NARAYAN", 105, TOP + 7, { align: "center" });
  doc.setFontSize(FONT_10PX);
  doc.setTextColor(0);
  doc.text("LAXMINARAYAN CORRUGATED BOARDS LLP", 105, TOP + 13, { align: "center" });

  drawCell(doc, 158, TOP, 40, 9, "FILE / ERP NO.", { bold: true, align: "center", fill: LIGHT_GRAY });
  drawCell(doc, 158, TOP + 9, 40, 9, valueOf(npdRow, "erp"), { bold: true, align: "center", fontSize: FONT_12PX });

  drawCell(doc, LEFT, TOP + 22, CONTENT_WIDTH, 10, "SPECIFICATION SHEET - CFB", {
    bold: true,
    align: "center",
    fontSize: FONT_TITLE,
    fill: YELLOW,
  });

  return TOP + 36;
}

function drawItemDetails(doc: jsPDF, y: number, npdRow: RowRecord) {
  y = drawSectionTitle(doc, "ITEM DETAILS", y);
  return drawInfoGrid(doc, y, [
    ["Item Name", valueOf(npdRow, "itemName"), "Customer", valueOf(npdRow, "customerName")],
    ["ERP Code", valueOf(npdRow, "erp"), "Box Type", valueOf(npdRow, "boxType")],
    ["UOM", valueOf(npdRow, "uom"), "Rate", valueOf(npdRow, "rate")],
  ]);
}

function drawSpecifications(doc: jsPDF, y: number, npdRow: RowRecord) {
  y = drawSectionTitle(doc, "BOX SPECIFICATIONS", y + 3);
  return drawInfoGrid(doc, y, [
    ["Dimension ID", formatDimension(npdRow.lengthId, npdRow.breadthId, npdRow.heightId), "Dimension OD", formatDimension(npdRow.lengthOd, npdRow.breadthOd, npdRow.heightOd)],
    ["Ply", valueOf(npdRow, "ply"), "Flute Type", valueOf(npdRow, "fluteType")],
    ["Flap Size", valueOf(npdRow, "flapSize"), "Deckle Size", valueOf(npdRow, "deckleSize", "reelSize")],
    ["Cutting Size", valueOf(npdRow, "cuttingSize", "cuttingWithTrimming"), "No. of Ups", valueOf(npdRow, "ups", "noOfUps", "dieCutUps")],
    ["RAPC", valueOf(npdRow, "rapc", "rapcForSingleBox"), "Standard Wt.", valueOf(npdRow, "standardWeightGms", "calculatedWeightPerBox")],
    ["Top Shade", valueOf(npdRow, "topPaperShade"), "Back Shade", valueOf(npdRow, "backingPaperShade")],
    ["Print Color 1", valueOf(npdRow, "printingColour1"), "Print Color 2", valueOf(npdRow, "printingColour2")],
  ]);
}

function drawPaperLayerTable(doc: jsPDF, y: number, rows: RowRecord[string][][]) {
  const widths = [30, 52, 52, 52];
  const headerFill: [number, number, number] = [204, 222, 245];
  let x = LEFT;

  drawCell(doc, x, y, widths[0] + widths[1], 8, "LAYERS", { bold: true, align: "center", fill: headerFill, fontSize: FONT_12PX });
  x += widths[0] + widths[1];
  drawCell(doc, x, y, widths[2], 8, "GSM", { bold: true, align: "center", fill: headerFill, fontSize: FONT_12PX });
  x += widths[2];
  drawCell(doc, x, y, widths[3], 8, "BF", { bold: true, align: "center", fill: headerFill, fontSize: FONT_12PX });
  y += 8;

  for (const row of rows) {
    x = LEFT;
    row.forEach((value, index) => {
      drawCell(doc, x, y, widths[index], 8, value, { bold: true, align: "center", fontSize: FONT_10PX });
      x += widths[index];
    });
    y += 8;
  }

  return y;
}

function drawLayers(doc: jsPDF, y: number, npdRow: RowRecord) {
  y = drawSectionTitle(doc, "PAPER LAYERS", y + 3, GREEN);
  return drawPaperLayerTable(doc, y, [
    ["", "Top Layer", valueOf(npdRow, "psL1"), valueOf(npdRow, "psL1Bf")],
    ["Fluting 1", "C FLUTING", valueOf(npdRow, "psF1"), valueOf(npdRow, "psF1Bf")],
    ["Backing 1", "C BACKING", valueOf(npdRow, "psL2"), valueOf(npdRow, "psL2Bf")],
    ["Fluting 2", "B FLUTING", valueOf(npdRow, "psF2"), valueOf(npdRow, "psF2Bf")],
    ["Backing 2", "B BACKING", "", ""],
  ]);
}

function drawLinkedItems(doc: jsPDF, y: number, phpRow?: RowRecord | null, plateRow?: RowRecord | null) {
  y = drawSectionTitle(doc, "CONNECTED PHP / PLATE DETAILS", y + 3, CYAN);
  return drawSimpleTable(
    doc,
    y,
    ["Source", "Length", "Width", "Height", "Ply", "Flute", "Qty/Box", "BS"],
    [
      ["PHP", valueOf(phpRow, "length"), valueOf(phpRow, "breadth", "width"), valueOf(phpRow, "height"), valueOf(phpRow, "noOfPly"), valueOf(phpRow, "fluteType"), valueOf(phpRow, "numberOfSetsPerBox"), valueOf(phpRow, "brustingStrengthReq")],
      ["PLATE", valueOf(plateRow, "length"), valueOf(plateRow, "breadth", "width"), valueOf(plateRow, "height"), valueOf(plateRow, "noOfPly"), valueOf(plateRow, "fluteType"), valueOf(plateRow, "numberOfSetsPerBox"), valueOf(plateRow, "brustingStrengthReq")],
    ],
    [24, 23, 23, 23, 20, 27, 23, 23],
    CYAN,
  );
}

function drawFooter(doc: jsPDF, y: number) {
  y = drawSectionTitle(doc, "REMARKS / APPROVAL", y + 3, ORANGE);
  drawCell(doc, LEFT, y, CONTENT_WIDTH, 16, "", { align: "left" });
  y += 16;
  drawCell(doc, LEFT, y, 62, 11, "PREPARED BY", { bold: true, align: "center", fill: LIGHT_GRAY });
  drawCell(doc, LEFT + 62, y, 62, 11, "MASTER COPY", { bold: true, align: "center", textColor: [0, 0, 180] });
  drawCell(doc, LEFT + 124, y, 62, 11, "APPROVED BY", { bold: true, align: "center", textColor: [220, 0, 0] });
}

export async function downloadNpdCardPdf({ npdRow, phpRow, plateRow, setting }: DownloadNpdCardPdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");

  doc.setProperties({
    title: `NPD Card - ${safeHeaderName(npdRow.itemName, npdRow.erp)}`,
    subject: "Specification Sheet - CFB",
  });

  let y = await drawHeader(doc, npdRow, setting);
  y = drawItemDetails(doc, y, npdRow);
  y = drawSpecifications(doc, y, npdRow);
  y = drawLayers(doc, y, npdRow);
  y = drawLinkedItems(doc, y, phpRow, plateRow);
  drawFooter(doc, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_10PX);
  doc.setTextColor(120);
  doc.text("Generated from NPD Master", LEFT, PAGE_HEIGHT - 8);

  const safeFileName = safeHeaderName(npdRow.itemName, npdRow.erp).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "NPD_Item";
  doc.save(`NPD_Card_${safeFileName}.pdf`);
}
