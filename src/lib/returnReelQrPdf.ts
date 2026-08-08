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
  const margin = 18;
  const cardW = pageW - margin * 2;
  const cardH = 128;
  const cardX = margin;
  const cardY = 18;
  const pad = 10;

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
  doc.setLineWidth(0.6);
  doc.rect(cardX, cardY, cardW, cardH);

  const headerY = cardY + pad;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", cardX + pad, headerY, 24, 18, undefined, "FAST");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(organizationName, cardX + cardW / 2, headerY + 8, { align: "center" });

  doc.setFontSize(12);
  doc.rect(cardX + cardW / 2 - 20, headerY + 13, 40, 10);
  doc.text("RETURN", cardX + cardW / 2, headerY + 20, { align: "center" });

  doc.setLineWidth(0.35);
  doc.line(cardX, cardY + 38, cardX + cardW, cardY + 38);

  const leftX = cardX + pad;
  let y = cardY + 50;
  const rowGap = 9;
  const labelW = 30;

  const drawRow = (label: string, value: string | number | undefined | null) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, leftX, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(firstNonEmpty(value), 92).slice(0, 2);
    doc.text(lines, leftX + labelW, y);
    y += Math.max(rowGap, lines.length * 5 + 3);
  };

  drawRow("Return No", returnNo);
  drawRow("Date", formatDate(date));
  drawRow("Job No", jobNo);
  drawRow("Code", materialCode);
  drawRow("Material", materialName);
  drawRow("Specs", specs);
  drawRow("Reel No", reelNo);
  drawRow("Weight KG", formatWeight(Number(weight || 0)));

  const qrSize = 52;
  const qrX = cardX + cardW - pad - qrSize;
  const qrY = cardY + 52;
  doc.setLineWidth(0.35);
  doc.rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6);

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
    doc.setFontSize(10);
    doc.text("QR NOT AVAILABLE", qrX + qrSize / 2, qrY + qrSize / 2, { align: "center" });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70);
  doc.text("Return reel QR label", cardX + cardW / 2, cardY + cardH - 8, { align: "center" });

  doc.save(`${safeFileName(`${reelNo}_return`)}.pdf`);
}
