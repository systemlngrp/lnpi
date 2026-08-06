import type { Company, Material, MaterialIn, MaterialInPackingSlip, Supplier } from "../types";
import { formatDate } from "./serial";

export type ReelLabelPayload = {
  v: 1;
  mrrId: string;
  packingSlipId: string;
  docNo: string;
  docDate: string;
  code: string;
  supplierName: string;
  sizeCm: string;
  gsm: string;
  bf: string;
  reelNo: string;
  suppReel: string;
  weightKg: string;
};

export type MrrReelLabelRow = {
  mrrId: string;
  packingSlipId: string;
  docNo: string;
  docDate: string;
  code: string;
  supplierName: string;
  sizeCm: string;
  gsm: string;
  bf: string;
  reelNo: string;
  suppReel: string;
  weightKg: number;
  qrPayload: string;
};

export type BuildMrrReelLabelDataArgs = {
  mrr: MaterialIn;
  packingSlips: MaterialInPackingSlip[];
  materials: Material[];
  suppliers: Supplier[];
  companies?: Company[];
};

export type BuildMrrReelLabelDataResult = {
  labels: MrrReelLabelRow[];
  warnings: string[];
};

function asPositiveNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function toText(value: unknown) {
  return String(value ?? "").trim();
}

function findSupplierName(supplierId: string, suppliers: Supplier[], companies: Company[] = []) {
  const supplier = suppliers.find((entry) => entry.id === supplierId);
  if (supplier?.name) return supplier.name;
  const company = companies.find((entry) => entry.id === supplierId);
  if (company?.name) return company.name;
  return supplierId;
}

function normalizeReelNo(value: unknown) {
  return toText(value);
}

function formatWeight(weightKg: number) {
  return Number(weightKg || 0).toFixed(2);
}

function buildPayload(row: Omit<MrrReelLabelRow, "qrPayload">): ReelLabelPayload {
  return {
    v: 1,
    mrrId: row.mrrId,
    packingSlipId: row.packingSlipId,
    docNo: row.docNo,
    docDate: row.docDate,
    code: row.code,
    supplierName: row.supplierName,
    sizeCm: row.sizeCm,
    gsm: row.gsm,
    bf: row.bf,
    reelNo: row.reelNo,
    suppReel: row.suppReel,
    weightKg: formatWeight(row.weightKg),
  };
}

export function buildMrrReelLabelData({
  mrr,
  packingSlips,
  materials,
  suppliers,
  companies = [],
}: BuildMrrReelLabelDataArgs): BuildMrrReelLabelDataResult {
  const warnings: string[] = [];
  const supplierName = findSupplierName(mrr.supplierId, suppliers, companies);
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const slipsForMrr = packingSlips.filter((slip) => slip.materialInId === mrr.id);

  if (slipsForMrr.length === 0) {
    warnings.push(`No packing slips found for ${mrr.transactionNo}.`);
    return { labels: [], warnings };
  }

  const labels: MrrReelLabelRow[] = [];

  slipsForMrr.forEach((slip) => {
    const reelNo = normalizeReelNo(slip.ourReelNo);
    const weightKg = asPositiveNumber(slip.weightKg);

    if (!reelNo) {
      warnings.push(`Skipped packing slip ${slip.id}: reel number is missing.`);
      return;
    }
    if (!weightKg) {
      warnings.push(`Skipped reel ${reelNo}: weight is missing or zero.`);
      return;
    }

    const material = materialById.get(slip.materialId);
    if (!material) {
      warnings.push(`Material not found for reel ${reelNo} (materialId: ${slip.materialId}).`);
    }

    const baseRow = {
      mrrId: mrr.id,
      packingSlipId: slip.id,
      docNo: toText(mrr.transactionNo),
      docDate: formatDate(mrr.date),
      code: toText(material?.erpCode),
      supplierName,
      sizeCm: toText(material?.size),
      gsm: toText(material?.gsm),
      bf: toText(material?.bf),
      reelNo,
      suppReel: toText(slip.supplierReelNo),
      weightKg,
    };

    const payload = buildPayload(baseRow);
    labels.push({
      ...baseRow,
      qrPayload: JSON.stringify(payload),
    });
  });

  labels.sort((a, b) =>
    a.reelNo.localeCompare(b.reelNo, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  return { labels, warnings };
}
