import { useMemo, useState } from "react";
import { Download, Eye, FilePlus2, Pencil, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { downloadGatePassPdf } from "../lib/gatePassPdf";
import { deriveGatePassState, getGatePassLinesWithReturns, getGatePassPrimaryPartyName, isReturnableGatePass } from "../lib/gatePassState";
import { GatePass, Invoice, MaterialIn, Setting } from "../types";
import { formatDate } from "../lib/serial";

export function GatePassMaster() {
  const navigate = useNavigate();
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [settings] = useData<Setting>("settings", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGatePassId, setSelectedGatePassId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const getLinkedInvoice = (gatePass: GatePass) =>
    gatePass.invoiceId ? invoices.find((invoice) => invoice.id === gatePass.invoiceId) || null : null;

  const getGatePassInvoiceDisplayNo = (gatePass: GatePass) => {
    if (isReturnableGatePass(gatePass)) return getGatePassPrimaryPartyName(gatePass);
    return getLinkedInvoice(gatePass)?.tallyInvNo || "Tally Invoice Pending";
  };

  const canDownloadGatePassPdf = (gatePass: GatePass) => {
    if (isReturnableGatePass(gatePass)) return true;
    return Boolean(getLinkedInvoice(gatePass)?.tallyInvNo);
  };

  const filteredGatePasses = useMemo(
    () =>
      [...gatePasses]
        .filter((gatePass) => {
          const haystack = [
            gatePass.gatePassNo,
            gatePass.invoiceNo,
            getLinkedInvoice(gatePass)?.tallyInvNo,
            getGatePassPrimaryPartyName(gatePass),
            gatePass.truckNo,
            gatePass.gatePassType,
            isReturnableGatePass(gatePass) ? deriveGatePassState(gatePass, materialIn) : "",
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchTerm.toLowerCase());
        })
        .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime()),
    [gatePasses, invoices, materialIn, searchTerm]
  );

  const selectedGatePass = filteredGatePasses.find((gatePass) => gatePass.id === selectedGatePassId) || null;

  const handleDownloadPdf = async (gatePass: GatePass) => {
    if (!canDownloadGatePassPdf(gatePass)) {
      alert("PDF is available only after Tally invoice number is generated.");
      return;
    }
    setIsDownloading(gatePass.id);
    try {
      await downloadGatePassPdf({
        gatePass,
        setting: settings[0],
        invoiceDisplayNo: isReturnableGatePass(gatePass) ? undefined : getLinkedInvoice(gatePass)?.tallyInvNo || "-",
      });
    } catch (error) {
      console.error("Failed to generate Gate Pass PDF:", error);
      alert("Failed to generate Gate Pass PDF.");
    } finally {
      setIsDownloading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Gate Pass Master</h2>
          <p className="text-sm text-slate-500">Both invoice-linked non-returnable and manual returnable gate passes are managed here.</p>
        </div>
        <button type="button" onClick={() => navigate("/gate-pass/form")} className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 font-bold text-white transition hover:bg-indigo-700">
          <FilePlus2 size={16} />
          New Returnable Gate Pass
        </button>
      </div>

      <div className="rounded border border-black bg-white p-4 shadow-sm">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search gate pass no, invoice no, recipient/company, truck..." className="w-full max-w-xl rounded border border-black px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black" />
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100">
            <tr className="divide-x divide-black">
              {["Gate Pass No", "Type", "Date", "Invoice / Recipient", "Truck", "Total Qty", "Total Amount", "Derived State", "Actions"].map((heading) => (
                <th key={heading} className="border-b border-black px-4 py-3 text-left text-xs font-black uppercase text-black">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredGatePasses.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-sm text-slate-500">No gate passes found.</td>
              </tr>
            ) : (
              filteredGatePasses.map((gatePass) => (
                <tr key={gatePass.id} className="divide-x divide-black hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-bold text-black">{gatePass.gatePassNo || "Pending"}</td>
                  <td className="px-4 py-3 text-sm text-black">{gatePass.gatePassType || "Non-Returnable"}</td>
                  <td className="px-4 py-3 text-sm text-black">{formatDate(gatePass.date)}</td>
                  <td className="px-4 py-3 text-sm text-black">{getGatePassInvoiceDisplayNo(gatePass)}</td>
                  <td className="px-4 py-3 text-sm text-black">{gatePass.truckNo || "-"}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-black">{Number(gatePass.totalQty || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-black">{Number(gatePass.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-sm font-bold text-indigo-700">{isReturnableGatePass(gatePass) ? deriveGatePassState(gatePass, materialIn) : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setSelectedGatePassId(gatePass.id)} className="rounded border border-black p-2 text-black hover:bg-slate-100" title="View">
                        <Eye size={15} />
                      </button>
                      <button type="button" onClick={() => navigate(`/gate-pass/form?id=${gatePass.id}`)} className="rounded border border-black p-2 text-black hover:bg-slate-100" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => handleDownloadPdf(gatePass)} disabled={isDownloading === gatePass.id || !canDownloadGatePassPdf(gatePass)} className="rounded border border-black p-2 text-black hover:bg-slate-100 disabled:opacity-50" title={canDownloadGatePassPdf(gatePass) ? "Download PDF" : "PDF available after Tally invoice number is generated"}>
                        {isDownloading === gatePass.id ? <span className="text-xs font-bold">...</span> : <Download size={15} />}
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
                <p className="mt-1 text-sm text-slate-300">{selectedGatePass.gatePassType || "Non-Returnable"} | {getGatePassPrimaryPartyName(selectedGatePass)}</p>
              </div>
              <button type="button" onClick={() => setSelectedGatePassId(null)} className="rounded border border-white/20 p-2 hover:bg-white/10">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-4">
                <InfoCard label="Date" value={formatDate(selectedGatePass.date)} />
                <InfoCard label="Truck" value={selectedGatePass.truckNo || "-"} />
                <InfoCard label="Type" value={selectedGatePass.gatePassType || "Non-Returnable"} />
                <InfoCard label="Derived State" value={isReturnableGatePass(selectedGatePass) ? deriveGatePassState(selectedGatePass, materialIn) : "-"} />
              </div>

              {!isReturnableGatePass(selectedGatePass) && (
                <div className="grid gap-4 md:grid-cols-3">
                  <InfoCard label="Tally Invoice No" value={getLinkedInvoice(selectedGatePass)?.tallyInvNo || "Tally Invoice Pending"} />
                  <InfoCard label="Tally Invoice Date" value={getLinkedInvoice(selectedGatePass)?.tallyInvDate ? formatDate(getLinkedInvoice(selectedGatePass)?.tallyInvDate || "") : "-"} />
                  <InfoCard label="Tally Status" value={getLinkedInvoice(selectedGatePass)?.tallySyncRemark || "Pending Tally Sync"} />
                </div>
              )}

              <div className="overflow-hidden rounded border border-black">
                <table className="min-w-full border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      {(isReturnableGatePass(selectedGatePass)
                        ? ["Item", "Qty", "Returned Qty", "Pending Qty", "UOM"]
                        : ["Item", "Qty", "Rate", "Amount", "Loading Slip Nos"]
                      ).map((heading) => (
                        <th key={heading} className="border-b border-black px-3 py-2 text-left text-[10px] font-black uppercase">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {(isReturnableGatePass(selectedGatePass) ? getGatePassLinesWithReturns(selectedGatePass, materialIn) : selectedGatePass.lines).map((line: any) => (
                      <tr key={line.id} className="divide-x divide-black">
                        <td className="px-3 py-2 text-xs font-bold">{line.itemDescription || line.itemName}</td>
                        <td className="px-3 py-2 text-right text-xs">{Number(line.qty || 0).toLocaleString()}</td>
                        {isReturnableGatePass(selectedGatePass) ? (
                          <>
                            <td className="px-3 py-2 text-right text-xs">{Number(line.returnedQty || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-xs font-bold text-amber-700">{Number(line.pendingQty || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-xs">{line.uom || "-"}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right text-xs">{Number(line.rate || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-xs">{Number(line.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-3 py-2 text-xs">{(line.loadingSlipNos || []).join(", ") || "-"}</td>
                          </>
                        )}
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
                <button type="button" onClick={() => handleDownloadPdf(selectedGatePass)} disabled={isDownloading === selectedGatePass.id || !canDownloadGatePassPdf(selectedGatePass)} className="rounded border-2 border-black px-4 py-2 text-sm font-black uppercase hover:bg-slate-50 disabled:opacity-50" title={canDownloadGatePassPdf(selectedGatePass) ? "Download PDF" : "PDF available after Tally invoice number is generated"}>
                  {isDownloading === selectedGatePass.id ? "Generating PDF..." : "Download PDF"}
                </button>
                <button type="button" onClick={() => navigate(`/gate-pass/form?id=${selectedGatePass.id}`)} className="rounded bg-indigo-600 px-4 py-2 text-sm font-black uppercase text-white hover:bg-indigo-700">
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
