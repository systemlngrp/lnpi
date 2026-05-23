const calculationCards = [
  {
    title: "L (OD)",
    formula: 'If Type = "RSC", use Length + PLY. Otherwise use Length.',
    description: "Outer length adds ply only for RSC items. All other item types keep the original length.",
  },
  {
    title: "W (OD)",
    formula: 'If Type = "RSC", use Bredth + PLY. Otherwise use Bredth.',
    description: "Outer width adds ply only for RSC items. All other item types keep the original bredth.",
  },
  {
    title: "H (OD)",
    formula: 'If Type = "RSC", use Height + PLY. Otherwise use Height.',
    description: "Outer height adds ply only for RSC items. All other item types keep the original height.",
  },
  {
    title: "Flap",
    formula: "If PLY = 3, then W (OD) / 2. Otherwise (W (OD) / 2) + 1.",
    description: "This is the Current Logic option. Flap changes based on the ply. Three-ply items use half of Width (OD), while other ply values use half of Width (OD) plus one.",
  },
  {
    title: "Flap - TYPE Based Logic",
    formula: 'If Type is "VERTICAL PLATE", "HORIZONTAL PLATE", or "DIE CUT SHEET", keep Flap blank. Otherwise, for 3 Ply use half of W (OD), for 5 Ply use half of W (OD) + 1, for 7 Ply use half of W (OD) + 2, and for 9 Ply use half of W (OD) + 3.',
    description: "This is the TYPE Based Logic option available in Settings for Item Form flap calculation.",
  },
  {
    title: "Deckle Size",
    formula: 'If Type is blank, keep blank. If Type = "RSC", use (((Flap + H (OD) + Flap) x Ups) + 20) / 25.4. If Type = "TRAY", use ((Open Width x Ups) + 20) / 25.4. Otherwise use ((H (OD) x Ups) + 20) / 25.4.',
    description: "Deckle Size depends on the item type and uses different base dimensions for RSC, TRAY, and all other item types.",
  },
  {
    title: "Cutting Size",
    formula: "If Flap > 1, use (((L (OD) + W (OD)) x 2) + 50) / 25.4. Otherwise keep blank.",
    description: "Cutting Size is only calculated when flap is greater than one.",
  },
  {
    title: "No. of Parts",
    formula: 'If Cutting Size is blank, keep blank. Otherwise, if Cutting Size x 25.4 < 1905 then 1, else 2.',
    description: "The application automatically decides whether the item has one part or two parts based on Cutting Size.",
  },
];

const inputFields = [
  "Type",
  "Open Width",
  "Length",
  "Bredth",
  "Height",
  "Ups",
  "PLY",
];

export function PlansItems() {
  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Items</h2>
        <p className="mt-2 text-sm text-slate-700 font-medium">
          This page explains the item-level calculations currently used in Item Form and Item Master.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">What Is Auto Calculated</h3>
          <p className="text-sm text-black leading-6">
            The application automatically calculates outer dimensions, flap, deckle size, cutting size, and number of parts from the main item inputs. Users do not need to type these values manually, and flap logic now follows the setting selected on the Settings page.
          </p>
        </div>

        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">Main Inputs Used</h3>
          <div className="flex flex-wrap gap-2">
            {inputFields.map((field) => (
              <span
                key={field}
                className="inline-flex items-center rounded border border-black bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-black"
              >
                {field}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Calculation Logic</h3>
        </div>
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {calculationCards.map((card) => (
            <div key={card.title} className="border border-black rounded bg-slate-50 p-4 space-y-2">
              <div>
                <h4 className="text-sm font-black uppercase tracking-wide text-black">{card.title}</h4>
              </div>
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
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Calculation Order</h3>
        </div>
        <div className="p-5 space-y-3">
          {[
            "First the app calculates L (OD), W (OD), and H (OD).",
            "Then it calculates Flap from W (OD), PLY, and the Flap setting selected in Settings.",
            "After that it calculates Deckle Size based on Type and Ups.",
            "Then it calculates Cutting Size.",
            "Finally it decides No. of Parts from Cutting Size.",
          ].map((step) => (
            <div key={step} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
