import { useNavigate } from "react-router-dom";
import { Eye, FilePlus2, Pencil, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { GatePass } from "../types";
import { formatDate } from "../lib/serial";

export function GatePassMaster() {
  const navigate = useNavigate();
  const [gatePasses] = useData<GatePass>("gate_passes", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGatePassId, setSelectedGatePassId] = useState<string | null>(null);

  const filteredGatePasses = useMemo(
    () =>
      [...gatePasses]
        .filter((gatePass) => {
          const haystack = [
            gatePass.gatePassNo,
            gatePass.invoiceNo,
            gatePass.companyName,
            gatePass.truckNo,
            gatePass.status,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchTerm.toLowerCase());
        })
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
          return timeB - timeA;
        }),
    [gatePasses, searchTerm]
  );

  const selectedGatePass = filteredGatePasses.find((gatePass) => gatePass.id === selectedGatePassId) || null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Gate Pass Master</h2>
          <p className="text-sm text-slate-500">View and update the single gate pass generated for each invoice.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/gate-pass/form")}
          className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 font-bold text-white transition hover:bg-indigo-700"
        >
          <FilePlus2 size={16} />
          Open Gate Pass Form
        </button>
      </div>

      <div className="rounded border border-black bg-white p-4 shadow-sm">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search gate pass no, invoice no, company, truck..."
          className="w-full max-w-xl rounded border border-black px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
        />
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100">
            <tr className="divide-x divide-black">
              {["Gate Pass No", "Date", "Invoice No", "Company", "Truck", "Total Qty", "Total Amount", "Status", "Actions"].map(
                (heading) => (
                  <th key={heading} className="border-b border-black px-4 py-3 text-left text-xs font-black uppercase text-black">
                    {heading}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredGatePasses.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-sm text-slate-500">
                  No gate passes found.
                </td>
              </tr>
            ) : (
              filteredGatePasses.map((gatePass) => (
                <tr key={gatePass.id} className="divide-x divide-black hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-bold text-black">{gatePass.gatePassNo || "Pending"}</td>
                  <td className="px-4 py-3 text-sm text-black">{formatDate(gatePass.date)}</td>
                  <td className="px-4 py-3 text-sm text-black">{gatePass.invoiceNo}</td>
                  <td className="px-4 py-3 text-sm text-black">{gatePass.companyName}</td>
                  <td className="px-4 py-3 text-sm text-black">{gatePass.truckNo || "-"}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-black">{gatePass.totalQty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-black">
                    {gatePass.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-indigo-700">{gatePass.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedGatePassId(gatePass.id)}
                        className="rounded border border-black p-2 text-black hover:bg-slate-100"
                        title="View"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/gate-pass/form?id=${gatePass.id}`)}
                        className="rounded border border-black p-2 text-black hover:bg-slate-100"
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedGatePass ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded border border-black bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-black bg-slate-900 px-6 py-4 text-white">
              <div>
                <h3 className="text-xl font-black">{selectedGatePass.gatePassNo || "Gate Pass"}</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Invoice {selectedGatePass.invoiceNo} | {selectedGatePass.companyName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGatePassId(null)}
                className="rounded border border-white/20 p-2 hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-4">
                <InfoCard label="Date" value={formatDate(selectedGatePass.date)} />
                <InfoCard label="Truck" value={selectedGatePass.truckNo || "-"} />
                <InfoCard label="Status" value={selectedGatePass.status} />
                <InfoCard
                  label="Total Amount"
                  value={selectedGatePass.totalAmount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                />
              </div>

              <div className="rounded border border-black p-4">
                <div className="text-xs font-black uppercase text-slate-500">Linked Loading Slips</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedGatePass.loadingSlipNos.length === 0 ? (
                    <div className="text-sm text-slate-500">No loading slips linked.</div>
                  ) : (
                    selectedGatePass.loadingSlipNos.map((slipNo) => (
                      <span key={slipNo} className="rounded border border-black px-3 py-1 text-xs font-bold">
                        {slipNo}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded border border-black">
                <table className="min-w-full border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      {["Item", "Qty", "Rate", "Amount", "Slip Nos"].map((heading) => (
                        <th key={heading} className="border-b border-black px-3 py-2 text-left text-[10px] font-black uppercase">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {selectedGatePass.lines.map((line) => (
                      <tr key={line.id} className="divide-x divide-black">
                        <td className="px-3 py-2 text-xs font-bold uppercase">{line.itemName}</td>
                        <td className="px-3 py-2 text-right text-xs">{line.qty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-xs">{Number(line.rate || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-xs">{line.loadingSlipNos.join(", ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded border border-black p-4">
                <div className="text-xs font-black uppercase text-slate-500">Remarks</div>
                <div className="mt-2 text-sm text-black">{selectedGatePass.remarks || "-"}</div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => navigate(`/gate-pass/form?id=${selectedGatePass.id}`)}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-black uppercase text-white hover:bg-indigo-700"
                >
                  Edit Gate Pass
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black bg-slate-50 px-4 py-3">
      <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-black">{value || "-"}</div>
    </div>
  );
}
