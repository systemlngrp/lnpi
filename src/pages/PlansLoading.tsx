const summaryRules = [
  "Each loading-slip row can now split loaded quantity by source: Job or Opening Stock.",
  "For job allocation, the app stores both Job ID and Job No in loading_slips JSON.",
  "For every selected job, the loading form shows FFG, Already Loaded, Yet to Load, and Adjust Now.",
  "The sum of all job adjustments plus Opening Stock must exactly match the row Loaded quantity.",
  "A job cannot be adjusted beyond its available FFG balance after considering all previous loading slips.",
  "Opening Stock can be used as a separate source without stock-balance validation for now.",
  "Production Master now shows Loaded Qty as the cumulative loaded quantity allocated to that job.",
];

const jsonShape = `{
  "dispatchPlanId": "plan-1",
  "loadedQty": 1000,
  "allocations": [
    {
      "sourceType": "job",
      "jobId": "prod-1",
      "jobNo": "JOB-101",
      "qty": 600
    },
    {
      "sourceType": "job",
      "jobId": "prod-2",
      "jobNo": "JOB-102",
      "qty": 250
    },
    {
      "sourceType": "opening_stock",
      "sourceRef": "Opening Stock",
      "qty": 150
    }
  ]
}`;

const uiCards = [
  {
    title: "Job Allocation Table",
    description:
      "Inside the loading modal, each dispatch-plan row now supports a job-allocation table. Users can add multiple job rows, enter Adjust Now quantity against each one, and optionally add Opening Stock quantity.",
  },
  {
    title: "FFG Validation",
    description:
      "For every job row, the app reads the production's Prod (FFG) value, subtracts already-loaded quantity from previous slips, and only allows the remaining Yet to Load balance.",
  },
  {
    title: "Opening Stock Row",
    description:
      "Opening Stock is handled as a fixed separate source. It is part of the same loaded-row breakup, but it does not count toward any job's loaded total.",
  },
  {
    title: "Production Master View",
    description:
      "Production Master now shows a Loaded Qty column. This value is the sum of all loading-slip job allocations saved against that production job.",
  },
];

const validationRows = [
  {
    rule: "Loaded Qty",
    logic: "Must be greater than 0 for the dispatch-plan row.",
  },
  {
    rule: "Job Adjust Now",
    logic: "Each selected job quantity must be greater than 0.",
  },
  {
    rule: "Duplicate Job",
    logic: "The same job cannot be selected twice in the same dispatch-plan row.",
  },
  {
    rule: "FFG Cap",
    logic: "Cumulative job loading across all slips plus current adjustment must not exceed that job's Prod (FFG).",
  },
  {
    rule: "Yet to Load",
    logic: "Yet to Load is calculated as FFG minus Already Loaded and cannot become negative.",
  },
  {
    rule: "Opening Stock",
    logic: "Opening Stock quantity can be added as a separate source and is not checked against a stock cap for now.",
  },
  {
    rule: "Row Balance",
    logic: "Job total plus Opening Stock total must exactly equal the row Loaded Qty before save is allowed.",
  },
];

const reportingNotes = [
  "Loading Master shows saved breakup entries as Job No - Qty or Opening Stock - Qty.",
  "Pending Invoicing still uses line-level loadedQty for billing totals; no invoice quantity logic changed.",
  "Dashboard, Delivery Book, and Scheduled Orders Master still use line-level loadedQty for loaded and invoiced totals.",
  "Legacy loading slips that only contain old jobNos should still open safely for read-only display.",
];

export function PlansLoading() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Documentation - Loading Plan</h2>
        <p className="mt-2 text-sm text-slate-700 font-medium">
          This page explains the current Loading Slip plan with job-wise quantity breakup, Opening Stock support, and FFG-based validation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {uiCards.map((card) => (
          <div key={card.title} className="bg-white border border-black rounded shadow-sm p-5">
            <h3 className="text-sm font-black uppercase text-slate-600 mb-3">{card.title}</h3>
            <p className="text-sm text-black leading-6">{card.description}</p>
          </div>
        ))}
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Current Rules Summary</h3>
        </div>
        <div className="p-5 space-y-3">
          {summaryRules.map((rule) => (
            <div key={rule} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {rule}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">JSON Structure</h3>
        </div>
        <div className="p-5">
          <pre className="overflow-x-auto rounded border border-black bg-slate-50 p-4 text-xs leading-6 text-black">
            {jsonShape}
          </pre>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Validation Rules</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Rule</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-black border border-black">Logic</th>
              </tr>
            </thead>
            <tbody>
              {validationRows.map((row) => (
                <tr key={row.rule} className="align-top">
                  <td className="px-4 py-3 text-sm font-bold text-black border border-black bg-white">{row.rule}</td>
                  <td className="px-4 py-3 text-sm text-black border border-black bg-white leading-6">{row.logic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="bg-slate-100 border-b border-black px-5 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Reporting Impact</h3>
        </div>
        <div className="p-5 space-y-3">
          {reportingNotes.map((note) => (
            <div key={note} className="border border-black rounded px-4 py-3 bg-slate-50 text-sm text-black font-medium leading-6">
              {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
