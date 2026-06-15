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
  doc.text("GATE PASS", 105, currentY, { align: "center" });
  currentY += 10;

  const details: Array<[string, string]> = [
    ["Gate Pass No", gatePass.gatePassNo || "-"],
    ["Date", formatDate(gatePass.date)],
    ["Invoice No", gatePass.invoiceNo || "-"],
    ["Company", gatePass.companyName || "-"],
    ["Truck", gatePass.truckNo || "-"],
    ["Status", gatePass.status || "Generated"],
    ["Total Qty", Number(gatePass.totalQty || 0).toLocaleString()],
    [
      "Total Amount",
      Number(gatePass.totalAmount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ],
  ];

  details.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? 14 : 110;
    const y = currentY + Math.floor(index / 2) * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 28, y);
  });
  currentY += 30;

  if (Array.isArray(gatePass.loadingSlipNos) && gatePass.loadingSlipNos.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Loading Slips:", 14, currentY);
    doc.setFont("helvetica", "normal");
    const loadingSlipText = gatePass.loadingSlipNos.join(", ");
    const wrappedSlipText = doc.splitTextToSize(loadingSlipText, 150);
    doc.text(wrappedSlipText, 42, currentY);
    currentY += Math.max(6, wrappedSlipText.length * 5 + 2);
  }

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Item Name", "Qty", "Rate", "Amount", "Slip Nos"]],
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
    styles: { fontSize: 9, cellPadding: 2.5, textColor: 0 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      2: { halign: "right", cellWidth: 20 },
      3: { halign: "right", cellWidth: 22 },
      4: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Remarks:", 14, currentY);
  doc.setFont("helvetica", "normal");
  const remarks = String(gatePass.remarks || "-");
  const wrappedRemarks = doc.splitTextToSize(remarks, 170);
  doc.text(wrappedRemarks, 32, currentY);

  const safeGatePassNo = String(gatePass.gatePassNo || "GatePass").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`GatePass_${safeGatePassNo}_${String(gatePass.date || "").slice(0, 10)}.pdf`);
}
