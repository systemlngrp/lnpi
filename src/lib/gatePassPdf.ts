import jsPDF from "jspdf";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { GatePass, Setting } from "../types";
import { formatDate } from "./serial";
import { renderOrganizationHeader } from "./pdfOrganizationHeader";

export async function downloadGatePassPdf({
  gatePass,
  setting,
}: {
  gatePass: GatePass;
  setting?: Setting | null;
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = (await renderOrganizationHeader(doc, setting)).currentY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("NON RETURNABLE GATE PASS", 105, currentY, { align: "center" });
  currentY += 9;

  const details: Array<[string, string]> = [
    ["Gate Pass No", gatePass.gatePassNo || "-"],
    ["Date", formatDate(gatePass.date)],
    ["Invoice No", gatePass.invoiceNo || "-"],
    ["Company", gatePass.companyName || "-"],
    ["Truck", gatePass.truckNo || "-"],
    ["Total Qty", Number(gatePass.totalQty || 0).toLocaleString()],
    [
      "Total Invoice Amount",
      Number(gatePass.totalAmount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    body: [
      [details[0][0], details[0][1], details[1][0], details[1][1]],
      [details[2][0], details[2][1], details[3][0], details[3][1]],
      [details[4][0], details[4][1], details[5][0], details[5][1]],
    ],
    theme: "plain",
    styles: {
      fontSize: 8.6,
      cellPadding: { top: 1.4, right: 1.5, bottom: 1.4, left: 1.5 },
      textColor: 0,
      lineColor: 255,
      lineWidth: 0,
      overflow: "linebreak",
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold" },
      1: { cellWidth: 54 },
      2: { cellWidth: 28, fontStyle: "bold" },
      3: { cellWidth: 58 },
    },
    didParseCell: (hookData) => {
      if (hookData.column.index === 0 || hookData.column.index === 2) {
        hookData.cell.text = [`${hookData.cell.raw || ""}:`];
      }
    },
    margin: { left: 14, right: 14 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 4;

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "Qty", "Rate", "Amount", "Loading Slip Nos"]],
    body: gatePass.lines.map((line, index) => [
      index + 1,
      line.itemName || "Unknown",
      Number(line.qty || 0).toLocaleString(),
      Number(line.rate || 0).toFixed(2),
      Number(line.amount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      Array.isArray(line.loadingSlipNos) ? line.loadingSlipNos.join(", ") : "-",
    ]),
    theme: "grid",
    styles: { fontSize: 8.2, cellPadding: 2.2, textColor: 0, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      1: { cellWidth: 68 },
      2: { halign: "right", cellWidth: 20 },
      3: { halign: "right", cellWidth: 22 },
      4: { halign: "right", cellWidth: 28, fontStyle: "bold" },
      5: { cellWidth: 40 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Remarks:", 14, currentY);
  doc.setFont("helvetica", "normal");
  const remarks = String(gatePass.remarks || "-");
  const wrappedRemarks = doc.splitTextToSize(remarks, 168);
  doc.text(wrappedRemarks, 30, currentY);

  const safeGatePassNo = String(gatePass.gatePassNo || "GatePass").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`GatePass_${safeGatePassNo}_${String(gatePass.date || "").slice(0, 10)}.pdf`);
}
