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

function getPageSize(doc: jsPDF) {
  return {
    width: doc.internal.pageSize.getWidth(),
    height: doc.internal.pageSize.getHeight(),
  };
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
  const doc = new jsPDF("l", "mm", "a4");
  const pageSize = getPageSize(doc);
  const margin = { left: 14, right: 14, top: 14, bottom: 14 };
  const printableWidth = pageSize.width - margin.left - margin.right;
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MATERIAL RECEIPT", pageSize.width / 2, currentY, { align: "center" });
  currentY += 8;

  const supplier = suppliers.find((s) => s.id === mrr.supplierId);
  const company = companies?.find((entry) => entry.id === mrr.supplierId);
  const supplierLabel = supplier?.name || company?.name || mrr.supplierId;
  const hasIgst = Number(mrr.totalIgst || 0) > 0;
  const hasCgstOrSgst = Number(mrr.totalCgst || 0) > 0 || Number(mrr.totalSgst || 0) > 0;

  const metadataRows: Array<[string, string]> = [
    ["MRR No", mrr.transactionNo],
    ["MRR Date", formatDisplayDate(mrr.date)],
    ["Gate Entry No", mrr.gateEntryNo || "-"],
    ["Supplier / Customer", supplierLabel],
    ["Invoice No", mrr.invoiceNo || "-"],
    ["Invoice Date", formatDisplayDate(mrr.invDate)],
    ["Status", mrr.status || "-"],
    ["MRR Type", mrr.mrrType || "Others"],
    ["Invoice Currency", mrr.invoiceCurrency || "INR"],
    ["Exchange Rate", mrr.invoiceCurrency === "USD" ? Number(mrr.exchangeRate || 0).toFixed(4) : "-"],
  ];

  const metadataWidth = Math.min(190, printableWidth);
  const metadataLabelWidth = 42;
  const metadataLeft = (pageSize.width - metadataWidth) / 2;

  autoTable(doc, {
    startY: currentY,
    body: metadataRows,
    theme: "grid",
    styles: {
      fontSize: 9.5,
      cellPadding: { top: 2.6, right: 3, bottom: 2.6, left: 3 },
      textColor: 0,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
      overflow: "linebreak",
    },
    margin: { left: metadataLeft, right: metadataLeft },
    columnStyles: {
      0: { cellWidth: metadataLabelWidth, fontStyle: "bold", fillColor: [247, 248, 251] },
      1: { cellWidth: metadataWidth - metadataLabelWidth },
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
      materials.find((material) => material.id === line.itemId)?.name ||
      npdItems.find((item) => item.id === line.itemId)?.name ||
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

  const taxColumnCount = (hasCgstOrSgst ? 2 : 0) + (hasIgst ? 1 : 0);
  const compactColumnWidths = {
    sl: 8,
    poNo: 22,
    uom: 12,
    qty: 18,
    rate: 16,
    gst: 12,
    tax: 15,
    value: 20,
  };
  const fixedLineTableWidth =
    compactColumnWidths.sl +
    compactColumnWidths.poNo +
    compactColumnWidths.uom +
    compactColumnWidths.qty * 2 +
    compactColumnWidths.rate +
    compactColumnWidths.gst +
    compactColumnWidths.tax * taxColumnCount +
    compactColumnWidths.value * 2;
  const itemColumnWidth = Math.max(54, printableWidth - fixedLineTableWidth);

  const columnStyles: Record<number, any> = {
    0: { halign: "center", cellWidth: compactColumnWidths.sl },
    1: { cellWidth: itemColumnWidth },
    2: { cellWidth: compactColumnWidths.poNo },
    3: { halign: "center", cellWidth: compactColumnWidths.uom },
    4: { halign: "right", cellWidth: compactColumnWidths.qty },
    5: { halign: "right", cellWidth: compactColumnWidths.qty },
    6: { halign: "right", cellWidth: compactColumnWidths.rate },
    7: { halign: "right", cellWidth: compactColumnWidths.gst },
  };

  let columnIndex = 8;
  if (hasCgstOrSgst) {
    columnStyles[columnIndex] = { halign: "right", cellWidth: compactColumnWidths.tax };
    columnStyles[columnIndex + 1] = { halign: "right", cellWidth: compactColumnWidths.tax };
    columnIndex += 2;
  }
  if (hasIgst) {
    columnStyles[columnIndex] = { halign: "right", cellWidth: compactColumnWidths.tax };
    columnIndex += 1;
  }
  columnStyles[columnIndex] = { halign: "right", cellWidth: compactColumnWidths.value };
  columnStyles[columnIndex + 1] = { halign: "right", cellWidth: compactColumnWidths.value };

  autoTable(doc, {
    startY: currentY,
    head: [lineTableHead],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [43, 63, 100], textColor: 255, fontStyle: "bold", fontSize: 6.7, cellPadding: 1.5 },
    bodyStyles: { lineColor: [170, 170, 170], lineWidth: 0.15 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 7.6, cellPadding: 1.8, textColor: 0, valign: "middle", overflow: "linebreak" },
    columnStyles,
    margin,
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
  const summaryRows: Array<[string, string]> = [
    ["Invoice Value", formatMoney(Number(mrr.totalInvoiceValue || 0))],
    ["Actual Value", formatMoney(Number(mrr.totalActualValue || 0))],
    ["Invoice After GST", formatMoney(Number(mrr.totalInvoiceValueAfterGst || 0))],
    ["Insurance", formatMoney(Number(mrr.insurance || 0))],
    ["Other Charges", formatMoney(Number(mrr.otherCharges || 0))],
    ["Expense CGST", formatMoney(Number(mrr.expenseCGST || 0))],
    ["Expense SGST", formatMoney(Number(mrr.expenseSGST || 0))],
    ["Expense IGST", formatMoney(Number(mrr.expenseIGST || 0))],
    ["Round Off", formatMoney(Number(mrr.roundOff || 0))],
  ];
  if (hasCgstOrSgst) {
    summaryRows.splice(2, 0, ["CGST", formatMoney(Number(mrr.totalCgst || 0))], ["SGST", formatMoney(Number(mrr.totalSgst || 0))]);
  }
  if (hasIgst) {
    summaryRows.splice(hasCgstOrSgst ? 4 : 2, 0, ["IGST", formatMoney(Number(mrr.totalIgst || 0))]);
  }

  const summaryBoxWidth = 90;
  const summaryBoxHeight = 16 + summaryRows.length * 6 + 10;
  if (footerY + summaryBoxHeight + 18 > pageSize.height - margin.bottom) {
    doc.addPage();
    footerY = margin.top;
  }
  const summaryBoxX = pageSize.width - margin.right - summaryBoxWidth;
  const summaryBoxY = footerY;

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
    const remarks: Array<[string, string]> = [];
    if (mrr.plant_head_remark) remarks.push(["PH", mrr.plant_head_remark]);
    if (mrr.accounts_remark) remarks.push(["Accounts", mrr.accounts_remark]);
    if (mrr.md_approval_remark) remarks.push(["MD", mrr.md_approval_remark]);

    doc.setFontSize(9);
    const remarkLines = remarks.flatMap(([label, value]) => doc.splitTextToSize(`${label}: ${value}`, printableWidth));
    const remarkBlockHeight = 6 + remarkLines.length * 5;
    if (footerY + remarkBlockHeight > pageSize.height - margin.bottom) {
      doc.addPage();
      footerY = margin.top;
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Approval Remarks:", margin.left, footerY);
    footerY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    remarks.forEach(([label, value]) => {
      const lines = doc.splitTextToSize(`${label}: ${value}`, printableWidth);
      lines.forEach((line: string) => {
        if (footerY + 5 > pageSize.height - margin.bottom) {
          doc.addPage();
          footerY = margin.top;
        }
        doc.text(line, margin.left, footerY);
        footerY += 5;
      });
    });
  }

  if (footerY + 8 > pageSize.height - margin.bottom) {
    doc.addPage();
    footerY = margin.top;
  }

  const generatedText = `Generated on ${formatDisplayDate(new Date().toISOString())}`;
  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(`Page ${pageNumber} of ${pageCount}`, pageSize.width - margin.right, pageSize.height - 7, { align: "right" });
    if (pageNumber === pageCount) {
      doc.text(generatedText, margin.left, footerY + 6);
    }
  }

  doc.save(`MRR_${mrr.transactionNo}.pdf`);
}
