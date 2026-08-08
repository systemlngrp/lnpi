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
  const pageH = doc.internal.pageSize.getHeight();
  const cardW = 160;
  const cardH = 160;
  const cardX = (pageW - cardW) / 2;
  const cardY = 18;
  const contentX = cardX + 8;
  const contentW = cardW - 16;

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
  doc.setLineWidth(0.35);
  doc.rect(cardX, cardY, cardW, cardH);

  let y = cardY + 10;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", contentX, y, 28, 20, undefined, "FAST");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(0);
  doc.text(clipSingleLine(doc, organizationName, 105), contentX + 42, y + 9);

  doc.setFontSize(15);
  doc.rect(contentX + 42, y + 14, 34, 10);
  doc.text("RETURN", contentX + 45, y + 21.2);
  y += 36;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(`Return: ${firstNonEmpty(returnNo)}`, contentX, y);
  doc.text(`Date: ${formatDate(date)}`, contentX + 60, y);
  doc.text(`Code: ${firstNonEmpty(materialCode)}`, contentX + 112, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  const materialLines = doc.splitTextToSize(firstNonEmpty(materialName).toUpperCase(), contentW).slice(0, 2);
  doc.text(materialLines, contentX, y);
  y += materialLines.length * 6 + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11.5);
  const specLines = doc.splitTextToSize(firstNonEmpty(specs), contentW).slice(0, 2);
  doc.text(specLines, contentX, y);
  y += specLines.length * 6 + 5;

  const qrSize = 68;
  const qrX = cardX + cardW - qrSize - 9;
  const qrY = y - 2;
  const leftW = qrX - contentX - 5;

  const drawDetail = (label: string, value: string, row: number) => {
    const textY = y + row * 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.text(`${label}:`, contentX, textY);
    doc.setFont("helvetica", "bold");
    doc.text(clipSingleLine(doc, value, leftW - 33), contentX + 33, textY);
  };

  drawDetail("Job", firstNonEmpty(jobNo), 0);
  drawDetail("R/No.", firstNonEmpty(reelNo), 1);
  drawDetail("Kgs", formatWeight(Number(weight || 0)), 2);

  try {
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 900,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");
  } catch (error) {
    console.warn("Return reel QR generation failed", error);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(120, 0, 0);
    doc.text("QR Not Available", qrX + qrSize / 2, qrY + qrSize / 2, { align: "center" });
  }

  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text("Scan for Return Reel", pageW / 2, Math.min(cardY + cardH - 8, pageH - 10), { align: "center" });

  doc.save(`${safeFileName(`${reelNo}_return`)}.pdf`);
}
