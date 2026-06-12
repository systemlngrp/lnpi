export const PRODUCTION_FORM_COLUMN_OPTIONS = [
  "Scheduled Order",
  "Production Date",
  "Pending Order Quantity",
  "Current Balance",
  "Production In Progress",
  "Maximum Allowed Production",
  "Sample Item",
  "Sample Item Qty",
  "Last Item",
  "Last Plan Qty",
  "Deviation Allowed",
  "Planned Quantity",
  "Remarks",
  "No. of Parts",
  "UPS",
  "Length",
  "Breadth",
  "Height",
  "PLY",
  "Flute",
  "ID to OD",
  "Top",
  "Take up Factor",
  "GSM",
  "Color 1",
  "Color 2",
  "Printing Color",
  "ERP Code Reel",
  "L1",
  "F1",
  "L2",
  "F2",
  "L3",
  "Reel Per Calc",
  "No. of ups in Cutting (For Plates)",
  "Reel Actual Trim",
  "Cutting Trim",
  "Paper Required (Nos)",
  "Top Paper Weight (KG)",
  "Liner Weight (KG)",
  "Total Job Weight",
  "Liner Required (Nos)",
  "Sheet Weight",
  "Plate/PHP Weight",
  "Total Paper Wt",
  "Total Wt of Set",
  "Avg Weight",
  "Actual Paper Used",
  "Rate",
  "Realization/KG",
  "Prod (Sheet Plant)",
  "Prod (FFG)",
  "Wastage",
  "Prod (Meter)",
  "Planned Prod (Mtr)",
  "Least GSM",
  "Flute Batches",
  "Company Name",
] as const;

export function parseProductionFormVisibleColumns(raw?: string | null) {
  if (!raw) return [...PRODUCTION_FORM_COLUMN_OPTIONS];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const normalized = parsed.map((value) =>
        value === "Line Required (Nos)" ? "Liner Required (Nos)" : value
      );
      const valid = normalized.filter((value): value is string =>
        typeof value === "string" && PRODUCTION_FORM_COLUMN_OPTIONS.includes(value as (typeof PRODUCTION_FORM_COLUMN_OPTIONS)[number])
      );
      return valid.length > 0 ? valid : [...PRODUCTION_FORM_COLUMN_OPTIONS];
    }
  } catch (error) {
    console.error("Failed to parse production form visible columns:", error);
  }

  return [...PRODUCTION_FORM_COLUMN_OPTIONS];
}
