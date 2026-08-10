import type { Company, Material, MaterialIn, MaterialInPackingSlip, Supplier } from "../types";
import { formatDate } from "./serial";

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
  qrPayloadByPackingSlipId?: Record<string, string>;
  weightKgByPackingSlipId?: Record<string, number>;
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

export function buildMrrReelLabelData({
  mrr,
  packingSlips,
  materials,
  suppliers,
  companies = [],
  qrPayloadByPackingSlipId = {},
  weightKgByPackingSlipId = {},
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
    const overrideWeightKg = asPositiveNumber(weightKgByPackingSlipId[slip.id]);
    const weightKg = overrideWeightKg || asPositiveNumber(slip.weightKg);

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
    const defaultQrPayload = JSON.stringify({
      source: "MRR",
      reelNo,
      ourReelNo: reelNo,
      weight: weightKg,
      weightKg,
      mrrNo: toText(mrr.transactionNo),
      date: toText(mrr.date),
      materialCode: toText(material?.erpCode),
    });

    labels.push({
      ...baseRow,
      qrPayload: toText(qrPayloadByPackingSlipId[slip.id]) || defaultQrPayload,
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
