import type { Production } from "../types";
import { calculateInternalUps } from "./internalUps";

function hasValue(value: unknown) {
  return !(value === null || value === undefined || (typeof value === "string" && value.trim() === ""));
}

function toOptionalString(value: unknown) {
  if (!hasValue(value)) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function toOptionalNumber(value: unknown) {
  if (!hasValue(value)) return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function firstOptionalString(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalString(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalNumber(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function joinPrintingColors(...values: unknown[]) {
  return values
    .map((value) => toOptionalString(value))
    .filter(Boolean)
    .join(" / ") || undefined;
}

type MatchingProductionItem = {
  raw?: any;
  erp?: string | number;
  companyName?: string;
  rate?: number;
  boxType?: string;
  internalUps?: number;
  rapcForSingleBox?: string | number;
};

export function getProductionMatchingFields(
  production: Partial<Production>,
  item?: MatchingProductionItem | null
): Partial<Production> {
  const raw = item?.raw || {};

  return {
    companyName: firstOptionalString(
      production.companyName,
      item?.companyName,
      raw.companyName,
      raw.customerName,
      raw.customer,
      raw.company
    ),
    masterErp: firstOptionalString(production.masterErp, raw.masterItemNameErpCode),
    erpCode: firstOptionalString(production.erpCode, item?.erp, raw.erpItemCode, raw.masterItemNameErpCode),
    setsPerBox: firstOptionalNumber(production.setsPerBox, raw.numberOfSetsPerBox),
    rate: firstOptionalNumber(production.rate, item?.rate, raw.rate),
    noOfParts: firstOptionalNumber(production.noOfParts, raw.noOfParts),
    ups: firstOptionalNumber(
      production.ups,
      item?.internalUps,
      calculateInternalUps(item?.rapcForSingleBox),
      raw.internalUps,
      calculateInternalUps(raw.rapcForSingleBox),
      raw.ups,
      raw.noOfUpsForRapc,
      raw.noOfUpsForCutting,
      raw.noOfUpsForCuttingLengthPiece,
      raw.noOfUpsForCuttingWidthPiece
    ),
    length: firstOptionalNumber(production.length, raw.length),
    breadth: firstOptionalNumber(production.breadth, raw.breadth),
    height: firstOptionalNumber(production.height, raw.height),
    ply: firstOptionalNumber(production.ply, raw.ply, raw.noOfPly),
    noOfHolesInPhp: firstOptionalNumber(production.noOfHolesInPhp, raw.numberOfHolesInPhp),
    flute: firstOptionalString(production.flute, raw.flute, raw.fluteType),
    fluteType: firstOptionalString(production.fluteType, raw.fluteType, raw.flute),
    l1: firstOptionalNumber(production.l1, raw.l1),
    f1: firstOptionalNumber(production.f1, raw.f1),
    l2: firstOptionalNumber(production.l2, raw.l2),
    f2: firstOptionalNumber(production.f2, raw.f2),
    l3: firstOptionalNumber(production.l3, raw.l3),
    gsm: firstOptionalNumber(production.gsm, raw.gsm, raw.boardGsmReq, raw.calculatedBGsm),
    boardGsmReq: firstOptionalNumber(production.boardGsmReq, raw.boardGsmReq, raw.calculatedBGsm, production.gsm),
    brustingStrengthReq: firstOptionalNumber(production.brustingStrengthReq, raw.brustingStrengthReq),
    printingColor: firstOptionalString(
      production.printingColor,
      raw.printingColor,
      joinPrintingColors(raw.printingColour1, raw.printingColour2),
      joinPrintingColors(raw.color1, raw.color2)
    ),
    weightPerPcSetReq: firstOptionalNumber(
      production.weightPerPcSetReq,
      raw.weightPerPcReq,
      raw.calculatedWeightPerPcReq,
      raw.totalWeightGrams,
      production.plateWeight
    ),
    plateWeight: firstOptionalNumber(
      production.plateWeight,
      raw.plateWeight,
      raw.weightPerPcReq,
      raw.calculatedWeightPerPcReq,
      raw.totalWeightGrams
    ),
    jobType: firstOptionalString(production.jobType, raw.jobType, raw.boxType, item?.boxType),
    methodology: firstOptionalString(production.methodology, raw.methodology),
    sequence: firstOptionalString(production.sequence, raw.sequence),
  };
}

export function hasProductionMatchingFieldChanges(
  production: Partial<Production>,
  nextValues: Partial<Production>
) {
  return Object.entries(nextValues).some(([key, value]) => {
    if (value === undefined) return false;
    const currentValue = production[key as keyof Production];
    if (typeof value === "number") {
      return Number(currentValue) !== value;
    }
    return String(currentValue || "").trim() !== String(value).trim();
  });
}
