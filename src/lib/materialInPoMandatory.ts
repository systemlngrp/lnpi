import type { Setting, MaterialIn } from "../types";

export const PO_MANDATORY_MRR_TYPES = ["Reel", "Others", "FG Purchase"] as const;

export type PoMandatoryMrrType = (typeof PO_MANDATORY_MRR_TYPES)[number];

export function parsePoMandatoryMrrTypes(setting?: Pick<Setting, "poMandatoryMrrTypes"> | null): PoMandatoryMrrType[] {
  const raw = setting?.poMandatoryMrrTypes;
  if (!raw) return ["Reel"];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["Reel"];
    const allowed = new Set<string>(PO_MANDATORY_MRR_TYPES);
    return parsed
      .map((value) => String(value || "").trim())
      .filter((value): value is PoMandatoryMrrType => allowed.has(value));
  } catch {
    return ["Reel"];
  }
}

export function supportsPoMandatorySetting(mrrType?: MaterialIn["mrrType"] | null): mrrType is PoMandatoryMrrType {
  return PO_MANDATORY_MRR_TYPES.includes(String(mrrType || "").trim() as PoMandatoryMrrType);
}
