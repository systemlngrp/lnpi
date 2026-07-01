import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import { MaterialIn, Material, Item, Service, Supplier, Setting, Company } from "../types";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

function formatMoney(value: number) {
  return `Rs ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDisplayDate(value?: string) {
  return value ? formatDate(value) : "-";
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
  const hasIgst = Number(mrr.totalIgst || 0) > 0;
  const hasCgstOrSgst = Number(mrr.totalCgst || 0) > 0 || Number(mrr.totalSgst || 0) > 0;

  const metadataRows: Array<[string, string, string, string]> = [
    [
      "MRR No",
      mrr.transactionNo,
      "MRR Date",
      formatDisplayDate(mrr.date),
    ],
    [
      "Gate Entry No",
      mrr.gateEntryNo || "-",
      "Supplier / Customer",
      supplierLabel,
    ],
    [
      "Invoice No",
      mrr.invoiceNo || "-",
      "Invoice Date",
      formatDisplayDate(mrr.invDate),
    ],
    [
      "Status",
      mrr.status || "-",
      "MRR Type",
      mrr.mrrType || "Others",
    ],
    [
      "Invoice Currency",
      mrr.invoiceCurrency || "INR",
      "Exchange Rate",
      mrr.invoiceCurrency === "USD" ? Number(mrr.exchangeRate || 0).toFixed(4) : "-",
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    body: metadataRows,
    theme: "grid",
    styles: {
      fontSize: 10.5,
      cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 },
      textColor: 0,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
    },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 27, fontStyle: "bold", fillColor: [247, 248, 251] },
      1: { cellWidth: 56 },
      2: { cellWidth: 29, fontStyle: "bold", fillColor: [247, 248, 251] },
      3: { cellWidth: 56 },
    },
  });

  currentY = ((doc as any).lastAutoTable?.finalY || currentY) + 8;

  const lineTableHead = [
    "SL",
    "Item Name",
    "Our PO No.",
    "UOM",
    "Inv Qty",
    "Act Qty",
    "Rate",
    "GST %",
  ];

  if (hasCgstOrSgst) {
    lineTableHead.push("CGST", "SGST");
  }
  if (hasIgst) {
    lineTableHead.push("IGST");
  }

  lineTableHead.push("Inv Value", "Act Value");

  const lineTableRows = mrr.lines.map((line, index) => {
    const itemName =
      line.itemName ||
      line.serviceName ||
      services?.find((service) => service.id === line.itemId)?.name ||
      materials.find(m => m.id === line.itemId)?.name ||
      npdItems.find(i => i.id === line.itemId)?.name ||
      "Unknown";

    const row = [
      index + 1,
      line.sourceGatePassItemDescription ? `${itemName} (${line.sourceGatePassItemDescription})` : itemName,
      line.poNo || "-",
      line.uom || "-",
      formatQty(Number(line.invoiceQty || 0)),
      formatQty(Number(line.actualQty || line.qty || 0)),
      formatRate(Number(line.invoiceRate || line.rate || 0)),
      formatRate(Number(line.gstRate || 0)),
    ];

    if (hasCgstOrSgst) {
      row.push(formatRate(Number(line.cgst || 0)), formatRate(Number(line.sgst || 0)));
    }
    if (hasIgst) {
      row.push(formatRate(Number(line.igst || 0)));
    }

    row.push(
      formatRate(Number(line.invoiceValue || 0)),
      formatRate(Number(line.actualValue || line.value || 0)),
    );

    return row;
  });

  const columnStyles: Record<number, any> = {
    0: { halign: "center", cellWidth: 10 },
    1: { cellWidth: 44 },
    2: { cellWidth: 18 },
    3: { halign: "center", cellWidth: 10 },
    4: { halign: "right", cellWidth: 12 },
    5: { halign: "right", cellWidth: 12 },
    6: { halign: "right", cellWidth: 12 },
    7: { halign: "right", cellWidth: 10 },
  };

  let columnIndex = 8;
  if (hasCgstOrSgst) {
    columnStyles[columnIndex] = { halign: "right", cellWidth: 12 };
    columnStyles[columnIndex + 1] = { halign: "right", cellWidth: 12 };
    columnIndex += 2;
  }
  if (hasIgst) {
    columnStyles[columnIndex] = { halign: "right", cellWidth: 12 };
    columnIndex += 1;
  }
  columnStyles[columnIndex] = { halign: "right", cellWidth: 14 };
  columnStyles[columnIndex + 1] = { halign: "right", cellWidth: 14 };

  autoTable(doc, {
    startY: currentY,
    head: [lineTableHead],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [43, 63, 100], textColor: 255, fontStyle: "bold" },
    bodyStyles: { lineColor: [170, 170, 170], lineWidth: 0.15 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 8.3, cellPadding: 2.5, textColor: 0, valign: "middle", overflow: "linebreak" },
    columnStyles,
    margin: { left: 14, right: 14 },
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
  const summaryRows: Array<[string, string]> = [
    ["Invoice Value", formatMoney(Number(mrr.totalInvoiceValue || 0))],
    ["Actual Value", formatMoney(Number(mrr.totalActualValue || 0))],
    ["Invoice After GST", formatMoney(Number(mrr.totalInvoiceValueAfterGst || 0))],
    ["Insurance", formatMoney(Number(mrr.insurance || 0))],
    ["Other Charges", formatMoney(Number(mrr.otherCharges || 0))],
    ["Round Off", formatMoney(Number(mrr.roundOff || 0))],
  ];
  if (hasCgstOrSgst) {
    summaryRows.splice(2, 0, ["CGST", formatMoney(Number(mrr.totalCgst || 0))], ["SGST", formatMoney(Number(mrr.totalSgst || 0))]);
  }
  if (hasIgst) {
    summaryRows.splice(hasCgstOrSgst ? 4 : 2, 0, ["IGST", formatMoney(Number(mrr.totalIgst || 0))]);
  }
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
  doc.text(`Generated on ${formatDisplayDate(new Date().toISOString())}`, 14, Math.min(footerY + 6, 285));

  doc.save(`MRR_${mrr.transactionNo}.pdf`);
}
