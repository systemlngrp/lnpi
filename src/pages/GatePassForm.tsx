import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Spinner } from "../components/Spinner";
import { buildGatePassFromInvoice } from "../lib/gatePasses";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { Company, GatePass, Invoice, InvoiceLineItem, LoadingSlip, Truck } from "../types";
import { formatDate } from "../lib/serial";

type InvoiceSlipRow = LoadingSlip & {
  amount: number;
  totalQty: number;
  truckNo: string;
};

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export function GatePassForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("id") || "";
  const invoiceIdFromQuery = searchParams.get("invoiceId") || "";

  const [gatePasses, setGatePasses] = useData<GatePass>("gate_passes", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [invoiceLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [companies] = useData<Company>("companies", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const npdItems = useNpdItems();

  const editingGatePass = gatePasses.find((gatePass) => gatePass.id === editId) || null;

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<string>>(new Set());
  const [selectedTruckId, setSelectedTruckId] = useState("");
  const [date, setDate] = useState(todayValue());
  const [status, setStatus] = useState<GatePass["status"]>("Generated");
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingGatePass) {
      setSelectedInvoiceId(editingGatePass.invoiceId);
      setSelectedSlipIds(new Set(editingGatePass.loadingSlipIds || []));
      setSelectedTruckId(editingGatePass.truckId || "");
      setDate(editingGatePass.date || todayValue());
      setStatus(editingGatePass.status || "Generated");
      setRemarks(editingGatePass.remarks || "");
      return;
    }

    const initialInvoiceId =
      invoices.find((invoice) => invoice.id === invoiceIdFromQuery)?.id ||
      invoices[0]?.id ||
      "";
    setSelectedInvoiceId(initialInvoiceId);
    setDate(todayValue());
    setStatus("Generated");
    setRemarks("");
  }, [editingGatePass, invoiceIdFromQuery, invoices]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const existingGatePassForInvoice = selectedInvoiceId
    ? gatePasses.find((gatePass) => gatePass.invoiceId === selectedInvoiceId && gatePass.id !== editingGatePass?.id)
    : null;

  const availableInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) =>
          editingGatePass ? invoice.id === editingGatePass.invoiceId : !gatePasses.some((gatePass) => gatePass.invoiceId === invoice.id)
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [editingGatePass, gatePasses, invoices]
  );

  useEffect(() => {
    if (editingGatePass) return;
    if (!invoiceIdFromQuery) return;
    const existingGatePass = gatePasses.find((gatePass) => gatePass.invoiceId === invoiceIdFromQuery);
    if (existingGatePass) {
      navigate(`/gate-pass/form?id=${existingGatePass.id}`, { replace: true });
    }
  }, [editingGatePass, gatePasses, invoiceIdFromQuery, navigate]);

  const availableSlips = useMemo<InvoiceSlipRow[]>(() => {
    if (!selectedInvoice) return [];
    const relevantLineItems = invoiceLineItems.filter((line) => line.invoiceId === selectedInvoice.id);
    const slipIds = Array.from(new Set(relevantLineItems.map((line) => line.loadingSlipId).filter(Boolean)));

    return slipIds
      .map((slipId) => {
        const slip = loadingSlips.find((row) => row.id === slipId);
        if (!slip) return null;
        const slipLines = relevantLineItems.filter((line) => line.loadingSlipId === slipId);
        return {
          ...slip,
          totalQty: slipLines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
          amount: slipLines.reduce(
            (sum, line) =>
              sum + Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0),
            0
          ),
          truckNo: trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "N/A",
        };
      })
      .filter((slip): slip is InvoiceSlipRow => slip !== null);
  }, [selectedInvoice, invoiceLineItems, loadingSlips, trucks]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setSelectedSlipIds(new Set());
      return;
    }
    if (editingGatePass) return;
    setSelectedSlipIds(new Set(availableSlips.map((slip) => slip.id)));
  }, [availableSlips, editingGatePass, selectedInvoiceId]);

  const selectedCompany = companies.find((company) => company.id === selectedInvoice?.companyId) || undefined;

  const truckOptions = useMemo(() => {
    const ids = Array.from(new Set(availableSlips.map((slip) => slip.truckId).filter(Boolean)));
    return ids
      .map((id) => trucks.find((truck) => truck.id === id))
      .filter((truck): truck is Truck => Boolean(truck));
  }, [availableSlips, trucks]);

  const previewGatePass = useMemo(() => {
    if (!selectedInvoice || selectedSlipIds.size === 0) return null;
    return buildGatePassFromInvoice({
      company: selectedCompany,
      date,
      existingId: editingGatePass?.id,
      gatePassNo: editingGatePass?.gatePassNo,
      invoice: selectedInvoice,
      lineItems: invoiceLineItems,
      npdItems,
      overrideTruckId: selectedTruckId || undefined,
      remarks,
      selectedLoadingSlipIds: Array.from(selectedSlipIds),
      slips: loadingSlips,
      status,
      trucks,
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    });
  }, [
    date,
    editingGatePass?.gatePassNo,
    editingGatePass?.id,
    invoiceLineItems,
    loadingSlips,
    npdItems,
    remarks,
    selectedCompany,
    selectedInvoice,
    selectedSlipIds,
    selectedTruckId,
    status,
    trucks,
  ]);

  const handleInvoiceChange = (nextInvoiceId: string) => {
    setSelectedInvoiceId(nextInvoiceId);
    const nextSlipIds = new Set(
      invoiceLineItems
        .filter((line) => line.invoiceId === nextInvoiceId)
        .map((line) => line.loadingSlipId)
        .filter(Boolean)
    );
    setSelectedSlipIds(nextSlipIds);
    setSelectedTruckId("");
  };

  const toggleSlip = (slipId: string) => {
    setSelectedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(slipId)) next.delete(slipId);
      else next.add(slipId);
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!previewGatePass || !selectedInvoice) {
      alert("Please select an invoice and at least one loading slip.");
      return;
    }
    if (existingGatePassForInvoice) {
      alert(`This invoice already has gate pass ${existingGatePassForInvoice.gatePassNo || ""}. Only one gate pass is allowed per invoice.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: GatePass = {
        ...previewGatePass,
        id: editingGatePass?.id || previewGatePass.id,
        gatePassNo: editingGatePass?.gatePassNo || "",
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString(),
      };

      await setGatePasses((prev) =>
        editingGatePass
          ? prev.map((gatePass) => (gatePass.id === editingGatePass.id ? payload : gatePass))
          : [payload, ...prev]
      );
      navigate("/gate-pass/master");
    } catch (error) {
      console.error("Failed to save gate pass:", error);
      alert(`Failed to save gate pass: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">
            {editingGatePass ? "Edit Gate Pass" : "Gate Pass Form"}
          </h2>
          <p className="text-sm text-slate-500">
            {editingGatePass ? editingGatePass.gatePassNo || "Existing Gate Pass" : "Open the single gate pass linked to an invoice."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/gate-pass/master")}
          className="inline-flex items-center gap-2 rounded border border-black px-4 py-2 text-sm font-bold hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6 rounded border border-black bg-white p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Invoice" required>
                <select
                  value={selectedInvoiceId}
                  onChange={(e) => handleInvoiceChange(e.target.value)}
                  disabled={Boolean(editingGatePass)}
                  className="w-full rounded border border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-black disabled:bg-slate-100"
                >
                  <option value="">Select Invoice</option>
                  {availableInvoices.map((invoice) => {
                    const company = companies.find((row) => row.id === invoice.companyId);
                    return (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.invoiceNo || "Draft Invoice"} | {company?.name || "Unknown"} | {formatDate(invoice.date)}
                      </option>
                    );
                  })}
                </select>
              </Field>

              <Field label="Date" required>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
                />
              </Field>

              <Field label="Truck">
                <select
                  value={selectedTruckId}
                  onChange={(e) => setSelectedTruckId(e.target.value)}
                  className="w-full rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
                >
                  <option value="">Auto from selected loading slips</option>
                  {truckOptions.map((truck) => (
                    <option key={truck.id} value={truck.id}>
                      {truck.truckNo}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Status" required>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as GatePass["status"])}
                  className="w-full rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
                >
                  <option value="Generated">Generated</option>
                  <option value="Dispatched">Dispatched</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </Field>
            </div>

            {existingGatePassForInvoice ? (
              <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                This invoice already has gate pass {existingGatePassForInvoice.gatePassNo || "generated"}. Open that record to edit it instead of creating a new one.
              </div>
            ) : null}

            <Field label="Remarks">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Optional dispatch / transport note"
                className="w-full rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
              />
            </Field>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-black uppercase text-black">Invoice Loading Slips</div>
                <div className="text-xs font-bold text-slate-500">
                  Selected: {selectedSlipIds.size} / {availableSlips.length}
                </div>
              </div>
              <div className="overflow-hidden rounded border border-black">
                <table className="min-w-full border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="w-10 px-3 py-2"></th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Slip No</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Truck</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {availableSlips.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                          No invoice-linked loading slips found.
                        </td>
                      </tr>
                    ) : (
                      availableSlips.map((slip) => (
                        <tr key={slip.id} className="divide-x divide-black hover:bg-slate-50">
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={selectedSlipIds.has(slip.id)}
                              onChange={() => toggleSlip(slip.id)}
                              className="h-4 w-4 rounded border-black"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs font-bold">{slip.slipNo}</td>
                          <td className="px-3 py-2 text-xs">{slip.truckNo}</td>
                          <td className="px-3 py-2 text-right text-xs font-medium">{slip.totalQty.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-xs font-medium">
                            {slip.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded border border-black bg-white p-6 shadow-sm">
            <div className="text-sm font-black uppercase text-black">Preview</div>
            {!previewGatePass ? (
              <div className="rounded border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                Select an invoice and at least one loading slip to preview the gate pass.
              </div>
            ) : (
              <>
                <SummaryRow label="Gate Pass No" value={editingGatePass?.gatePassNo || "Auto-generated on save"} />
                <SummaryRow label="Invoice No" value={previewGatePass.invoiceNo || "Pending invoice number"} />
                <SummaryRow label="Company" value={previewGatePass.companyName || "-"} />
                <SummaryRow label="Truck" value={previewGatePass.truckNo || "-"} />
                <SummaryRow label="Slip Count" value={String(previewGatePass.loadingSlipIds.length)} />
                <SummaryRow label="Total Qty" value={previewGatePass.totalQty.toLocaleString()} />
                <SummaryRow
                  label="Total Amount"
                  value={previewGatePass.totalAmount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                />

                <div className="space-y-2 rounded border border-black p-3">
                  <div className="text-[10px] font-black uppercase text-slate-500">Item Breakdown</div>
                  <div className="space-y-2">
                    {previewGatePass.lines.map((line) => (
                      <div key={line.id} className="rounded border border-slate-200 px-3 py-2">
                        <div className="text-xs font-bold uppercase text-black">{line.itemName}</div>
                        <div className="text-[11px] text-slate-500">
                          Qty {line.qty.toLocaleString()} | Amount{" "}
                          {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate("/gate-pass/master")}
                className="flex-1 rounded border-2 border-black px-4 py-2 text-sm font-black uppercase hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !previewGatePass}
                className="flex-1 rounded bg-indigo-600 px-4 py-2 text-sm font-black uppercase text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmitting ? <Spinner size={16} className="text-white" /> : <span className="inline-flex items-center gap-2"><Save size={14} /> Save</span>}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  children,
  label,
  required,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <div className="text-[11px] font-black uppercase text-slate-600">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </div>
      {children}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black px-3 py-2">
      <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
      <div className="text-sm font-bold text-black">{value || "-"}</div>
    </div>
  );
}
