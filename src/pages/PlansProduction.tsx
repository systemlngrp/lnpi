const overviewRules = [
  "Scheduled Order selection drives the default order, company, item, ERP code, dimensions, paper specs, and rate.",
  "Only schedules with pending production appear in the list.",
  "Production Date cannot be earlier than today.",
  "Planned Quantity must be greater than 0 and cannot exceed the current schedule's Pending Qty.",
  "If the selected item has a pending sample request, Planned Quantity is auto-filled from Sample Item Qty and becomes read-only.",
  "If the selected item is same as the latest relevant produced item, Planned Quantity cannot exceed Last Plan Qty x Deviation Allowed%.",
  "If the selected item is different from the latest relevant produced item, GSM cannot exceed Least GSM.",
  "Reel As per Calculation now follows the formula selected in Settings.",
];

const formulaCards = [
  {
    title: "Pending Qty",
    formula: "Scheduled Qty - Produced Qty - Canceled Qty, but never below 0.",
    description: "This is the live remaining quantity that can still be planned for the selected scheduled order.",
  },
  {
    title: "Maximum Allowed Production",
    formula: "Pending Order Quantity For Item - Current Balance - Production In Progress, but never below 0.",
    description: "This is a planning reference value shown to users for the selected item across open demand and existing work in progress.",
  },
  {
    title: "ID to OD",
    formula: "If PLY = 3, value is 6. If PLY = 5, value is 10. Otherwise value is 0.",
    description: "The app derives this helper value directly from PLY.",
  },
  {
    title: "ID to OD 17",
    formula: "If PLY = 3, value is 40. If PLY = 5, value is 50. Otherwise value is 0.",
    description: "This helper value is used inside the Cutting Trim calculation.",
  },
  {
    title: "Take up Factor",
    formula: "Flute mapping: A=1.5, B=1.35, C=1.42, E=1.26, B+C=1.38, B+E=1.3. Any other value becomes 0.",
    description: "The flute type determines the multiplier used for flute-paper contribution in GSM.",
  },
  {
    title: "GSM",
    formula: "L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3",
    description: "This is the main paper GSM calculation used for production planning.",
  },
  {
    title: "Printing Color",
    formula: "Combine Color 1 and Color 2 into one display value.",
    description: "This gives a single production field for printing color information based on the selected item.",
  },
  {
    title: "Reel Per Calc",
    formula: "If Breadth is blank or 0, use Height x UPS. Otherwise use ((Breadth + Height) x UPS) + ((ID to OD x UPS) + 16).",
    description: "This is the Breadth/Height Based Formula option available in Settings.",
  },
  {
    title: "Reel Per Calc - TYPE Based Formula",
    formula: "If TYPE = ROTARY TRAY: ((Length (OD) + Height (OD)) x UPS + 20) / 25.4. If TYPE = 2 PLY LINER, U/C PLATE, HORIZONTAL PLATE, or TRAY: ((Width (OD) x UPS) + 20) / 25.4. If TYPE = DIE CUT SHEET: ((Open Width x UPS) + 20) / 25.4. If TYPE = RSC: ((FLAP + Height (OD) + FLAP) x UPS + 20) / 25.4. For any other non-blank TYPE: ((Height (OD) x UPS) + 20) / 25.4.",
    description: "This is the TYPE Based Formula option available in Settings. In this logic, UPS is used in place of No. of Outs.",
  },
  {
    title: "Cutting Trim",
    formula: "If Breadth is blank or 0, use Length. If Number of Parts = 1, use ((Length + Breadth) x 2) + (ID to OD 17 x Number of Parts). If Number of Parts = 2, use Length + Breadth + ID to OD 17.",
    description: "Cutting Trim is derived from the item dimensions and number of parts.",
  },
  {
    title: "Line Required (Nos)",
    formula: "If ERP Code is blank, keep blank. If PLY is 3, use the same value as Paper Required (Nos). If PLY is 5, use Paper Required (Nos) x 2. If PLY is 2 and TYPE is 2 PLY LINER, use Planned Quantity divided by (UPS x No. of ups in Cutting (For Plates)).",
    description: "This field is auto-calculated in Production Form from the selected item type, ply, planned quantity, UPS, and No. of ups in Cutting (For Plates).",
  },
  {
    title: "Paper Required (Nos)",
    formula: "For VERTICAL PLATE, HORIZONTAL PLATE, U/C PLATE, and ROTARY TRAY: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)). For 2 PLY LINER: blank. For DIE CUT SHEET: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)) / Die Cut Ups. For RSC with PART = Single: Planned Quantity / UPS. For RSC with PART = 2 part box: (Planned Quantity / UPS) x 2.",
    description: "This field is auto-calculated in Production Form using the selected Item Master TYPE, PART, UPS, Die Cut Ups, and No. of ups in Cutting (For Plates).",
  },
  {
    title: "Sheet Weight",
    formula: "((Reel Actual Trim or Reel Per Calc) x Cutting Trim x GSM) / 1,000,000,000, then divide by UPS.",
    description: "If Reel Actual Trim is blank, the app falls back to Reel Per Calc before calculating Sheet Weight.",
  },
  {
    title: "Total Paper Wt",
    formula: "Sheet Weight x Planned Quantity",
    description: "This gives the total estimated paper weight for the planned production quantity.",
  },
  {
    title: "Total Wt of Set",
    formula: "Sheet Weight + Plate/PHP Weight",
    description: "This combines paper and plate weight into one per-set value.",
  },
  {
    title: "Realization/KG",
    formula: "(Rate / Total Wt of Set) x No. of Parts",
    description: "The app uses the order rate and total set weight to estimate realization per kilogram.",
  },
  {
    title: "Prod (Meter)",
    formula: "((Cutting Trim x Planned Quantity) / 1000) / UPS",
    description: "This converts planned production quantity into production meters.",
  },
  {
    title: "Planned Prod (Mtr)",
    formula: "((Cutting Trim x Planned Quantity) / 1000) / UPS, rounded to 2 decimals. If Cutting Trim, Planned Quantity, or UPS is missing, keep blank.",
    description: "This is the rounded planning display value shown to users.",
  },
  {
    title: "Avg Weight",
    formula: "Actual Paper Used / Prod (FFG), rounded to 3 decimals. If either value is missing or 0, keep blank.",
    description: "Average weight is calculated only when both Actual Paper Used and Prod (FFG) are available.",
  },
  {
    title: "Wastage",
    formula: "100 - (((Prod (FFG) x Sheet Weight) / Actual Paper Used) x 100), rounded to 2 decimals. If required values are missing or 0, keep blank.",
    description: "This shows the estimated wastage percentage based on actual usage and finished production.",
  },
  {
    title: "Flute Batches",
    formula: "Flute mapping: A=1, B=2, B+C=3, C=4, E=5. Any other value stays blank.",
    description: "This is a fixed mapping derived from the flute type.",
  },
];

