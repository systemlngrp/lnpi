import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PHP_ITEM_MASTER_COLUMNS, PLATE_ITEM_MASTER_COLUMNS } from "./sheetMasterConfigs";
import { NPD_COLUMNS } from "./npdCardConfig";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";
import type { Setting } from "../types";

type RowRecord = Record<string, string | number | boolean | null | undefined>;

type DownloadNpdCardPdfArgs = {
  npdRow: RowRecord;
  phpRow?: RowRecord | null;
  plateRow?: RowRecord | null;
  setting?: Setting | null;
};

function formatCellValue(value: RowRecord[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatStockValue(rate: RowRecord[string], balance: RowRecord[string]) {
  const rateNumber = Number(rate);
  const balanceNumber = Number(balance);
  if (!Number.isFinite(rateNumber) || !Number.isFinite(balanceNumber)) return "-";
  return (rateNumber * balanceNumber).toFixed(2);
}

function safeHeaderName(itemName: unknown, erp: unknown) {
  const name = String(itemName || "").trim();
  const erpCode = String(erp || "").trim();
  if (name && erpCode) return `${name} (${erpCode})`;
  return name || erpCode || "NPD Item";
}

function toSectionRows(columns: Array<{ key: string; label: string }>, row?: RowRecord | null, extraFormatters?: Record<string, (row: RowRecord) => string>) {
  if (!row) return [["Status", "Not found"]];
  return columns.map((column) => {
    const formatted = extraFormatters?.[column.key]
      ? extraFormatters[column.key](row)
      : formatCellValue(row[column.key]);
    return [column.label, formatted];
  });
}

function drawSectionTitle(doc: jsPDF, title: string, startY: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(title, 14, startY);
  return startY + 3;
}

function drawSectionTable(doc: jsPDF, startY: number, rows: string[][]) {
  autoTable(doc, {
    startY,
    margin: { left: 14, right: 14 },
    body: rows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: 0,
      cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      overflow: "linebreak",
      valign: "top",
    },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: "bold", fillColor: [245, 245, 245] },
      1: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  return (doc as any).lastAutoTable.finalY + 8;
}

export async function downloadNpdCardPdf({ npdRow, phpRow, plateRow, setting }: DownloadNpdCardPdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");

  let currentY = (await renderOrganizationHeader(doc, setting, {
    startY: 12,
    drawDivider: true,
  })).currentY;

  const headerText = safeHeaderName(npdRow.itemName, npdRow.erp);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("NPD CARD", 105, currentY, { align: "center" });
  currentY += 8;
  doc.setFontSize(12);
  doc.text(headerText, 105, currentY, { align: "center" });
  currentY += 10;

  currentY = drawSectionTitle(doc, "NPD Specifications", currentY);
  currentY = drawSectionTable(doc, currentY, toSectionRows(NPD_COLUMNS, npdRow, {
    stockValue: (row) => formatStockValue(row.rate, row.balance),
  }));

  currentY = drawSectionTitle(doc, "Connected PHP Item", currentY);
  currentY = drawSectionTable(
    doc,
    currentY,
    phpRow
      ? toSectionRows(PHP_ITEM_MASTER_COLUMNS, phpRow)
      : [["Status", "No connected PHP item found"]]
  );

  currentY = drawSectionTitle(doc, "Connected Plate Item", currentY);
  drawSectionTable(
    doc,
    currentY,
    plateRow
      ? toSectionRows(PLATE_ITEM_MASTER_COLUMNS, plateRow)
      : [["Status", "No connected Plate item found"]]
  );

  const safeFileName = headerText.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "NPD_Item";
  doc.save(`NPD_Card_${safeFileName}.pdf`);
}
