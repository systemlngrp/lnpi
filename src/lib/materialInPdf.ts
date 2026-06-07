import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import { MaterialIn, Material, Item, Supplier, Setting } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

export async function downloadMaterialInPdf({
  mrr,
  materials,
  npdItems,
  suppliers,
  setting,
}: {
  mrr: MaterialIn;
  materials: Material[];
  npdItems: Item[];
  suppliers: Supplier[];
  setting?: Setting | null;
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("MATERIAL RECEIPT", 105, currentY, { align: "center" });
  currentY += 10;

  const supplier = suppliers.find(s => s.id === mrr.supplierId);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const detailRows = [
    ["MRR No", mrr.transactionNo],
    ["MRR Date", formatDate(mrr.date)],
    ["Gate Entry No", mrr.gateEntryNo || "-"],
    ["Supplier", supplier?.name || mrr.supplierId],
    ["Invoice No", mrr.invoiceNo],
    ["Invoice Date", formatDate(mrr.invDate)],
    ["Status", mrr.status],
    ["MRR Type", mrr.mrrType || "Others"],
  ];

  detailRows.forEach(([label, value], index) => {
    const columnX = index % 2 === 0 ? 14 : 110;
    const rowY = currentY + Math.floor(index / 2) * 8;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, columnX, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), columnX + 30, rowY);
  });
  currentY += 35;

  const lineTableRows = mrr.lines.map((line, index) => {
    const itemName = materials.find(m => m.id === line.itemId)?.name || npdItems.find(i => i.id === line.itemId)?.name || "Unknown";
    return [
      index + 1,
      itemName,
      line.uom,
      Number(line.invoiceQty || 0).toFixed(2),
      Number(line.actualQty || line.qty || 0).toFixed(2),
      Number(line.invoiceRate || line.rate || 0).toFixed(2),
      Number(line.invoiceValue || 0).toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "UOM", "Inv Qty", "Act Qty", "Rate", "Amount"]],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [79, 70, 229] },
    styles: { fontSize: 8, cellPadding: 2, textColor: 0 },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { cellWidth: 70 },
      2: { halign: "center", cellWidth: 15 },
      3: { halign: "right", cellWidth: 20 },
      4: { halign: "right", cellWidth: 20 },
      5: { halign: "right", cellWidth: 20 },
      6: { halign: "right", cellWidth: 25 },
    },
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
  
  doc.setFont("helvetica", "bold");
  doc.text(`Total Amount: Rs ${Number(mrr.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 196, footerY, { align: "right" });
  footerY += 15;

  if (mrr.plant_head_remark || mrr.accounts_remark || mrr.md_approval_remark) {
    doc.setFontSize(10);
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
