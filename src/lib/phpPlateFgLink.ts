import { OrderItemSource, Production } from "../types";

type PhpPlateSource = Extract<OrderItemSource, "PHP" | "PLATE">;

export type LinkedFgProductionState = {
  linkedFgProduction?: Production;
  fgValue: number;
  requiresFgGate: boolean;
  isBlocked: boolean;
  linkField: "phpScheduledJobId" | "plateScheduledJobId" | null;
};

function normalizeJobSource(
  production: Production,
  sourceOverride?: PhpPlateSource
): PhpPlateSource | null {
  if (sourceOverride === "PHP" || sourceOverride === "PLATE") return sourceOverride;
  if (production.itemSource === "PHP" || production.itemSource === "PLATE") return production.itemSource;
  return null;
}

function getLinkField(source: PhpPlateSource | null) {
  if (source === "PHP") return "phpScheduledJobId";
  if (source === "PLATE") return "plateScheduledJobId";
  return null;
}

export function resolvePhpPlateFgLink(
  production: Production,
  fgProductions: Production[],
  sourceOverride?: PhpPlateSource
): LinkedFgProductionState {
  const source = normalizeJobSource(production, sourceOverride);
  const linkField = getLinkField(source);
  const requiresFgGate = String(production.methodology || "").trim().toUpperCase() === "CORRUGATION" && !!linkField;

  if (!linkField) {
    return {
      fgValue: 0,
      requiresFgGate: false,
      isBlocked: false,
      linkField: null,
    };
  }

  const linkedFgProduction = fgProductions.find((row) => String(row[linkField] || "").trim() === String(production.id || "").trim());
  const fgValue = Number(linkedFgProduction?.prodFromFFG || 0);

  return {
    linkedFgProduction,
    fgValue: Number.isFinite(fgValue) ? fgValue : 0,
    requiresFgGate,
    isBlocked: requiresFgGate && !(fgValue > 0),
    linkField,
  };
}
