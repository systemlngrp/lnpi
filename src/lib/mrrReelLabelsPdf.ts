import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { Company, Material, MaterialIn, MaterialInPackingSlip, Setting, Supplier } from "../types";
import { buildMrrReelLabelData } from "./mrrReelLabelData";

type DownloadMrrReelLabelsPdfArgs = {
  mrr: MaterialIn;
  packingSlips: MaterialInPackingSlip[];
  materials: Material[];
  suppliers: Supplier[];
  companies?: Company[];
  setting?: Setting | null;
  paperSize?: "A4" | "A3";
};

export type DownloadMrrReelLabelsPdfResult = {
  count: number;
  warnings: string[];
};

function safeFileName(value: string) {
  return String(value || "MRR_Reel_Labels")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "MRR_Reel_Labels";
}

function toTitleCase(value: string) {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : "-";
}

function firstNonEmpty(...values: Array<string | number | undefined>) {
  for (const value of values) {
    if (String(value ?? "").trim()) return String(value).trim();
  }
  return "-";
}

function formatWeight(value: number) {
  return Number(value || 0).toFixed(2);
}

function getLogoUrl(setting?: Setting | null) {
  const fileName = String(setting?.organizationLogo || "").trim();
  if (!fileName) return "";
  const encoded = fileName.split("/").map(encodeURIComponent).join("/");
  return new URL(`/uploads/${encoded}`, window.location.origin).toString();
}

async function imageUrlToDataUrl(url: string) {
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

function drawMetaPair(doc: jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(40);
  doc.text(label, x, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(0);
  doc.text(value, x + 16, y);
}

export async function downloadMrrReelLabelsPdf({
  mrr,
  packingSlips,
  materials,
  suppliers,
  companies = [],
  setting = null,
  paperSize = "A4",
}: DownloadMrrReelLabelsPdfArgs): Promise<DownloadMrrReelLabelsPdfResult> {
  const { labels, warnings } = buildMrrReelLabelData({
    mrr,
    packingSlips,
    materials,
    suppliers,
    companies,
  });

  if (labels.length === 0) {
    throw new Error(`No printable reel labels found for ${mrr.transactionNo}.`);
  }

  const isA3 = paperSize === "A3";
  const doc = isA3 ? new jsPDF("l", "mm", "a3") : new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const slotsPerPage = isA3 ? 2 : 1;

  let logoDataUrl = "";
  const logoUrl = getLogoUrl(setting);
  if (logoUrl) {
    try {
      logoDataUrl = await imageUrlToDataUrl(logoUrl);
    } catch (error) {
      console.warn("Unable to load logo for reel label PDF", error);
    }
  }

  const organizationName = firstNonEmpty(setting?.organizationName, "LAXMI NARAYAN GROUP");

  const drawLabel = async (row: (typeof labels)[number], slotX: number, slotY: number, slotW: number, slotH: number) => {
    const margin = Math.min(10, Math.max(6, slotW * 0.045));
    const cardX = slotX + margin;
    const cardY = slotY + margin;
    const cardW = slotW - margin * 2;
    const cardH = slotH - margin * 2;

    doc.setDrawColor(100);
    doc.setLineWidth(0.25);
    doc.rect(cardX, cardY, cardW, cardH);

    let y = cardY + 10;
    if (logoDataUrl) {
      const logoW = Math.min(34, cardW * 0.16);
      const logoH = logoW * 0.53;
      const logoX = cardX + cardW / 2 - logoW / 2;
      doc.addImage(logoDataUrl, "PNG", logoX, y, logoW, logoH, undefined, "FAST");
      y += logoH + 8;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text(toTitleCase(organizationName), cardX + cardW / 2, y, { align: "center" });
    y += 8;

    const rowTop = y;
    drawMetaPair(doc, "Doc", row.docNo, cardX + 20, rowTop);
    drawMetaPair(doc, "Date", row.docDate, cardX + cardW / 2 - 16, rowTop);
    drawMetaPair(doc, "Code", firstNonEmpty(row.code), cardX + cardW - 62, rowTop);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(toTitleCase(row.supplierName), cardX + cardW / 2, y, { align: "center" });
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`,
      cardX + cardW / 2,
      y,
      { align: "center" }
    );
    y += 8;

    doc.setFontSize(10);
    doc.text(`GSM  ${firstNonEmpty(row.gsm)}`, cardX + 36, y);
    doc.text(`R/No.  ${row.reelNo}`, cardX + cardW - 72, y);
    y += 8;
    doc.text(`Weight  ${formatWeight(row.weightKg)}`, cardX + 30, y);
    doc.text(`Supp-Reel  ${firstNonEmpty(row.suppReel)}`, cardX + cardW - 74, y);

    const dividerY = cardY + cardH * 0.53;
    doc.line(cardX, dividerY, cardX + cardW, dividerY);

    const qrDataUrl = await QRCode.toDataURL(row.qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 520,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    const qrSize = Math.min(122, cardW - 40);
    const qrX = cardX + cardW / 2 - qrSize / 2;
    const qrY = dividerY + 14;
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(50);
    doc.text("Scan for Reel", cardX + cardW / 2, cardY + cardH - 8, { align: "center" });
  };

  for (let index = 0; index < labels.length; index += 1) {
    const row = labels[index];
    if (isA3) {
      if (index % slotsPerPage === 0 && index > 0) doc.addPage();
      const slotIndex = index % slotsPerPage;
      const slotW = pageWidth / 2;
      const slotH = pageHeight;
      await drawLabel(row, slotIndex * slotW, 0, slotW, slotH);
    } else {
      if (index > 0) doc.addPage();
      await drawLabel(row, 0, 0, pageWidth, pageHeight);
    }
  }

  const suffix = isA3 ? "A3" : "A4";
  doc.save(`${safeFileName(`MRR_Reel_Labels_${mrr.transactionNo}_${suffix}`)}.pdf`);
  return { count: labels.length, warnings };
}
