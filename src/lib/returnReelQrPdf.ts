import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { Setting } from "../types";

type ReturnReelQrPdfArgs = {
  returnNo: string;
  date: string;
  jobNo?: string;
  materialName?: string;
  materialCode?: string | number;
  specs?: string;
  reelNo: string;
  weight: number;
  setting?: Setting | null;
};

function safeFileName(value: string) {
  return String(value || "Return_Reel_QR")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "Return_Reel_QR";
}

function firstNonEmpty(...values: Array<string | number | undefined | null>) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "-";
}

function toUpper(value: string | number | undefined | null) {
  return firstNonEmpty(value).toUpperCase();
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
}

function formatWeight(value: number) {
  return Number(value || 0).toFixed(2);
}

function clipSingleLine(doc: jsPDF, value: string | number | undefined | null, maxWidth: number) {
  const text = firstNonEmpty(value);
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

export async function downloadReturnReelQrPdf({
  returnNo,
  date,
  jobNo,
  materialName,
  materialCode,
  specs,
  reelNo,
  weight,
  setting = null,
}: ReturnReelQrPdfArgs) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const pageMargin = 10;
  const cardX = pageMargin;
  const cardY = pageMargin;
  const cardW = pageW - pageMargin * 2;
  const cardH = pageH - pageMargin * 2;
  const upperY = cardY;
  const upperH = cardH * 0.4;
  const lowerY = upperY + upperH;
  const lowerH = cardH - upperH;

  let logoDataUrl = "";
  const logoUrl = getLogoUrl(setting);
  if (logoUrl) {
    try {
      logoDataUrl = await imageUrlToDataUrl(logoUrl);
    } catch (error) {
      console.warn("Unable to load logo for return reel QR PDF", error);
    }
  }

  const organizationName = firstNonEmpty(setting?.organizationName, "LAXMI NARAYAN GROUP");
  const qrPayload = JSON.stringify({
    source: "RETURN",
    returnNo,
    date,
    jobNo: jobNo || "",
    reelNo,
    weight: Number(weight || 0),
    materialName: materialName || "",
    materialCode: materialCode || "",
    specs: specs || "",
  });

  doc.setDrawColor(0);
  doc.setTextColor(0);
  doc.setLineWidth(0.25);
  doc.rect(cardX, cardY, cardW, cardH);
  doc.line(cardX, lowerY, cardX + cardW, lowerY);

  const contentW = Math.min(200, cardW - 10);
  const contentX = cardX + (cardW - contentW) / 2;
  const lh = (pt: number, ratio = 1.16) => pt * 0.3528 * ratio;

  const logoW = Math.min(48, contentW * 0.26);
  const logoH = logoW * 0.34;
  const titleSize = 22;
  const badgeSize = 14;
  const metaSize = 11;
  const materialSize = 15;
  const specsSize = 12.5;
  const detailSize = 14;

  const materialText = toUpper(materialName);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(materialSize);
  const materialLines = doc.splitTextToSize(materialText, contentW - 6).slice(0, 2);

  const specText = firstNonEmpty(specs);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(specsSize);
  const specLines = doc.splitTextToSize(specText, contentW - 8).slice(0, 2);

  const blockH =
    (logoDataUrl ? logoH + 3 : 0) +
    lh(titleSize, 0.9) +
    5 +
    10 +
    7 +
    lh(metaSize, 0.9) +
    5 +
    materialLines.length * lh(materialSize, 1.02) +
    3 +
    specLines.length * lh(specsSize, 1.05) +
    7 +
    3 * lh(detailSize, 1.08);

  let y = Math.max(upperY + 4, upperY + (upperH - blockH) / 2);

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", cardX + cardW / 2 - logoW / 2, y, logoW, logoH, undefined, "FAST");
    y += logoH + 3;
  }

  const orgTitle = toUpper(organizationName);
  let titleFontSize = titleSize;
  const titleMaxWidth = contentW - 6;
  doc.setFont("helvetica", "bold");
  while (titleFontSize > 15) {
    doc.setFontSize(titleFontSize);
    if (doc.getTextWidth(orgTitle) <= titleMaxWidth) break;
    titleFontSize -= 1;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(titleFontSize);
  doc.text(orgTitle, cardX + cardW / 2, y + lh(titleFontSize, 0.82), { align: "center" });
  y += lh(titleSize, 0.9) + 5;

  const badgeW = 40;
  const badgeH = 10;
  const badgeX = cardX + cardW / 2 - badgeW / 2;
  doc.setLineWidth(0.35);
  doc.rect(badgeX, y, badgeW, badgeH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(badgeSize);
  doc.text("RETURN", cardX + cardW / 2, y + 7.2, { align: "center" });
  y += badgeH + 7;

  const colW = contentW / 3;
  const metaY = y + lh(metaSize, 0.82);
  const meta = [
    ["Return", firstNonEmpty(returnNo)],
    ["Date", formatDate(date)],
    ["Code", firstNonEmpty(materialCode)],
  ];
  meta.forEach(([label, value], index) => {
    const x = contentX + index * colW;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(metaSize);
    doc.setTextColor(55);
    doc.text(`${label}:`, x, metaY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(clipSingleLine(doc, value, colW - 20), x + 18, metaY);
  });
  y += lh(metaSize) + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(materialSize);
  doc.text(materialLines, cardX + cardW / 2, y + lh(materialSize, 0.8), { align: "center" });
  y += materialLines.length * lh(materialSize, 1.02) + 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(specsSize);
  doc.text(specLines, cardX + cardW / 2, y + lh(specsSize, 0.82), { align: "center" });
  y += specLines.length * lh(specsSize, 1.05) + 7;

  const detailColW = contentW / 3;
  const detailY = y + lh(detailSize, 0.82);
  const details = [
    ["Job", firstNonEmpty(jobNo)],
    ["R/No.", firstNonEmpty(reelNo)],
    ["Kgs", formatWeight(Number(weight || 0))],
  ];
  details.forEach(([label, value], index) => {
    const x = contentX + index * detailColW;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(detailSize);
    doc.setTextColor(45);
    doc.text(`${label}:`, x, detailY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(clipSingleLine(doc, value, detailColW - 22), x + 21, detailY);
  });

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
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 900,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(captionSize);
    doc.setTextColor(95);
    doc.text("Scan for Return Reel", cardX + cardW / 2, captionY, { align: "center" });
  } catch (error) {
    console.warn("Return reel QR generation failed", error);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(120, 0, 0);
    doc.text("QR Not Available", cardX + cardW / 2, lowerY + lowerH / 2, { align: "center" });
  }

  doc.save(`${safeFileName(`${reelNo}_return`)}.pdf`);
}