const fieldRules = [
  {
    field: "Scheduled Order",
    source: "Manual selection from pending schedules only",
    formula: "Option label shows Order No, Company, Item, Schedule Date, and Pending Qty.",
    validation: "Required. Only schedules where Pending Qty is greater than 0 are shown.",
  },
  {
    field: "Production Date",
    source: "Manual input",
    formula: "Default value is today's date.",
    validation: "Required. Cannot be earlier than today.",
  },
  {
    field: "Planned Quantity",
    source: "Manual or auto-filled",
    formula: "If Sample Item = YES, use Sample Item Qty. Otherwise user enters the quantity.",
    validation: "Required. Must be more than 0. Cannot exceed Pending Qty. If same item as last production, it also cannot exceed Last Plan Qty x Deviation Allowed%.",
  },
  {
    field: "Remarks",
    source: "Manual input",
    formula: "No formula.",
    validation: "Optional.",
  },
  {
    field: "No. of Parts",
    source: "Auto-filled from Item Master",
    formula: "Direct copy from the selected item.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "UPS",
    source: "Default from Item Master, editable in form",
    formula: "Direct copy from the selected item until changed by the user.",
    validation: "Used in Reel Per Calc, Sheet Weight, Prod (Meter), and Planned Prod (Mtr).",
  },
  {
    field: "Length / Breadth / Height",
    source: "Auto-filled from Item Master",
    formula: "Direct copy from the selected item.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "PLY",
    source: "Auto-filled from Item Master",
    formula: "Direct copy from the selected item, then used for ID to OD and ID to OD 17.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Flute",
    source: "Auto-filled from Item Master",
    formula: "Direct copy from the selected item, then used for Take up Factor and Flute Batches.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "ID to OD",
    source: "Auto-calculated",
    formula: "From PLY: 3 -> 6, 5 -> 10, otherwise 0.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Take up Factor",
    source: "Auto-calculated",
    formula: "From Flute mapping: A=1.5, B=1.35, C=1.42, E=1.26, B+C=1.38, B+E=1.3.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "L1 / F1 / L2 / F2 / L3",
    source: "Default from Item Master, editable in form",
    formula: "Direct copy from the selected item until changed by the user.",
    validation: "These values feed the GSM formula.",
  },
  {
    field: "Color 1 / Color 2",
    source: "Auto-filled from Item Master",
    formula: "Direct copy of Printing Colour 1 and Printing Colour 2 from the selected item.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Printing Color",
    source: "Auto-calculated",
    formula: "Combine Color 1 and Color 2 into one display value.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "GSM",
    source: "Auto-calculated",
    formula: "L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3",
    validation: "Read-only. If current item is different from the last produced item and this is not a sample item, GSM must not exceed Least GSM.",
  },
  {
    field: "ERP Code Reel",
    source: "Reference field",
    formula: "No calculation in current form logic.",
    validation: "Read-only display field.",
  },
  {
    field: "Reel Per Calc",
    source: "Auto-calculated",
    formula: "This field follows the formula selected in Settings. Option 1 is Breadth/Height Based Formula. Option 2 is TYPE Based Formula.",
    validation: "Read-only in Production Form. A tooltip on the field shows the active formula logic.",
  },
  {
    field: "Reel Actual Trim",
    source: "Manual input",
    formula: "If blank or 0, Sheet Weight uses Reel Per Calc instead.",
    validation: "Editable override field.",
  },
  {
    field: "Cutting Trim",
    source: "Auto-calculated",
    formula: "If Breadth is blank or 0, use Length. If No. of Parts = 1, use ((Length + Breadth) x 2) + (ID to OD 17 x No. of Parts). If No. of Parts = 2, use Length + Breadth + ID to OD 17.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Paper Required (Nos)",
    source: "Auto-calculated",
    formula: "For VERTICAL PLATE, HORIZONTAL PLATE, U/C PLATE, and ROTARY TRAY: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)). For 2 PLY LINER: blank. For DIE CUT SHEET: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)) / Die Cut Ups. For RSC with PART = Single: Planned Quantity / UPS. For RSC with PART = 2 part box: (Planned Quantity / UPS) x 2.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Line Required (Nos)",
    source: "Auto-calculated",
    formula: "If ERP Code is blank, keep blank. If PLY is 3, use the same value as Paper Required (Nos). If PLY is 5, use Paper Required (Nos) x 2. If PLY is 2 and TYPE is 2 PLY LINER, use Planned Quantity divided by (UPS x No. of ups in Cutting (For Plates)).",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Sheet Weight",
    source: "Auto-calculated",
    formula: "((Reel Actual Trim or Reel Per Calc) x Cutting Trim x GSM) / 1,000,000,000 / UPS",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Plate/PHP Weight",
    source: "Auto-filled from Item Master",
    formula: "Direct copy from the selected item.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Total Paper Wt",
    source: "Auto-calculated",
    formula: "Sheet Weight x Planned Quantity",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Total Wt of Set",
    source: "Auto-calculated",
    formula: "Sheet Weight + Plate/PHP Weight",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Actual Paper Used",
    source: "Manual input",
    formula: "Used later by Avg Weight and Wastage.",
    validation: "Editable numeric field.",
  },
  {
    field: "Rate",
    source: "Auto-filled from selected order",
    formula: "Direct copy from the selected order.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Realization/KG",
    source: "Auto-calculated",
    formula: "(Rate / Total Wt of Set) x No. of Parts",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Prod (Sheet Plant)",
    source: "Manual input",
    formula: "No formula in current form logic.",
    validation: "Editable numeric field.",
  },
  {
    field: "Prod (FFG)",
    source: "Manual input",
    formula: "Used later by Avg Weight and Wastage.",
    validation: "Editable numeric field.",
  },
  {
    field: "Wastage",
    source: "Auto-calculated",
    formula: "100 - (((Prod (FFG) x Sheet Weight) / Actual Paper Used) x 100)",
    validation: "Read-only. Remains blank until Prod (FFG), Sheet Weight, and Actual Paper Used are all available.",
  },
  {
    field: "Prod (Meter)",
    source: "Auto-calculated",
    formula: "((Cutting Trim x Planned Quantity) / 1000) / UPS",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Planned Prod (Mtr)",
    source: "Auto-calculated",
    formula: "((Cutting Trim x Planned Quantity) / 1000) / UPS, rounded to 2 decimals",
    validation: "Read-only. Kept blank when Cutting Trim, Planned Quantity, or UPS is missing.",
  },
  {
    field: "Least GSM",
    source: "Auto-derived from production history by ERP code",
    formula: "Lowest GSM found among non-cancelled production records for the same ERP Code.",
    validation: "Read-only reference field used by GSM validation.",
  },
  {
    field: "Flute Batches",
    source: "Auto-calculated",
    formula: "From Flute mapping: A=1, B=2, B+C=3, C=4, E=5.",
    validation: "Read-only in Production Form.",
  },
  {
    field: "Company Name",
    source: "Auto-filled from selected order's company",
    formula: "Direct copy from the selected company.",
    validation: "Read-only in Production Form.",
  },
];

