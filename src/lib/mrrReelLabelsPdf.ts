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

  const drawLabelA4 = async (row: (typeof labels)[number], slotX: number, slotY: number, slotW: number, slotH: number) => {
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
      y += logoH + 10;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(0);
    doc.text(toTitleCase(organizationName), cardX + cardW / 2, y, { align: "center" });
    y += 10;

    const rowTop = y;
    drawMetaPair(doc, "Doc", row.docNo, cardX + 20, rowTop);
    drawMetaPair(doc, "Date", row.docDate, cardX + cardW / 2 - 16, rowTop);
    drawMetaPair(doc, "Code", firstNonEmpty(row.code), cardX + cardW - 62, rowTop);
    y += 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(toTitleCase(row.supplierName), cardX + cardW / 2, y, { align: "center" });
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(
      `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`,
      cardX + cardW / 2,
      y,
      { align: "center" }
    );
    y += 11;

    doc.setFontSize(12);
    doc.text(`GSM  ${firstNonEmpty(row.gsm)}`, cardX + 28, y);
    doc.text(`R/No.  ${row.reelNo}`, cardX + cardW - 80, y);
    y += 10;
    doc.text(`Weight  ${formatWeight(row.weightKg)}`, cardX + 22, y);
    doc.text(`Supp-Reel  ${firstNonEmpty(row.suppReel)}`, cardX + cardW - 86, y);

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
    doc.setFontSize(12);
    doc.setTextColor(50);
    doc.text("Scan for Reel", cardX + cardW / 2, cardY + cardH - 8, { align: "center" });
  };

  const drawLabelA3 = async (row: (typeof labels)[number], slotX: number, slotY: number, slotW: number, slotH: number) => {
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
      const logoW = Math.min(30, cardW * 0.14);
      const logoH = logoW * 0.53;
      const logoX = cardX + cardW / 2 - logoW / 2;
      doc.addImage(logoDataUrl, "PNG", logoX, y, logoW, logoH, undefined, "FAST");
      y += logoH + 6;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(0);
    doc.text(toTitleCase(organizationName), cardX + cardW / 2, y, { align: "center" });
    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`Doc: ${row.docNo}`, cardX + 8, y);
    doc.text(`Date: ${row.docDate}`, cardX + cardW / 2 - 10, y);
    doc.text(`Code: ${firstNonEmpty(row.code)}`, cardX + cardW - 60, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    const supplierLines = doc.splitTextToSize(toTitleCase(row.supplierName), cardW - 16).slice(0, 2);
    doc.text(supplierLines, cardX + cardW / 2, y, { align: "center" });
    y += supplierLines.length * 4.6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.text(
      `Size: ${firstNonEmpty(row.sizeCm)} CM X GSM: ${firstNonEmpty(row.gsm)} X BF: ${firstNonEmpty(row.bf)}`,
      cardX + 8,
      y
    );
    y += 8;

    const qrSize = Math.min(46, cardW * 0.35, cardH * 0.45);
    const qrX = cardX + cardW - qrSize - 10;
    const qrY = y - 2;

    doc.setFontSize(11);
    doc.text(`GSM.: ${firstNonEmpty(row.gsm)}`, cardX + 8, y + 2);
    doc.text(`R/NO.: ${row.reelNo}`, cardX + 8, y + 8.5);
    doc.text(`Weight.: ${formatWeight(row.weightKg)}`, cardX + 8, y + 15);
    doc.text(`Supp-Reel.: ${firstNonEmpty(row.suppReel)}`, cardX + 8, y + 21.5);

    const qrDataUrl = await QRCode.toDataURL(row.qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 420,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");
  };

  for (let index = 0; index < labels.length; index += 1) {
    const row = labels[index];
    if (isA3) {
      if (index % slotsPerPage === 0 && index > 0) doc.addPage();
      const slotIndex = index % slotsPerPage;
      const slotW = pageWidth / 2;
      const slotH = pageHeight;
      await drawLabelA3(row, slotIndex * slotW, 0, slotW, slotH);
    } else {
      if (index > 0) doc.addPage();
      await drawLabelA4(row, 0, 0, pageWidth, pageHeight);
    }
  }

  const suffix = isA3 ? "A3" : "A4";
  doc.save(`${safeFileName(`MRR_Reel_Labels_${mrr.transactionNo}_${suffix}`)}.pdf`);
  return { count: labels.length, warnings };
}
