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

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
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

  const cardW = 82;
  const cardH = 84;
  const cardX = (pageW - cardW) / 2;
  const cardY = 12;
  const pad = 3.2;
  const innerX = cardX + pad;
  const innerW = cardW - pad * 2;
  const rightX = cardX + cardW - pad;

  let logoDataUrl = "";
  const logoUrl = getLogoUrl(setting);
  if (logoUrl) {
    try {
      logoDataUrl = await imageUrlToDataUrl(logoUrl);
    } catch (error) {
      console.warn("Unable to load logo for return reel QR PDF", error);
    }
  }

  const organizationName = firstNonEmpty(setting?.organizationName, "LAXMI NARAYAN GROUP").toUpperCase();
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
  doc.setLineWidth(0.55);
  doc.roundedRect(cardX, cardY, cardW, cardH, 1.2, 1.2);

  const headerY = cardY + pad;
  const headerH = 13.5;
  const logoW = 14;
  const logoH = 10;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", innerX, headerY + 1.4, logoW, logoH, undefined, "FAST");
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("LN", innerX + logoW / 2, headerY + 7, { align: "center" });
  }

  const badgeW = 18;
  const badgeH = 6.5;
  const badgeX = rightX - badgeW;
  const titleX = innerX + logoW + 2.5;
  const titleW = badgeX - titleX - 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(clipSingleLine(doc, organizationName, titleW), titleX, headerY + 6.8);
  doc.setLineWidth(0.35);
  doc.rect(badgeX, headerY + 3.1, badgeW, badgeH);
  doc.setFontSize(7.7);
  doc.text("RETURN", badgeX + badgeW / 2, headerY + 7.8, { align: "center" });

  let y = headerY + headerH;
  doc.setLineWidth(0.28);
  doc.line(cardX, y, cardX + cardW, y);

  const infoY = y + 4.8;
  const infoFont = 6.7;
  doc.setFontSize(infoFont);
  const colW = innerW / 3;
  const infoPairs = [
    ["Doc", firstNonEmpty(returnNo)],
    ["Date", formatDate(date)],
    ["Code", firstNonEmpty(materialCode)],
  ];
  infoPairs.forEach(([label, value], index) => {
    const x = innerX + index * colW;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, infoY);
    doc.setFont("helvetica", "normal");
    doc.text(clipSingleLine(doc, value, colW - 9), x + 7.5, infoY);
  });
  y += 7.3;
  doc.line(cardX, y, cardX + cardW, y);

  y += 5.2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  const supplierLines = doc.splitTextToSize(firstNonEmpty(materialName).toUpperCase(), innerW).slice(0, 2);
  doc.text(supplierLines, innerX, y);
  y += supplierLines.length * 4.2 + 1.7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  const specLines = doc.splitTextToSize(firstNonEmpty(specs), innerW).slice(0, 2);
  doc.text(specLines, innerX, y);
  y += specLines.length * 3.8 + 2.2;
  doc.line(cardX, y, cardX + cardW, y);
  y += 4.5;

  const qrBoxSize = 35;
  const qrBoxX = rightX - qrBoxSize;
  const qrBoxY = y - 1.5;
  const detailX = innerX;
  const labelW = 18;
  const valueX = detailX + labelW;
  const valueW = qrBoxX - valueX - 2.5;

  const drawDetail = (label: string, value: string, row: number, important = false) => {
    const textY = y + row * 6.1;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(important ? 8.8 : 7.8);
    doc.text(`${label}:`, detailX, textY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(important ? 9.2 : 8.3);
    doc.text(clipSingleLine(doc, value, valueW), valueX, textY);
  };

  drawDetail("GSM.", firstNonEmpty(String(specs || "").match(/(\d+(?:\.\d+)?)\s*GSM/i)?.[1]), 0);
  drawDetail("R/NO.", firstNonEmpty(reelNo), 1, true);
  drawDetail("Kgs.", formatWeight(Number(weight || 0)), 2, true);
  drawDetail("Job", firstNonEmpty(jobNo), 3);

  doc.setLineWidth(0.35);
  doc.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
  const qrPad = 1.4;
  const qrSize = qrBoxSize - qrPad * 2;
  try {
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 900,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.addImage(qrDataUrl, "PNG", qrBoxX + qrPad, qrBoxY + qrPad, qrSize, qrSize, undefined, "FAST");
  } catch (error) {
    console.warn("Return reel QR generation failed", error);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("QR N/A", qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize / 2, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(80);
  doc.text("Scan for Return Reel", cardX + cardW / 2, cardY + cardH - 3.2, { align: "center" });

  doc.save(`${safeFileName(`${reelNo}_return`)}.pdf`);
}