const virtualColumns = [
  {
    column: "Order No.",
    source: "Looked up through Scheduled Order -> Order",
    logic: "Shows the order number from the order linked to the production schedule.",
  },
  {
    column: "Company",
    source: "Looked up through Scheduled Order -> Order -> Company",
    logic: "Shows the company name linked to the order for this production row.",
  },
  {
    column: "Type",
    source: "Item Master",
    logic: "Shows the selected item's type name.",
  },
  {
    column: "Paper",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Paper.",
  },
  {
    column: "Liner",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Liner.",
  },
  {
    column: "Print",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Printing.",
  },
  {
    column: "Paste",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Pasting.",
  },
  {
    column: "Stitch",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Stitching.",
  },
  {
    column: "L (OD)",
    source: "Item Master",
    logic: "Shows the item's outer length value stored in Item Master.",
  },
  {
    column: "W (OD)",
    source: "Item Master",
    logic: "Shows the item's outer width value stored in Item Master.",
  },
  {
    column: "H (OD)",
    source: "Item Master",
    logic: "Shows the item's outer height value stored in Item Master.",
  },
  {
    column: "Flap",
    source: "Item Master",
    logic: "Shows the item's flap value stored in Item Master.",
  },
  {
    column: "Deckle",
    source: "Item Master",
    logic: "Shows the item's deckle size stored in Item Master.",
  },
  {
    column: "Cutting",
    source: "Item Master",
    logic: "Shows the item's cutting size stored in Item Master.",
  },
  {
    column: "Least GSM",
    source: "Production history",
    logic: "Shows the lowest GSM found among non-cancelled production rows for the same ERP Code.",
  },
  {
    column: "Processing Status",
    source: "Production Processing records",
    logic: "If no processing rows exist, show Pending. Otherwise show unique machine names used for that production plus total processed quantity in brackets.",
  },
  {
    column: "Punching",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Punching.",
  },
  {
    column: "Gluing",
    source: "Production Processing records",
    logic: "Total of processing quantity for the current production where machine mapping falls under Gluing.",
  },
];

