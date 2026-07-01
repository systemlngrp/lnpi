import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import { MaterialIn, Material, Item, Service, Supplier, Setting, Company } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

function formatMoney(value: number) {
  return `Rs ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawLabelValueRow(
  doc: jsPDF,
  labelX: number,
  valueX: number,
  y: number,
  label: string,
  value: string,
  valueWidth?: number
) {
  doc.setFont("helvetica", "bold");
  doc.text(`${label}:`, labelX, y);
  doc.setFont("helvetica", "normal");
  if (valueWidth && valueWidth > 0) {
    const lines = doc.splitTextToSize(String(value || "-"), valueWidth);
    doc.text(lines, valueX, y);
    return lines.length;
  }
  doc.text(String(value || "-"), valueX, y);
  return 1;
}

export async function downloadMaterialInPdf({
  mrr,
  materials,
  npdItems,
  services,
  suppliers,
  companies,
  setting,
}: {
  mrr: MaterialIn;
  materials: Material[];
  npdItems: Item[];
  services?: Service[];
  suppliers: Supplier[];
  companies?: Company[];
  setting?: Setting | null;
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MATERIAL RECEIPT", 105, currentY, { align: "center" });
  currentY += 8;

  const supplier = suppliers.find((s) => s.id === mrr.supplierId);
  const company = companies?.find((entry) => entry.id === mrr.supplierId);
  const supplierLabel = supplier?.name || company?.name || mrr.supplierId;

  const cardX = 14;
  const cardY = currentY;
  const cardWidth = 182;
  const leftLabelX = 20;
  const leftValueX = 48;
  const rightLabelX = 109;
  const rightValueX = 139;
  const leftValueWidth = 50;
  const rightValueWidth = 52;
  const rowGap = 8;

  const leftRows: Array<[string, string]> = [
    ["MRR No", mrr.transactionNo],
    ["Gate Entry No", mrr.gateEntryNo || "-"],
    ["Invoice No", mrr.invoiceNo || "-"],
    ["Status", mrr.status || "-"],
    ["Invoice Currency", mrr.invoiceCurrency || "INR"],
  ];

  const rightRows: Array<[string, string]> = [
    ["MRR Date", formatDate(mrr.date)],
    ["Supplier / Customer", supplierLabel],
    ["Invoice Date", formatDate(mrr.invDate)],
    ["MRR Type", mrr.mrrType || "Others"],
    ["Exchange Rate", mrr.invoiceCurrency === "USD" ? Number(mrr.exchangeRate || 0).toFixed(4) : "-"],
  ];

  const leftLineCounts = leftRows.map(([label, value], index) =>
    drawLabelValueRow(doc, leftLabelX, leftValueX, cardY + 10 + index * rowGap, label, value, leftValueWidth)
  );
  const rightLineCounts = rightRows.map(([label, value], index) =>
    drawLabelValueRow(doc, rightLabelX, rightValueX, cardY + 10 + index * rowGap, label, value, rightValueWidth)
  );

  const extraRightLines = Math.max(0, ...(rightLineCounts.map((count) => count - 1)));
  const cardHeight = 48 + extraRightLines * 4.5;
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2);
  doc.line(105, cardY + 4, 105, cardY + cardHeight - 4);

  currentY = cardY + cardHeight + 8;

  const lineTableRows = mrr.lines.map((line, index) => {
    const itemName =
      line.itemName ||
      line.serviceName ||
      services?.find((service) => service.id === line.itemId)?.name ||
      materials.find(m => m.id === line.itemId)?.name ||
      npdItems.find(i => i.id === line.itemId)?.name ||
      "Unknown";
    return [
      index + 1,
      line.sourceGatePassItemDescription ? `${itemName} (${line.sourceGatePassItemDescription})` : itemName,
      line.poNo || "-",
      line.uom,
      Number(line.invoiceQty || 0).toFixed(2),
      Number(line.actualQty || line.qty || 0).toFixed(2),
      Number(line.invoiceRate || line.rate || 0).toFixed(2),
      Number(line.gstRate || 0).toFixed(2),
      Number(line.invoiceValue || 0).toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "Our PO No.", "UOM", "Inv Qty", "Act Qty", "Rate", "GST %", "Invoice Value"]],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [43, 63, 100], textColor: 255, fontStyle: "bold" },
    bodyStyles: { lineColor: [170, 170, 170], lineWidth: 0.15 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 8.5, cellPadding: 2.8, textColor: 0, valign: "middle" },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { cellWidth: 60 },
      2: { cellWidth: 26 },
      3: { halign: "center", cellWidth: 12 },
      4: { halign: "right", cellWidth: 16 },
      5: { halign: "right", cellWidth: 16 },
      6: { halign: "right", cellWidth: 16 },
      7: { halign: "right", cellWidth: 14 },
      8: { halign: "right", cellWidth: 22 },
    },
    margin: { left: 14, right: 14 },
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
  const summaryRows: Array<[string, string]> = [
    ["Invoice Value", formatMoney(Number(mrr.totalInvoiceValue || 0))],
    ["Actual Value", formatMoney(Number(mrr.totalActualValue || 0))],
    ["CGST", formatMoney(Number(mrr.totalCgst || 0))],
    ["SGST", formatMoney(Number(mrr.totalSgst || 0))],
    ["IGST", formatMoney(Number(mrr.totalIgst || 0))],
    ["Invoice After GST", formatMoney(Number(mrr.totalInvoiceValueAfterGst || 0))],
    ["Insurance", formatMoney(Number(mrr.insurance || 0))],
    ["Other Charges", formatMoney(Number(mrr.otherCharges || 0))],
    ["Round Off", formatMoney(Number(mrr.roundOff || 0))],
  ];
  const summaryBoxX = 118;
  const summaryBoxY = footerY;
  const summaryBoxWidth = 78;
  const summaryBoxHeight = 16 + summaryRows.length * 6 + 10;

  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.roundedRect(summaryBoxX, summaryBoxY, summaryBoxWidth, summaryBoxHeight, 2, 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", summaryBoxX + 4, summaryBoxY + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  summaryRows.forEach(([label, value], index) => {
    const y = summaryBoxY + 14 + index * 6;
    doc.text(`${label}:`, summaryBoxX + 4, y);
    doc.text(value, summaryBoxX + summaryBoxWidth - 4, y, { align: "right" });
  });

  const totalY = summaryBoxY + 14 + summaryRows.length * 6 + 2;
  doc.line(summaryBoxX + 4, totalY - 2, summaryBoxX + summaryBoxWidth - 4, totalY - 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total Amount:", summaryBoxX + 4, totalY + 4);
  doc.text(formatMoney(Number(mrr.totalAmount || 0)), summaryBoxX + summaryBoxWidth - 4, totalY + 4, { align: "right" });
  footerY = summaryBoxY + summaryBoxHeight + 8;

  if (mrr.plant_head_remark || mrr.accounts_remark || mrr.md_approval_remark) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Approval Remarks:", 14, footerY);
    footerY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (mrr.plant_head_remark) {
      doc.text(`PH: ${mrr.plant_head_remark}`, 14, footerY);
      footerY += 5;
    }
    if (mrr.accounts_remark) {
      doc.text(`Accounts: ${mrr.accounts_remark}`, 14, footerY);
      footerY += 5;
    }
    if (mrr.md_approval_remark) {
      doc.text(`MD: ${mrr.md_approval_remark}`, 14, footerY);
      footerY += 5;
    }
  }

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Generated on ${formatDate(new Date().toISOString())}`, 14, Math.min(footerY + 6, 285));

  doc.save(`MRR_${mrr.transactionNo}.pdf`);
}
