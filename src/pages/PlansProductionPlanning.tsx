export function PlansProductionPlanning() {
  const rules = [
    "If the selected item has a pending sample request with no cancel and no job card, it is treated as a sample item.",
    "For a sample item, Planned Quantity is auto-filled from one pending sample quantity and becomes read-only.",
    "If there is no pending sample request, Planned Quantity remains editable.",
    "If there is no pending sample and the current item is the same as the last produced item, quantity is validated using company-wise Deviation Allowed.",
    "If there is no pending sample and the current item is different from the last produced item, GSM must not exceed Least GSM.",
    "If the company does not have Deviation Allowed set, the fallback value used is 25.",
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Production Planning Logic</h2>
        <p className="mt-2 text-sm text-slate-700 font-medium">
          This page explains the current production planning rules in simple app language so users can refer to them later.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">Sample Rule</h3>
          <p className="text-sm text-black leading-6">
            The app first checks whether the selected item has a pending sample request. If yes, the item is treated as a sample item, the sample quantity is picked automatically, and planned quantity becomes locked.
          </p>
        </div>

        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">Deviation Rule</h3>
          <p className="text-sm text-black leading-6">
            When the current item is the same as the last produced item and there is no sample request, planned quantity is validated using the company&apos;s Deviation Allowed value. If that company value is blank, the app uses 25.
          </p>
        </div>

        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">GSM Rule</h3>
          <p className="text-sm text-black leading-6">
            When the current item is different from the last produced item and there is no sample request, the current GSM must not exceed Least GSM.
          </p>
        </div>

        <div className="bg-white border border-black rounded shadow-sm p-5">
          <h3 className="text-sm font-black uppercase text-slate-600 mb-3">Priority Order</h3>
          <p className="text-sm text-black leading-6">
            Sample logic takes first priority. If an item is treated as a sample item, the app uses sample quantity and does not block submission with the same-item quantity rule or the different-item GSM rule.
          </p>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Current Rules Summary</h3>
        </div>
        <div className="p-5 space-y-3">
          {rules.map((rule) => (
            <div key={rule} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
