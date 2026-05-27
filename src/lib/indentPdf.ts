import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import { Indent, IndentLine, Material, Setting } from "../types";

export async function getImageDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load logo image.");
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image."));
    reader.readAsDataURL(blob);
  });
}

export function getOrganizationLogoUrl(setting?: Setting | null) {
  if (!setting?.organizationLogo) return "";
  const encoded = setting.organizationLogo.split("/").map(encodeURIComponent).join("/");
  if (typeof window === "undefined") return `/uploads/${encoded}`;
  return new URL(`/uploads/${encoded}`, window.location.origin).toString();
}

export async function downloadIndentPdf({
  indent,
  lines,
  materials,
  setting,
}: {
  indent: Indent;
  lines: IndentLine[];
  materials: Material[];
  setting?: Setting | null;
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = 16;
  const organizationLogoUrl = getOrganizationLogoUrl(setting);

  if (organizationLogoUrl) {
    try {
      const imageDataUrl = await getImageDataUrl(organizationLogoUrl);
      doc.addImage(imageDataUrl, "PNG", 90, currentY, 30, 18, undefined, "FAST");
      currentY += 22;
    } catch (error) {
      console.warn("Organization logo could not be added to indent PDF:", error);
    }
  }

  const organizationName = setting?.organizationName?.trim();
  const organizationAddress = setting?.organizationAddress?.trim();
  const organizationGstDetails = setting?.organizationGstDetails?.trim();

  if (organizationName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(organizationName, 105, currentY, { align: "center" });
    currentY += 7;
  }

  if (organizationAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const addressLines = doc.splitTextToSize(organizationAddress, 160);
    doc.text(addressLines, 105, currentY, { align: "center" });
    currentY += addressLines.length * 5;
  }

  if (organizationGstDetails) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const gstLines = doc.splitTextToSize(organizationGstDetails, 160);
    doc.text(gstLines, 105, currentY, { align: "center" });
    currentY += gstLines.length * 5;
  }

  currentY += 4;
  doc.setDrawColor(0);
  doc.line(14, currentY, 196, currentY);
  currentY += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("INDENT", 105, currentY, { align: "center" });
  currentY += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const detailRows = [
    ["Requested By", indent.requestedBy],
    ["Requisition Date", formatDate(indent.requisitionDate)],
    ["Indent Type", indent.indentType],
    ["Status", indent.status],
  ];

  detailRows.forEach(([label, value], index) => {
    const columnX = index % 2 === 0 ? 14 : 110;
    const rowY = currentY + Math.floor(index / 2) * 8;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, columnX, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), columnX + 28, rowY);
  });
  currentY += 24;

  const lineTableRows = lines.map((line, index) => {
    const material = materials.find((row) => row.id === line.materialId);
    return [
      index + 1,
      line.erpCode || "",
      material?.name || "Unknown Material",
      line.uom || material?.uom || "",
      Number(line.qty || 0).toLocaleString(),
    ];
  });

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "ERP", "Material Name", "Unit", "Quantity"]],
    body: lineTableRows,
    theme: "grid",
    headStyles: { fillColor: [79, 70, 229] },
    styles: { fontSize: 9, cellPadding: 2.5, textColor: 0 },
    columnStyles: {
      0: { halign: "center", cellWidth: 14 },
      1: { cellWidth: 28 },
      2: { cellWidth: 92 },
      3: { halign: "center", cellWidth: 20 },
      4: { halign: "right", cellWidth: 28 },
    },
  });

  let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
  if (indent.rejectedRemarks) {
    doc.setFont("helvetica", "bold");
    doc.text("Rejected Remarks:", 14, footerY);
    doc.setFont("helvetica", "normal");
    const remarkLines = doc.splitTextToSize(indent.rejectedRemarks, 175);
    doc.text(remarkLines, 14, footerY + 5);
    footerY += remarkLines.length * 5 + 8;
  }

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Generated on ${formatDate(new Date().toISOString())}`, 14, Math.min(footerY, 285));

  const safeRequestedBy = indent.requestedBy.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "Indent";
  doc.save(`Indent_${safeRequestedBy}_${indent.requisitionDate}.pdf`);
}