const settingsDrivenRules = [
  {
    setting: "Breadth/Height Based Formula",
    logic: "If Breadth is blank or 0, use Height x UPS. Otherwise use ((Breadth + Height) x UPS) + ((ID to OD x UPS) + 16).",
  },
  {
    setting: "TYPE Based Formula",
    logic: "If TYPE = ROTARY TRAY: ((Length (OD) + Height (OD)) x UPS + 20) / 25.4. If TYPE = 2 PLY LINER, U/C PLATE, HORIZONTAL PLATE, or TRAY: ((Width (OD) x UPS) + 20) / 25.4. If TYPE = DIE CUT SHEET: ((Open Width x UPS) + 20) / 25.4. If TYPE = RSC: ((FLAP + Height (OD) + FLAP) x UPS + 20) / 25.4. For any other non-blank TYPE: ((Height (OD) x UPS) + 20) / 25.4.",
  },
];

export function PlansProduction() {
  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Production</h2>
        <p className="mt-2 text-sm text-slate-700 font-medium">
          This page explains the current Production Form formulas, auto-filled values, and field validations in simple app language for user reference.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">What Is Auto Filled</h3>
          <p className="text-sm text-black leading-6">
            After selecting a Scheduled Order, the app pulls company, item, ERP code, rate, dimensions, ply, flute, plate weight, and paper layer values from the related masters and order records.
          </p>
        </div>

        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">What Is Validated</h3>
          <p className="text-sm text-black leading-6">
            The app checks date, pending schedule quantity, sample-item behavior, same-item deviation limits, and different-item GSM limits before allowing submission.
          </p>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Production Rules Summary</h3>
        </div>
        <div className="p-5 space-y-3">
          {overviewRules.map((rule) => (
            <div key={rule} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {rule}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Calculation Logic</h3>
        </div>
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {formulaCards.map((card) => (
            <div key={card.title} className="border border-black rounded bg-slate-50 p-4 space-y-2">
              <h4 className="text-sm font-black uppercase tracking-wide text-black">{card.title}</h4>
              <div className="rounded border border-black bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                {card.formula}
              </div>
              <p className="text-sm text-black leading-6">{card.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Settings Driven Reel Formula</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-black leading-6">
            The <span className="font-bold">Reel As per Calculation</span> field in Production Form is now controlled by the Settings page. Users can choose one of the short dropdown values below.
          </p>
          {settingsDrivenRules.map((row) => (
            <div key={row.setting} className="border border-black rounded bg-slate-50 p-4 space-y-2">
              <h4 className="text-sm font-black uppercase tracking-wide text-black">{row.setting}</h4>
              <div className="rounded border border-black bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                {row.logic}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Field Wise Formula And Validation</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Field</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Source</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Formula / Logic</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Validation / Behavior</th>
              </tr>
            </thead>
            <tbody>
              {fieldRules.map((row) => (
                <tr key={row.field} className="align-top">
                  <td className="px-4 py-3 text-sm font-bold text-black border border-black bg-white">{row.field}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white">{row.source}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white leading-6">{row.formula}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white leading-6">{row.validation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Virtual Columns In Production Master</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-black leading-6 mb-4">
            These columns are currently shown in Production Master View, but their values are looked up or derived from related records instead of being typed directly into the production entry.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Virtual Column</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">How It Is Shown</th>
                </tr>
              </thead>
              <tbody>
                {virtualColumns.map((row) => (
                  <tr key={row.column} className="align-top">
                    <td className="px-4 py-3 text-sm font-bold text-black border border-black bg-white">{row.column}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black bg-white">{row.source}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black bg-white leading-6">{row.logic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
