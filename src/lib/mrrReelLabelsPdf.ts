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
  qrPayloadByPackingSlipId?: Record<string, string>;
  weightKgByPackingSlipId?: Record<string, number>;
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
  qrPayloadByPackingSlipId = {},
  weightKgByPackingSlipId = {},
}: DownloadMrrReelLabelsPdfArgs): Promise<DownloadMrrReelLabelsPdfResult> {
  const { labels, warnings } = buildMrrReelLabelData({
    mrr,
    packingSlips,
    materials,
    suppliers,
    companies,
    qrPayloadByPackingSlipId,
    weightKgByPackingSlipId,
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
    const upperH = cardH * 0.4;
    const lowerY = upperY + upperH;
    const lowerH = cardH - upperH;

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

    const orgTitle = toTitleCase(organizationName);
    let titleFontSize = titleSize;
    let titleCharSpace = orgTitle.length > 24 ? 0.2 : 0.5;
    const titleMaxWidth = contentW - 4;

    const titleWidth = (fontSize: number, charSpace: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fontSize);
      const baseWidth = doc.getTextWidth(orgTitle);
      const spacingWidth = Math.max(0, orgTitle.length - 1) * charSpace * 0.3528;
      return baseWidth + spacingWidth;
    };

    while (titleFontSize > 18 && titleWidth(titleFontSize, titleCharSpace) > titleMaxWidth) {
      titleFontSize -= 1;
      if (titleFontSize <= 24) titleCharSpace = 0;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleFontSize);
    doc.setTextColor(0);
    doc.setCharSpace(titleCharSpace);
    doc.text(orgTitle, cardX + cardW / 2, yTop + lh(titleFontSize, 0.9), { align: "center" });
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

    const frameW = cardW * 0.985;
    const frameH = lowerH * 0.965;
    const frameX = cardX + (cardW - frameW) / 2;
    const frameY = lowerY + (lowerH - frameH) / 2;
    const pad = 1;
    const captionSize = 10;
    const captionH = lh(captionSize, 1.04);
    const availW = frameW - pad * 2;
    const availH = frameH - pad * 2;
    const qrZoneH = availH - captionH - 0.1;
    const qrMax = Math.min(availW, qrZoneH);
    const qrSize = Math.max(10, qrMax * 0.995);
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

    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.rect(cardX, cardY, cardW, cardH);

    const contentX = cardX + 10;
    const contentY = cardY + 10;
    const contentW = cardW - 20;

    const logoW = Math.min(42, contentW * 0.2);
    const logoH = logoW * 0.53;
    const titleX = contentX + logoW + 8;
    const titleW = contentW - logoW - 8;

    let y = contentY;

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", contentX, y, logoW, logoH, undefined, "FAST");
    }

    const orgTitle = toTitleCase(organizationName);
    let titleFontSize = 22;
    const titleMaxWidth = titleW;
    doc.setFont("helvetica", "bold");
    while (titleFontSize > 13) {
      doc.setFontSize(titleFontSize);
      if (doc.getTextWidth(orgTitle) <= titleMaxWidth) break;
      titleFontSize -= 1;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleFontSize);
    doc.setTextColor(0);
    doc.text(orgTitle, titleX + titleW / 2, y + logoH * 0.62, { align: "center" });

    y += Math.max(logoH, 12) + 7;

    const infoSize = 12;
    const infoCols = 3;
    const infoColW = contentW / infoCols;
    const infoLabelW = 10;
    const infoY = y;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(infoSize);
    doc.setTextColor(70);
    ["Doc", "Date", "Code"].forEach((label, i) => {
      const colX = contentX + i * infoColW;
      doc.text(`${label}:`, colX, infoY);
    });

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    const infoVals = [row.docNo, row.docDate, firstNonEmpty(row.code)];
    infoVals.forEach((value, i) => {
      const colX = contentX + i * infoColW;
      const clipped = clipSingleLine(doc, value, infoColW - infoLabelW - 1);
      doc.text(clipped, colX + infoLabelW, infoY);
    });

    y += 9;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    const supplierLines = doc.splitTextToSize(toTitleCase(row.supplierName), contentW - 6).slice(0, 2);
    doc.text(supplierLines, cardX + cardW / 2, y, { align: "center" });
    y += supplierLines.length * 7.2;

    const specText = `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    const specLines = doc.splitTextToSize(specText, contentW - 6).slice(0, 2);
    doc.text(specLines, cardX + cardW / 2, y, { align: "center" });
    y += specLines.length * 5.8 + 6;

    const bodyTopY = y;
    const qrAreaW = contentW * 0.45;
    const leftAreaW = contentW - qrAreaW - 10;
    const qrAreaX = contentX + leftAreaW + 10;
    const qrAreaH = Math.max(100, cardY + cardH - bodyTopY - 14);

    const detailFont = 16;
    const rowGap = 11;
    const labelW = 36;
    const detailStartY = bodyTopY + 2;

    const drawDetail = (label: string, value: string, rowIndex: number) => {
      const textY = detailStartY + rowIndex * rowGap;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(detailFont);
      doc.setTextColor(45);
      doc.text(`${label}:`, contentX, textY);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      const maxW = leftAreaW - labelW - 2;
      const clipped = clipSingleLine(doc, value, maxW);
      doc.text(clipped, contentX + labelW, textY);
    };

    drawDetail("GSM.", firstNonEmpty(row.gsm), 0);
    drawDetail("R/NO.", row.reelNo, 1);
    drawDetail("Weight.", formatWeight(row.weightKg), 2);
    drawDetail("Supp-Reel.", firstNonEmpty(row.suppReel), 3);

    const qrAvailW = qrAreaW;
    const qrAvailH = qrAreaH;
    const qrSize = Math.max(36, Math.min(qrAvailW, qrAvailH));
    const qrX = qrAreaX + (qrAreaW - qrSize) / 2;
    const qrY = bodyTopY + (qrAreaH - qrSize) / 2;

    try {
      const qrDataUrl = await QRCode.toDataURL(row.qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 1000,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

    } catch (error) {
      console.warn("QR generation failed", error);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(120, 0, 0);
      doc.text("QR Not Available", qrAreaX + qrAreaW / 2, bodyTopY + qrAreaH / 2, { align: "center" });
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
