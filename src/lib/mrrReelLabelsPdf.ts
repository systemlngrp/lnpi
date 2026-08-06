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

function clipSingleLine(doc: jsPDF, value: string, maxWidth: number) {
  const text = String(value || "-").trim() || "-";
  if (doc.getTextWidth(text) <= maxWidth) return text;
  const ellipsis = "...";
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}${ellipsis}`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}${ellipsis}`;
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
  doc.setFontSize(9.8);
  doc.setTextColor(40);
  doc.text(label, x, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.8);
  doc.setTextColor(0);
  doc.text(value, x + 18, y);
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
  const doc = isA3 ? new jsPDF("p", "mm", "a3") : new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const slotsPerPage = 1;

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

  const drawLabelA4 = async (row: (typeof labels)[number], slotX: number, slotY: number, slotW: number, slotH: number) => {
    const pageMargin = 10;
    const cardX = slotX + pageMargin;
    const cardY = slotY + pageMargin;
    const cardW = slotW - pageMargin * 2;
    const cardH = slotH - pageMargin * 2;

    const upperY = cardY;
    const upperH = cardH / 2;
    const lowerY = upperY + upperH;
    const lowerH = upperH;

    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.rect(cardX, cardY, cardW, cardH);
    doc.line(cardX, lowerY, cardX + cardW, lowerY);

    const contentW = Math.min(200, cardW - 10);
    const contentX = cardX + (cardW - contentW) / 2;

    const logoW = Math.min(53, contentW * 0.62);
    const logoH = logoW * 0.34;
    const titleSize = 30;
    const detailsSize = 15;
    const supplierSize = 22;
    const specSize = 16;
    const gridSize = 14;

    const lh = (pt: number, ratio = 1.16) => pt * 0.3528 * ratio;

    const supplierText = toTitleCase(row.supplierName);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(supplierSize);
    const supplierLines = doc.splitTextToSize(supplierText, contentW - 6).slice(0, 2);

    const specText = `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`;

    const blockH =
      (logoDataUrl ? logoH + 4 : 0) +
      lh(titleSize) +
      4 +
      lh(detailsSize) +
      3 +
      supplierLines.length * lh(supplierSize, 1.06) +
      3 +
      lh(specSize, 1.05) +
      4 +
      lh(gridSize, 1.08) +
      2 +
      lh(gridSize, 1.08);

    let yTop = upperY + (upperH - blockH) / 2;
    yTop = Math.max(upperY + 4, yTop);

    if (logoDataUrl) {
      const logoX = cardX + cardW / 2 - logoW / 2;
      doc.addImage(logoDataUrl, "PNG", logoX, yTop, logoW, logoH, undefined, "FAST");
      yTop += logoH + 4;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    doc.setTextColor(0);
    doc.setCharSpace(0.5);
    doc.text(toTitleCase(organizationName), cardX + cardW / 2, yTop + lh(titleSize, 0.9), { align: "center" });
    doc.setCharSpace(0);
    yTop += lh(titleSize) + 4;

    const detailsY = yTop + lh(detailsSize, 0.85);
    const colW = contentW / 3;
    const labelW = 13;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(detailsSize);
    doc.setTextColor(75);
    ["Doc", "Date", "Code"].forEach((label, i) => {
      const baseX = contentX + i * colW;
      doc.text(`${label}`, baseX + labelW, detailsY, { align: "right" });
    });

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    const detailsValues = [row.docNo, row.docDate, firstNonEmpty(row.code)];
    detailsValues.forEach((value, i) => {
      const baseX = contentX + i * colW;
      const valueText = clipSingleLine(doc, value, colW - labelW - 2);
      doc.text(valueText, baseX + labelW + 2, detailsY, { align: "left" });
    });
    yTop += lh(detailsSize) + 3;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(supplierSize);
    doc.setTextColor(0);
    const supplierY = yTop + lh(supplierSize, 0.8);
    doc.text(supplierLines, cardX + cardW / 2, supplierY, { align: "center" });
    yTop += supplierLines.length * lh(supplierSize, 1.06) + 3;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(specSize);
    const specY = yTop + lh(specSize, 0.82);
    doc.text(specText, cardX + cardW / 2, specY, { align: "center" });
    yTop += lh(specSize) + 4;

    const groupW = contentW / 2;
    const gridLabelW = groupW * 0.38;
    const row1Y = yTop + lh(gridSize, 0.85);
    const row2Y = row1Y + lh(gridSize, 1.08) + 2;

    const drawGridPair = (x: number, y: number, label: string, value: string, maxW: number) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(gridSize);
      doc.setTextColor(75);
      doc.text(label, x + gridLabelW - 1, y, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      const clipped = clipSingleLine(doc, value, maxW);
      doc.text(clipped, x + gridLabelW + 1, y, { align: "left" });
    };

    drawGridPair(contentX, row1Y, "GSM", firstNonEmpty(row.gsm), groupW - gridLabelW - 2);
    drawGridPair(contentX + groupW, row1Y, "R/No.", row.reelNo, groupW - gridLabelW - 2);
    drawGridPair(contentX, row2Y, "Weight", formatWeight(row.weightKg), groupW - gridLabelW - 2);
    drawGridPair(contentX + groupW, row2Y, "Supp-Reel", firstNonEmpty(row.suppReel), groupW - gridLabelW - 2);

    const frameW = Math.min(130, cardW * 0.9);
    const frameH = lowerH * 0.9;
    const frameX = cardX + (cardW - frameW) / 2;
    const frameY = lowerY + (lowerH - frameH) / 2;
    const pad = 2.65;
    const captionSize = 12;
    const captionH = lh(captionSize, 1.04);
    const availW = frameW - pad * 2;
    const availH = frameH - pad * 2;
    const qrZoneH = availH - captionH - 1;
    const qrSize = Math.max(10, Math.min(availW * 0.78, availW, qrZoneH));
    const qrX = frameX + pad + (availW - qrSize) / 2;
    const qrY = frameY + pad + Math.max(0, (qrZoneH - qrSize) / 2);
    const captionY = frameY + frameH - pad;

    try {
      const qrDataUrl = await QRCode.toDataURL(row.qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 900,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(captionSize);
      doc.setTextColor(95);
      doc.text("Scan for Reel", cardX + cardW / 2, captionY, { align: "center" });
    } catch (error) {
      console.warn("QR generation failed", error);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(120, 0, 0);
      doc.text("QR Not Available", cardX + cardW / 2, lowerY + lowerH / 2, { align: "center" });
    }
  };

  const drawLabelA3 = async (row: (typeof labels)[number], slotX: number, slotY: number, slotW: number, slotH: number) => {
    const pageMargin = 12;
    const cardX = slotX + pageMargin;
    const cardY = slotY + pageMargin;
    const cardW = slotW - pageMargin * 2;
    const cardH = slotH - pageMargin * 2;

    const upperY = cardY;
    const upperH = cardH / 2;
    const lowerY = upperY + upperH;
    const lowerH = upperH;

    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.rect(cardX, cardY, cardW, cardH);
    doc.line(cardX, lowerY, cardX + cardW, lowerY);

    const contentW = cardW - 20;
    const contentX = cardX + (cardW - contentW) / 2;

    const logoW = Math.min(84, contentW * 0.66);
    const logoH = logoW * 0.34;

    const titleSize = 46;
    const docInfoSize = 22;
    const supplierSize = 34;
    const specSize = 24;
    const gridSize = 26;
    const captionSize = 19;
    const qrFallbackSize = 22;

    const lineH = (pt: number, ratio = 1.16) => pt * 0.3528 * ratio;

    const supplierText = toTitleCase(row.supplierName);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(supplierSize);
    const supplierLines = doc.splitTextToSize(supplierText, contentW - 8).slice(0, 3);

    const specText = `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`;
    const hasSpec = Boolean(String(firstNonEmpty(row.sizeCm, row.gsm, row.bf)).trim() && firstNonEmpty(row.sizeCm, row.gsm, row.bf) !== "-");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(specSize);
    const specLines = hasSpec ? doc.splitTextToSize(specText, contentW - 8).slice(0, 2) : [];

    const detailRowGap = 3;
    const blockH =
      (logoDataUrl ? logoH + 6 : 0) +
      lineH(titleSize) +
      6 +
      lineH(docInfoSize) +
      6 +
      supplierLines.length * lineH(supplierSize, 1.06) +
      (specLines.length > 0 ? 5 + specLines.length * lineH(specSize, 1.06) : 0) +
      7 +
      lineH(gridSize, 1.06) +
      detailRowGap +
      lineH(gridSize, 1.06);

    let yTop = upperY + (upperH - blockH) / 2;
    yTop = Math.max(upperY + 6, yTop);

    if (logoDataUrl) {
      const logoX = cardX + cardW / 2 - logoW / 2;
      doc.addImage(logoDataUrl, "PNG", logoX, yTop, logoW, logoH, undefined, "FAST");
      yTop += logoH + 6;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleSize);
    doc.setTextColor(0);
    doc.setCharSpace(0.8);
    doc.text(toTitleCase(organizationName), cardX + cardW / 2, yTop + lineH(titleSize, 0.88), { align: "center" });
    doc.setCharSpace(0);
    yTop += lineH(titleSize) + 6;

    const detailsY = yTop + lineH(docInfoSize, 0.84);
    const colW = contentW / 3;
    const labelW = 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(docInfoSize);
    doc.setTextColor(85);
    ["Doc", "Date", "Code"].forEach((label, i) => {
      const baseX = contentX + i * colW;
      doc.text(label, baseX + labelW, detailsY, { align: "right" });
    });

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    const detailsValues = [row.docNo, row.docDate, firstNonEmpty(row.code)];
    detailsValues.forEach((value, i) => {
      const baseX = contentX + i * colW;
      const valueText = clipSingleLine(doc, value, colW - labelW - 3);
      doc.text(valueText, baseX + labelW + 3, detailsY, { align: "left" });
    });
    yTop += lineH(docInfoSize) + 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(supplierSize);
    doc.setTextColor(0);
    const supplierY = yTop + lineH(supplierSize, 0.82);
    doc.text(supplierLines, cardX + cardW / 2, supplierY, { align: "center" });
    yTop += supplierLines.length * lineH(supplierSize, 1.06);

    if (specLines.length > 0) {
      yTop += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(specSize);
      doc.setTextColor(0);
      const specY = yTop + lineH(specSize, 0.84);
      doc.text(specLines, cardX + cardW / 2, specY, { align: "center" });
      yTop += specLines.length * lineH(specSize, 1.06);
    }

    yTop += 7;
    const groupW = contentW / 2;
    const gridLabelW = groupW * 0.36;
    const row1Y = yTop + lineH(gridSize, 0.84);
    const row2Y = row1Y + lineH(gridSize, 1.06) + detailRowGap;

    const drawGridPair = (x: number, y: number, label: string, value: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(gridSize);
      doc.setTextColor(85);
      doc.text(label, x + gridLabelW, y, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      const clipped = clipSingleLine(doc, value, groupW - gridLabelW - 4);
      doc.text(clipped, x + gridLabelW + 2, y, { align: "left" });
    };

    drawGridPair(contentX, row1Y, "GSM", firstNonEmpty(row.gsm));
    drawGridPair(contentX + groupW, row1Y, "R/No.", row.reelNo);
    drawGridPair(contentX, row2Y, "Weight", formatWeight(row.weightKg));
    drawGridPair(contentX + groupW, row2Y, "Supp-Reel", firstNonEmpty(row.suppReel));

    const qrFrameW = Math.min(210, cardW * 0.88);
    const qrFrameH = Math.min(180, lowerH * 0.86);
    const qrFrameX = cardX + (cardW - qrFrameW) / 2;
    const qrFrameY = lowerY + (lowerH - qrFrameH) / 2;
    const framePad = 4.2;
    const captionGap = 4;
    const captionH = lineH(captionSize, 1.04);
    const availW = qrFrameW - framePad * 2;
    const availH = qrFrameH - framePad * 2;
    const qrZoneH = availH - captionH - captionGap;
    const qrSize = Math.max(12, Math.min(availW, qrZoneH, lowerH * 0.76));
    const qrX = qrFrameX + framePad + (availW - qrSize) / 2;
    const qrY = qrFrameY + framePad + Math.max(0, (qrZoneH - qrSize) / 2);
    const captionY = qrFrameY + qrFrameH - framePad;

    try {
      const qrDataUrl = await QRCode.toDataURL(row.qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 1200,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(captionSize);
      doc.setTextColor(90);
      doc.text("Scan for Reel", cardX + cardW / 2, captionY, { align: "center" });
    } catch (error) {
      console.warn("QR generation failed", error);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(qrFallbackSize);
      doc.setTextColor(120, 0, 0);
      doc.text("QR Not Available", cardX + cardW / 2, lowerY + lowerH / 2, { align: "center" });
    }
  };

  for (let index = 0; index < labels.length; index += 1) {
    const row = labels[index];
    if (isA3) {
      if (index % slotsPerPage === 0 && index > 0) doc.addPage();
      await drawLabelA3(row, 0, 0, pageWidth, pageHeight);
    } else {
      if (index > 0) doc.addPage();
      await drawLabelA4(row, 0, 0, pageWidth, pageHeight);
    }
  }

  const suffix = isA3 ? "A3" : "A4";
  doc.save(`${safeFileName(`MRR_Reel_Labels_${mrr.transactionNo}_${suffix}`)}.pdf`);
  return { count: labels.length, warnings };
}
