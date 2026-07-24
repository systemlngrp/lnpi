import { ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useData } from "../hooks/useData";
import { buildGatePassFromInvoice } from "../lib/gatePasses";
import { Company, GatePass, GatePassLine, Invoice, InvoiceLineItem, LoadingSlip, Supplier, Truck, UnitMaster, User } from "../types";
import { formatDate } from "../lib/serial";

type InvoiceSlipRow = LoadingSlip & {
  amount: number;
  totalQty: number;
  truckNo: string;
};

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function createBlankLine(): GatePassLine {
  return {
    id: crypto.randomUUID(),
    itemName: "",
    itemDescription: "",
    qty: 0,
    uom: "PCS",
    rate: 0,
    amount: 0,
    loadingSlipIds: [],
    loadingSlipNos: [],
  };
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
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [users] = useData<User>("users", []);
  const [units] = useData<UnitMaster>("units", []);
  const [npdItems] = useData<any>("npd", []);

  const editingGatePass = gatePasses.find((row) => row.id === editId) || null;
  const gatePassType = (editingGatePass?.gatePassType || (invoiceIdFromQuery ? "Non-Returnable" : "Returnable")) as "Non-Returnable" | "Returnable";
  const isReturnable = gatePassType === "Returnable";

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<string>>(new Set());
  const [selectedTruckId, setSelectedTruckId] = useState("");
  const [date, setDate] = useState(todayValue());
  const [remarks, setRemarks] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [sentByUserId, setSentByUserId] = useState("");
  const [returnableLines, setReturnableLines] = useState<GatePassLine[]>([createBlankLine()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editingGatePass) {
      setSelectedInvoiceId(editingGatePass.invoiceId || "");
      setSelectedSlipIds(new Set(editingGatePass.loadingSlipIds || []));
      setSelectedTruckId(editingGatePass.truckId || "");
      setDate(editingGatePass.date || todayValue());
      setRemarks(editingGatePass.remarks || "");
      setRecipientId(editingGatePass.recipientId || "");
      setSentByUserId(editingGatePass.sentByUserId || "");
      setReturnableLines(
        editingGatePass.lines?.length
          ? editingGatePass.lines.map((line) => ({
              ...line,
              uom: String(line.uom || "PCS").trim() || "PCS",
              rate: 0,
              amount: 0,
              loadingSlipIds: [],
              loadingSlipNos: [],
            }))
          : [createBlankLine()]
      );
      return;
    }

    setSelectedInvoiceId(invoiceIdFromQuery);
    setSelectedSlipIds(new Set());
    setSelectedTruckId("");
    setDate(todayValue());
    setRemarks("");
    setRecipientId("");
    setSentByUserId("");
    setReturnableLines([createBlankLine()]);
  }, [editingGatePass, invoiceIdFromQuery]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const selectedCompany = companies.find((company) => company.id === selectedInvoice?.companyId);

  const availableInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => editingGatePass ? invoice.id === editingGatePass.invoiceId : !gatePasses.some((gatePass) => gatePass.invoiceId === invoice.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [editingGatePass, gatePasses, invoices]
  );

  const availableSlips = useMemo<InvoiceSlipRow[]>(() => {
    if (!selectedInvoice) return [];
    const relevantLineItems = invoiceLineItems.filter((line) => line.invoiceId === selectedInvoice.id);
    const slipIds = Array.from(new Set(relevantLineItems.map((line) => line.loadingSlipId).filter(Boolean)));
    return slipIds.map((slipId) => {
      const slip = loadingSlips.find((row) => row.id === slipId);
      if (!slip) return null;
      const slipLines = relevantLineItems.filter((line) => line.loadingSlipId === slipId);
      return {
        ...slip,
        totalQty: slipLines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
        amount: slipLines.reduce((sum, line) => sum + Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0), 0),
        truckNo: slip.truckNo || trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "-",
      };
    }).filter((row): row is InvoiceSlipRow => Boolean(row));
  }, [invoiceLineItems, loadingSlips, selectedInvoice, trucks]);

  useEffect(() => {
    if (isReturnable || editingGatePass || !selectedInvoiceId) return;
    setSelectedSlipIds(new Set(availableSlips.map((slip) => slip.id)));
  }, [availableSlips, editingGatePass, isReturnable, selectedInvoiceId]);

  const truckOptions = useMemo(() => {
    const ids = Array.from(new Set(availableSlips.map((slip) => slip.truckId).filter(Boolean)));
    return ids.map((id) => trucks.find((truck) => truck.id === id)).filter((row): row is Truck => Boolean(row));
  }, [availableSlips, trucks]);

  const previewGatePass = useMemo(() => {
    if (isReturnable || !selectedInvoice || selectedSlipIds.size === 0) return null;
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
      trucks,
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    });
  }, [date, editingGatePass?.gatePassNo, editingGatePass?.id, invoiceLineItems, isReturnable, loadingSlips, npdItems, remarks, selectedCompany, selectedInvoice, selectedSlipIds, selectedTruckId, trucks]);

  const recipientOptions = useMemo(() => {
    const rows = [
      ...suppliers.filter((entry) => entry.active !== "No").map((entry) => ({ value: entry.id, label: `${entry.name} (Supplier)` })),
      ...companies.map((entry) => ({ value: entry.id, label: `${entry.name} (Customer)` })),
    ];
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [companies, suppliers]);

  const userOptions = useMemo(
    () => [...users].filter((user) => user.status !== "Inactive").sort((a, b) => a.name.localeCompare(b.name)).map((user) => ({ value: user.id, label: user.name })),
    [users]
  );

  const unitOptions = useMemo(
    () => [...units].filter((unit) => unit.active !== "No").sort((a, b) => a.name.localeCompare(b.name)).map((unit) => ({ value: unit.name, label: unit.name })),
    [units]
  );

  const handleInvoiceChange = (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setSelectedSlipIds(new Set(invoiceLineItems.filter((line) => line.invoiceId === invoiceId).map((line) => line.loadingSlipId).filter(Boolean)));
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

  const updateReturnableLine = (lineId: string, patch: Partial<GatePassLine>) => {
    setReturnableLines((prev) => prev.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  };

  const addReturnableLine = () => setReturnableLines((prev) => [...prev, createBlankLine()]);
  const removeReturnableLine = (lineId: string) => setReturnableLines((prev) => prev.length === 1 ? prev : prev.filter((line) => line.id !== lineId));

  const buildReturnableGatePass = (): GatePass | null => {
    const recipientSupplier = suppliers.find((row) => row.id === recipientId);
    const recipientCompany = companies.find((row) => row.id === recipientId);
    const sentByUser = users.find((row) => row.id === sentByUserId);
    const normalizedLines = returnableLines
      .map((line) => {
        const qty = Number(line.qty || 0);
        const itemDescription = String(line.itemDescription || line.itemName || "").trim();
        const uom = String(line.uom || "PCS").trim() || "PCS";
        return {
          ...line,
          itemName: itemDescription,
          itemDescription,
          qty,
          uom,
          rate: 0,
          amount: 0,
          loadingSlipIds: [],
          loadingSlipNos: [],
        };
      })
      .filter((line) => line.itemDescription && Number(line.qty || 0) > 0);

    if ((!recipientSupplier && !recipientCompany) || !sentByUser || normalizedLines.length === 0) return null;

    return {
      id: editingGatePass?.id || crypto.randomUUID(),
      gatePassNo: editingGatePass?.gatePassNo || "",
      date,
      gatePassType: "Returnable",
      invoiceId: undefined,
      invoiceNo: undefined,
      companyId: undefined,
      companyName: undefined,
      recipientId,
      recipientName: recipientSupplier?.name || recipientCompany?.name || "",
      recipientType: recipientSupplier ? "Supplier" : "Customer",
      sentByUserId,
      sentByUserName: sentByUser.name,
      truckId: selectedTruckId || undefined,
      truckNo: trucks.find((truck) => truck.id === selectedTruckId)?.truckNo || undefined,
      loadingSlipIds: [],
      loadingSlipNos: [],
      remarks: remarks || "",
      clearOffReason: editingGatePass?.clearOffReason,
      clearedOffAt: editingGatePass?.clearedOffAt,
      clearedOffBy: editingGatePass?.clearedOffBy,
      totalQty: normalizedLines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
      totalAmount: 0,
      lines: normalizedLines,
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = isReturnable ? buildReturnableGatePass() : previewGatePass;
      if (!payload) {
        alert(isReturnable ? "Please fill recipient, sent by, and valid item rows." : "Please select invoice and loading slips.");
        return;
      }
      await setGatePasses((prev) => editingGatePass ? prev.map((row) => row.id === editingGatePass.id ? payload : row) : [payload, ...prev]);
      navigate("/gate-pass/master");
    } catch (error) {
      console.error("Failed to save gate pass:", error);
      alert("Failed to save gate pass.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">{editingGatePass ? "Edit Gate Pass" : isReturnable ? "Returnable Gate Pass Form" : "Gate Pass Form"}</h2>
          <p className="text-sm text-slate-500">{isReturnable ? "Manual gate pass for items going out on returnable basis." : "Invoice-linked non-returnable gate pass."}</p>
        </div>
        <button type="button" onClick={() => navigate("/gate-pass/master")} className="inline-flex items-center gap-2 rounded border border-black px-4 py-2 text-sm font-bold hover:bg-slate-50">
          <ArrowLeft size={16} />
          Back
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className={`grid gap-6 ${isReturnable ? "" : "lg:grid-cols-[1.4fr_1fr]"}`}>
          <div className="space-y-6 rounded border border-black bg-white p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Gate Pass Type" required>
                <input value={gatePassType} disabled className="w-full rounded border border-black px-3 py-2 text-sm bg-slate-50" />
              </Field>
              <Field label="Date" required>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full rounded border border-black px-3 py-2 text-sm" />
              </Field>

              {isReturnable ? (
                <>
                  <Field label="Recipient" required>
                    <Select value={recipientId} onChange={setRecipientId} options={recipientOptions} placeholder="Select supplier / customer..." />
                  </Field>
                  <Field label="Sent By" required>
                    <Select value={sentByUserId} onChange={setSentByUserId} options={userOptions} placeholder="Select user..." />
                  </Field>
                  <Field label="Truck">
                    <select value={selectedTruckId} onChange={(e) => setSelectedTruckId(e.target.value)} className="w-full rounded border border-black px-3 py-2 text-sm">
                      <option value="">Select Truck</option>
                      {trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.truckNo}</option>)}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Invoice" required>
                    <select value={selectedInvoiceId} onChange={(e) => handleInvoiceChange(e.target.value)} disabled={Boolean(editingGatePass)} className="w-full rounded border border-black px-3 py-2 text-sm disabled:bg-slate-100">
                      <option value="">Select Invoice</option>
                      {availableInvoices.map((invoice) => {
                        const company = companies.find((row) => row.id === invoice.companyId);
                        return <option key={invoice.id} value={invoice.id}>{invoice.invoiceNo} | {company?.name || "Unknown"} | {formatDate(invoice.date)}</option>;
                      })}
                    </select>
                  </Field>
                  <Field label="Truck">
                    <select value={selectedTruckId} onChange={(e) => setSelectedTruckId(e.target.value)} className="w-full rounded border border-black px-3 py-2 text-sm">
                      <option value="">Auto-select from loading slips</option>
                      {truckOptions.map((truck) => <option key={truck.id} value={truck.id}>{truck.truckNo}</option>)}
                    </select>
                  </Field>
                </>
              )}

              <Field label="Remarks" className="md:col-span-2">
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className="w-full rounded border border-black px-3 py-2 text-sm" />
              </Field>
            </div>

            {isReturnable ? (
              <div className="space-y-4 rounded border border-black p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold uppercase text-slate-500">Items</div>
                  <button type="button" onClick={addReturnableLine} className="inline-flex items-center gap-2 rounded border border-black px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                    <Plus size={15} />
                    Add Line
                  </button>
                </div>
                <div className="space-y-3">
                  {returnableLines.map((line) => (
                    <div key={line.id} className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-[minmax(0,2fr)_100px_120px_48px]">
                      <input value={line.itemDescription || ""} onChange={(e) => updateReturnableLine(line.id, { itemDescription: e.target.value, itemName: e.target.value })} placeholder="Item description" className="rounded border border-black px-3 py-2 text-sm" />
                      <input type="number" min="0" step="0.01" value={line.qty || ""} onChange={(e) => updateReturnableLine(line.id, { qty: Number(e.target.value || 0) })} placeholder="Qty" className="rounded border border-black px-3 py-2 text-sm" />
                      <div className="w-[120px]">
                        <Select value={line.uom || "PCS"} onChange={(value) => updateReturnableLine(line.id, { uom: value || "PCS" })} options={unitOptions} placeholder="UOM" />
                      </div>
                      <button type="button" onClick={() => removeReturnableLine(line.id)} className="rounded border border-red-300 text-red-700 hover:bg-red-50">
                        <Trash2 size={16} className="mx-auto" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded border border-black p-4">
                <div className="mb-3 text-sm font-bold uppercase text-slate-500">Linked Loading Slips</div>
                <div className="space-y-3">
                  {availableSlips.map((slip) => (
                    <label key={slip.id} className="flex items-start gap-3 rounded border border-slate-200 px-3 py-3">
                      <input type="checkbox" checked={selectedSlipIds.has(slip.id)} onChange={() => toggleSlip(slip.id)} className="mt-1" />
                      <div className="space-y-1 text-sm">
                        <div className="font-bold text-black">{slip.slipNo}</div>
                        <div className="text-slate-600">Truck {slip.truckNo} | Qty {slip.totalQty.toLocaleString()} | Amount {slip.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!isReturnable ? (
            <div className="space-y-4 rounded border border-black bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Preview</h3>
              {previewGatePass ? (
                <div className="space-y-3 text-sm">
                  <SummaryRow label="Tally Invoice No" value={selectedInvoice?.tallyInvNo || "Tally Invoice Pending"} />
                  <SummaryRow label="Company" value={previewGatePass.companyName || "-"} />
                  <SummaryRow label="Truck" value={previewGatePass.truckNo || "-"} />
                  <SummaryRow label="Destination" value={selectedInvoice?.destination || "-"} />
                  <SummaryRow label="Transporter" value={selectedInvoice?.transporter || "-"} />
                  <SummaryRow label="Total Qty" value={previewGatePass.totalQty.toLocaleString()} />
                  <SummaryRow label="Total Invoice Amount" value={previewGatePass.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                </div>
              ) : (
                <div className="text-sm text-slate-500">Select invoice and loading slips to preview.</div>
              )}

              <button type="submit" disabled={isSubmitting} className="inline-flex w-full items-center justify-center gap-2 rounded bg-indigo-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50">
                {isSubmitting ? <Spinner size={18} className="text-white" /> : <Save size={16} />}
                {editingGatePass ? "Update Gate Pass" : "Save Gate Pass"}
              </button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="submit" disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded bg-indigo-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50">
                {isSubmitting ? <Spinner size={18} className="text-white" /> : <Save size={16} />}
                {editingGatePass ? "Update Gate Pass" : "Save Gate Pass"}
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className || ""}>
      <label className="mb-2 block text-sm font-bold text-black">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2">
      <span className="font-semibold text-slate-600">{label}</span>
      <span className="text-right font-bold text-black">{value}</span>
    </div>
  );
}
