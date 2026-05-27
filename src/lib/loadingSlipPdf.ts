import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "./serial";
import type { Company, DispatchPlan, Item, LoadingSlip, LoadingSlipAllocation, Order, Setting, Truck } from "../types";

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

function formatAllocations(allocations?: LoadingSlip["lines"][number]["allocations"], jobNos?: LoadingSlip["lines"][number]["jobNos"]) {
  if (Array.isArray(allocations) && allocations.length > 0) {
    return allocations
      .map((allocation: LoadingSlipAllocation) =>
        allocation.sourceType === "job"
          ? `${allocation.jobNo} (${Number(allocation.qty || 0).toLocaleString()})`
          : `${allocation.sourceRef} (${Number(allocation.qty || 0).toLocaleString()})`
      )
      .join(", ");
  }

  if (Array.isArray(jobNos) && jobNos.length > 0) {
    return jobNos.map((jobNo) => String(jobNo)).join(", ");
  }

  return "-";
}

export async function downloadLoadingSlipPdf({
  slip,
  setting,
  trucks,
  plans,
  orders,
  items,
  companies,
}: {
  slip: LoadingSlip;
  setting?: Setting | null;
  trucks: Truck[];
  plans: DispatchPlan[];
  orders: Order[];
  items: Item[];
  companies: Company[];
}) {
  const doc = new jsPDF("p", "mm", "a4");
  let currentY = 16;

  const organizationLogoUrl = getOrganizationLogoUrl(setting);
  if (organizationLogoUrl) {
    try {
      const imageDataUrl = await getImageDataUrl(organizationLogoUrl);
      doc.addImage(imageDataUrl, "PNG", 90, currentY, 30, 18, undefined, "FAST");
      currentY += 22;
    } catch (err) {
      console.warn("Organization logo could not be added to loading slip PDF:", err);
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

  currentY += 4;
  doc.setDrawColor(0);
  doc.line(14, currentY, 196, currentY);
  currentY += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("LOADING SLIP", 105, currentY, { align: "center" });
  currentY += 10;

  const truckNo = trucks.find((t) => t.id === slip.truckId)?.truckNo || "Unknown";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const details: Array<[string, string]> = [
    ["Slip No", slip.slipNo || "-"],
    ["Date", formatDate(slip.date)],
    ["Truck No", truckNo],
    ["Total Qty", slip.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0).toLocaleString()],
  ];

  details.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? 14 : 110;
    const y = currentY + Math.floor(index / 2) * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 26, y);
  });
  currentY += 20;

  const rows = slip.lines.map((line, index) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    const item = items.find((i) => i.id === order?.itemId);
    const company = companies.find((c) => c.id === order?.companyId);
    return [
      index + 1,
      company?.name || "Unknown",
      order?.orderNo || "-",
      item?.name || "Unknown Item",
      Number(plan?.plannedQty || 0).toLocaleString(),
      Number(line.loadedQty || 0).toLocaleString(),
      formatAllocations(line.allocations, line.jobNos),
    ];
  });

  const companyIds = new Set<string>();
  slip.lines.forEach((line) => {
    const plan = plans.find((p) => p.id === line.dispatchPlanId);
    const order = orders.find((o) => o.id === plan?.orderId);
    if (order?.companyId) companyIds.add(order.companyId);
  });
  const uniqueCompanies = Array.from(companyIds)
    .map((id) => companies.find((c) => c.id === id))
    .filter(Boolean) as Company[];

  if (uniqueCompanies.length === 1) {
    const company = uniqueCompanies[0];
    const companyLines = [company.name, company.address, company.district, company.state]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(", ");
    const gstLine = String(company.gstNo || "").trim();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Company:", 14, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(company.name, 34, currentY);
    currentY += 6;

    if (companyLines) {
      const wrapped = doc.splitTextToSize(companyLines, 180);
      doc.text(wrapped, 14, currentY);
      currentY += wrapped.length * 5;
    }

    if (gstLine) {
      doc.setFont("helvetica", "bold");
      doc.text("GST No:", 14, currentY);
      doc.setFont("helvetica", "normal");
      doc.text(gstLine, 34, currentY);
      currentY += 6;
    }

    currentY += 2;
  } else if (uniqueCompanies.length > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Companies:", 14, currentY);
    doc.setFont("helvetica", "normal");
    doc.text("Multiple", 38, currentY);
    currentY += 8;
  }

  autoTable(doc, {
    startY: currentY,
    head: [["SL", "Company", "Order No", "Item", "Planned", "Loaded", "Jobs / Allocations"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: 0 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      4: { halign: "right", cellWidth: 18 },
      5: { halign: "right", cellWidth: 18 },
      6: { cellWidth: 60 },
    },
  });

  const safeSlipNo = String(slip.slipNo || "LoadingSlip").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`LoadingSlip_${safeSlipNo}_${String(slip.date || "").slice(0, 10)}.pdf`);
}
