const MACHINE_NAME_MAP: Record<string, string> = {
  "Corrugation Finger": "Corrugation Paper",
  "Corrugation Linear": "Corrugation Liner",
  "Sloting": "Slotting",
  "Slotter": "Slotting",
  "Stithing": "Stitching",
};


export function normalizeMachineName(name?: string | null) {
  const trimmed = String(name || "").trim();
  return MACHINE_NAME_MAP[trimmed] || trimmed;
}
