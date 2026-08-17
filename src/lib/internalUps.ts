export function calculateInternalUps(rapcForSingleBox: unknown) {
  const rapcValue = Number(rapcForSingleBox);
  if (!Number.isFinite(rapcValue) || rapcValue <= 0) return undefined;
  return Math.floor(1320 / rapcValue);
}

export const REEL_AS_PER_CALCULATION_MODE = {
  breadthHeightBased: "breadth-height-based",
  typeBased: "type-based",
} as const;

type ProductionRapcInput = {
  boxType?: unknown;
  breadth?: unknown;
  height?: unknown;
  lOd?: unknown;
  wOd?: unknown;
  hOd?: unknown;
  openWidth?: unknown;
  flap?: unknown;
  ply?: unknown;
  ups?: unknown;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

export function calculateProductionRapc(input: ProductionRapcInput, formulaMode?: string) {
  const breadth = positiveNumber(input.breadth);
  const height = positiveNumber(input.height);
  const ups = positiveNumber(input.ups);
  if (ups <= 0) return undefined;

  const ply = Number(input.ply || 0);
  const idToOd = ply === 3 ? 6 : ply === 5 ? 10 : 0;
  const normalizedType = String(input.boxType || "").trim().toUpperCase();

  let rapc = !breadth ? height * ups : (breadth + height) * ups + (idToOd * ups + 16);

  if (formulaMode === REEL_AS_PER_CALCULATION_MODE.typeBased) {
    const lOd = positiveNumber(input.lOd);
    const wOd = positiveNumber(input.wOd);
    const hOd = positiveNumber(input.hOd);
    const flap = positiveNumber(input.flap);
    const openWidth = positiveNumber(input.openWidth);

    if (normalizedType === "ROTARY TRAY") {
      rapc = (((lOd + hOd) * ups) + 20) / 25.4;
    } else if (
      normalizedType === "2 PLY LINER" ||
      normalizedType === "U/C PLATE" ||
      normalizedType === "HORIZONTAL PLATE" ||
      normalizedType === "TRAY"
    ) {
      rapc = ((wOd * ups) + 20) / 25.4;
    } else if (normalizedType === "DIE CUT SHEET") {
      rapc = ((openWidth * ups) + 20) / 25.4;
    } else if (normalizedType === "RSC") {
      rapc = (((flap + hOd + flap) * ups) + 20) / 25.4;
    } else if (normalizedType) {
      rapc = ((hOd * ups) + 20) / 25.4;
    }
  }

  return Number.isFinite(rapc) && rapc > 0 ? round2(rapc) : undefined;
}

export function calculateInternalRapc(
  item: ProductionRapcInput & { internalUps?: unknown; rapcForSingleBox?: unknown },
  formulaMode?: string
) {
  const savedInternalUps = Number(item.internalUps);
  const internalUps = Number.isFinite(savedInternalUps) && savedInternalUps > 0
    ? savedInternalUps
    : calculateInternalUps(item.rapcForSingleBox);
  return calculateProductionRapc({ ...item, ups: internalUps }, formulaMode);
}
