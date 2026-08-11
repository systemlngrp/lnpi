import type {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Supplier,
} from "../types";

export type ReelStockCalculationRow = {
  slipId: string;
  materialId: string;
  mrrDate: string;
  mrrNo: string;
  ourReelNo: string;
  erp: string;
  itemName: string;
  supplierName: string;
  gsm: number;
  size: number;
  bf: number;
  issuedWeight: number;
  returnedWeight: number;
  netIssuedWeight: number;
  availableWeight: number;
  mrrQty: number;
  openingQty: number;
  rate: number;
  valuation: number;
  ageDays: number;
  isOpening: boolean;
};

type BuildReelStockRowsArgs = {
  materials: Material[];
  materialIn: MaterialIn[];
  packingSlips: MaterialInPackingSlip[];
  issueReelLines: MaterialIssueReelLine[];
  returnReelLines: MaterialReturnReelLine[];
  suppliers?: Supplier[];
  includeMaterialIn?: (entry: MaterialIn) => boolean;
  includeIssueLine?: (line: MaterialIssueReelLine) => boolean;
  includeReturnLine?: (line: MaterialReturnReelLine) => boolean;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function getAgeDays(dateStr?: string) {
  if (!dateStr) return 0;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function getLineRate(line: MaterialIn["lines"][number] | undefined, material?: Material) {
  return Number(line?.invoiceRate ?? line?.poRate ?? line?.rate ?? material?.openingRate ?? 0);
}

function isOpeningMrrNo(value?: string | number | null) {
  return String(value ?? "").trim() === "1";
}

export function buildReelStockRows({
  materials,
  materialIn,
  packingSlips,
  issueReelLines,
  returnReelLines,
  suppliers = [],
  includeMaterialIn = () => true,
  includeIssueLine = () => true,
  includeReturnLine = () => true,
}: BuildReelStockRowsArgs): ReelStockCalculationRow[] {
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const materialInMap = new Map(materialIn.filter(includeMaterialIn).map((entry) => [entry.id, entry]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const filteredIssueLines = issueReelLines.filter(includeIssueLine);
  const filteredReturnLines = returnReelLines.filter(includeReturnLine);
  const lastExistingReelNo = packingSlips.reduce((max, slip) => {
    const reelNo = Number(String(slip.ourReelNo || "").trim());
    return Number.isFinite(reelNo) && reelNo > max ? reelNo : max;
  }, 0);

  const openingRows: ReelStockCalculationRow[] = materials
    .filter((material) => material.type === "Reel" && Number(material.openingQty || 0) > 0)
    .map((material, index) => {
      const openingQty = round2(Number(material.openingQty || 0));
      const openingRate = round2(Number(material.openingRate || 0));
      return {
        slipId: `opening-${material.id}`,
        materialId: material.id,
        mrrDate: "2026-06-06",
        mrrNo: "1",
        ourReelNo: String(lastExistingReelNo + index + 1),
        erp: String(material.erpCode || ""),
        itemName: String(material.name || ""),
        supplierName: "-",
        gsm: Number(material.gsm || 0),
        size: Number(material.size || 0),
        bf: Number(material.bf || 0),
        issuedWeight: 0,
        returnedWeight: 0,
        netIssuedWeight: 0,
        availableWeight: openingQty,
        mrrQty: 0,
        openingQty,
        rate: openingRate,
        valuation: round2(openingQty * openingRate),
        ageDays: 0,
        isOpening: true,
      };
    });

  const mrrRows = packingSlips
    .filter((slip) => materialInMap.has(slip.materialInId))
    .map((slip) => {
      const material = materialMap.get(slip.materialId);
      const receipt = materialInMap.get(slip.materialInId);
      const supplier = receipt ? supplierMap.get(receipt.supplierId) : undefined;
      const receiptLine =
        receipt?.lines.find((line) => line.id === slip.materialLineId) ||
        receipt?.lines.find((line) => line.itemId === slip.materialId);
      const relatedIssueLines = filteredIssueLines.filter((line) => line.packingSlipId === slip.id);
      const relatedReturnLines = filteredReturnLines.filter((line) => line.packingSlipId === slip.id);
      const issuedWeight = relatedIssueLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
      const returnedWeight = relatedReturnLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
      const reelQty = round2(Number(slip.weightKg || 0));
      const netIssuedWeight = round2(issuedWeight - returnedWeight);
      const availableWeight = round2(Math.max(0, reelQty + returnedWeight - issuedWeight));
      const rate = availableWeight > 0 ? round2(getLineRate(receiptLine, material)) : 0;
      const mrrNo = receipt?.transactionNo || "";
      const isOpening = isOpeningMrrNo(mrrNo);

      return {
        slipId: slip.id,
        materialId: slip.materialId,
        mrrDate: receipt?.date || "",
        mrrNo,
        ourReelNo: slip.ourReelNo || "",
        erp: String(material?.erpCode || ""),
        itemName: String(material?.name || ""),
        supplierName: supplier?.name || "",
        gsm: Number(material?.gsm || 0),
        size: Number(material?.size || 0),
        bf: Number(material?.bf || 0),
        issuedWeight: round2(issuedWeight),
        returnedWeight: round2(returnedWeight),
        netIssuedWeight,
        availableWeight,
        mrrQty: isOpening ? 0 : reelQty,
        openingQty: isOpening ? reelQty : 0,
        rate,
        valuation: availableWeight > 0 ? round2(availableWeight * rate) : 0,
        ageDays: getAgeDays(receipt?.date),
        isOpening,
      };
    })
    .sort((a, b) => {
      const dateDiff = new Date(b.mrrDate || 0).getTime() - new Date(a.mrrDate || 0).getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.ourReelNo.localeCompare(b.ourReelNo);
    });

  return [...openingRows, ...mrrRows];
}
