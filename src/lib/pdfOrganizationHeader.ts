import type jsPDF from "jspdf";
import type { Setting } from "../types";

async function getImageDataUrl(url: string) {
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

function getOrganizationLogoUrl(setting?: Setting | null) {
  if (!setting?.organizationLogo) return "";
  const encoded = setting.organizationLogo.split("/").map(encodeURIComponent).join("/");
  if (typeof window === "undefined") return `/uploads/${encoded}`;
  return new URL(`/uploads/${encoded}`, window.location.origin).toString();
}

export type OrganizationHeaderOptions = {
  startY?: number;
  requireAnyContent?: boolean;
  drawDivider?: boolean;
  dividerStartX?: number;
  dividerEndX?: number;
};

export async function renderOrganizationHeader(
  doc: jsPDF,
  setting?: Setting | null,
  {
    startY = 16,
    requireAnyContent = false,
    drawDivider = true,
    dividerStartX = 14,
    dividerEndX = 196,
  }: OrganizationHeaderOptions = {}
) {
  let currentY = startY;

  const organizationName = setting?.organizationName?.trim() || "";
  const organizationAddress = setting?.organizationAddress?.trim() || "";
  const organizationGstDetails = setting?.organizationGstDetails?.trim() || "";
  const organizationLogoUrl = getOrganizationLogoUrl(setting);

  const hasAnyContent = Boolean(organizationLogoUrl || organizationName || organizationAddress || organizationGstDetails);
  if (requireAnyContent && !hasAnyContent) {
    return { currentY: startY, hasAnyContent: false };
  }

  if (organizationLogoUrl) {
    try {
      const imageDataUrl = await getImageDataUrl(organizationLogoUrl);
      const props = doc.getImageProperties(imageDataUrl);
      
      // Target width 32mm (~90px), height auto
      const targetWidth = 32;
      const targetHeight = (props.height * targetWidth) / props.width;
      const x = 105 - (targetWidth / 2);

      // Ensure white background behind the logo
      doc.setFillColor(255, 255, 255);
      doc.rect(x, currentY, targetWidth, targetHeight, "F");
      
      // Add image with transparency support (PNG)
      doc.addImage(imageDataUrl, "PNG", x, currentY, targetWidth, targetHeight, undefined, "FAST");
      currentY += targetHeight + 5;
    } catch (error) {
      console.warn("Organization logo could not be added to PDF:", error);
    }
  }

  if (organizationName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(organizationName, 105, currentY, { align: "center" });
    currentY += 7;
  }

  if (organizationAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(organizationAddress, 160);
    doc.text(lines, 105, currentY, { align: "center" });
    currentY += lines.length * 5;
  }

  if (organizationGstDetails) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(organizationGstDetails, 160);
    doc.text(lines, 105, currentY, { align: "center" });
    currentY += lines.length * 5;
  }

  if (drawDivider) {
    currentY += 4;
    doc.setDrawColor(0);
    doc.line(dividerStartX, currentY, dividerEndX, currentY);
    currentY += 8;
  }

  return { currentY, hasAnyContent };
}

