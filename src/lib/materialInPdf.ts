import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import { MaterialIn, Material, Item, Service, Supplier, Setting, Company } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

function formatMoney(value: number) {
  return `Rs ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  doc.setFontSize(15);
  doc.text("MATERIAL RECEIPT", 105, currentY, { align: "center" });
  currentY += 10;

  const supplier = suppliers.find((s) => s.id === mrr.supplierId);
  const company = companies?.find((entry) => entry.id === mrr.supplierId);
  const supplierLabel = supplier?.name || company?.name || mrr.supplierId;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const detailRows = [
    ["MRR No", mrr.transactionNo],
    ["MRR Date", formatDate(mrr.date)],
    ["Gate Entry No", mrr.gateEntryNo || "-"],
    ["Supplier / Customer", supplierLabel],
    ["Invoice No", mrr.invoiceNo],
    ["Invoice Date", formatDate(mrr.invDate)],
    ["Status", mrr.status],
    ["MRR Type", mrr.mrrType || "Others"],
    ["Invoice Currency", mrr.invoiceCurrency || "INR"],
    ["Exchange Rate", mrr.invoiceCurrency === "USD" ? Number(mrr.exchangeRate || 0).toFixed(4) : "-"],
  ];

  detailRows.forEach(([label, value], index) => {
    const columnX = index % 2 === 0 ? 14 : 110;
    const rowY = currentY + Math.floor(index / 2) * 8;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, columnX, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), columnX + 30, rowY);
  });
  currentY += 43;

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
      Number(line.cgst || 0).toFixed(2),
      Number(line.sgst || 0).toFixed(2),
      Number(line.igst || 0).toFixed(2),
      Number(line.invoiceValue || 0).toFixed(2),
      Number(line.actualValue || line.value || 0).toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "Our PO No.", "UOM", "Inv Qty", "Act Qty", "Rate", "GST %", "CGST", "SGST", "IGST", "Invoice Value", "Actual Value"]],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [79, 70, 229] },
    styles: { fontSize: 8, cellPadding: 2, textColor: 0 },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { cellWidth: 42 },
      2: { cellWidth: 24 },
      3: { halign: "center", cellWidth: 12 },
      4: { halign: "right", cellWidth: 14 },
      5: { halign: "right", cellWidth: 14 },
      6: { halign: "right", cellWidth: 14 },
      7: { halign: "right", cellWidth: 12 },
      8: { halign: "right", cellWidth: 14 },
      9: { halign: "right", cellWidth: 14 },
      10: { halign: "right", cellWidth: 14 },
      11: { halign: "right", cellWidth: 18 },
      12: { halign: "right", cellWidth: 18 },
    },
    margin: { left: 8, right: 8 },
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Summary", 138, footerY);
  footerY += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
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

  summaryRows.forEach(([label, value], index) => {
    const y = footerY + index * 6;
    doc.text(`${label}:`, 138, y);
    doc.text(value, 196, y, { align: "right" });
  });

  footerY += summaryRows.length * 6 + 2;
  doc.setFont("helvetica", "bold");
  doc.text(`Total Amount:`, 138, footerY);
  doc.text(formatMoney(Number(mrr.totalAmount || 0)), 196, footerY, { align: "right" });
  footerY += 10;

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
  doc.text(`Generated on ${formatDate(new Date().toISOString())}`, 14, 285);

  doc.save(`MRR_${mrr.transactionNo}.pdf`);
}
