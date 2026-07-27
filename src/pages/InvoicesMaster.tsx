import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Invoice,
  InvoiceLineItem,
  GatePass,
  Company,
  LoadingSlip,
  Truck,
  DispatchPlan,
  Order,
  Setting,
} from "../types";
import {
  Search,
  Receipt,
  ChevronRight,
  ChevronDown,
  X,
  FileText,
  Truck as TruckIcon,
  Pencil,
} from "lucide-react";
import { formatDate } from "../lib/serial";
import { ClientPagination } from "../components/ClientPagination";
import { Select } from "../components/Select";
import { useClientPagination } from "../hooks/useClientPagination";

type InvoiceDetailRow = {
  id: string;
  itemId: string;
  itemName: string;
  erp: string;
  slipNo: string;
  truckNo: string;
  qty: number;
  rate: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
};

function getInvoiceSortValue(invoiceNo: string) {
  const raw = String(invoiceNo || "").trim();
  if (!raw) return { prefix: "", numeric: -1, raw: "" };
  const match = raw.match(/^(.*?)(\d+)$/);
  if (!match) {
    return { prefix: raw.toLowerCase(), numeric: -1, raw: raw.toLowerCase() };
  }
  return {
    prefix: String(match[1] || "").toLowerCase(),
    numeric: Number(match[2] || 0),
    raw: raw.toLowerCase(),
  };
}

export function InvoicesMaster() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invoices, setInvoices] = useData<Invoice>("invoices", []);
  const [settings] = useData<Setting>("settings", []);
  const [lineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const [slips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ invoiceNo: "", tallyInvNo: "" });
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  const currentSetting = settings[0];
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const isPankajUser = currentUserEmail === "pankaj@bizskilledu.com";
  const allowedInvoiceEditUsers = useMemo(() => {
    if (!currentSetting?.allowInvoiceTallyEditUsers) return [] as string[];
    try {
      const parsed = JSON.parse(currentSetting.allowInvoiceTallyEditUsers);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    } catch {
      return [];
    }
  }, [currentSetting?.allowInvoiceTallyEditUsers]);
  const canEditInvoiceFields =
    currentSetting?.allowInvoiceTallyEdit === "Yes" &&
    Boolean(currentUserEmail) &&
    allowedInvoiceEditUsers.includes(currentUserEmail);
  const canFullEditInvoice = (invoice: Invoice | null | undefined) =>
    Boolean(invoice) && (isPankajUser || !invoice.tallyTimestamp);

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const getRoundOff = (invoice: Invoice) => Number(invoice.roundOff || 0);
  const getOtherCharges = (invoice: Invoice) => Number(invoice.otherCharges || 0);
  const getOtherChargesGstRate = (invoice: Invoice) => Number(invoice.otherChargesGstRate || 0);
  const hasTaxableOtherCharges = (invoice: Invoice) => getOtherCharges(invoice) !== 0 && getOtherChargesGstRate(invoice) > 0;
  const getOtherChargesGstTotal = (invoice: Invoice) =>
    Number(invoice.otherChargesCgst || 0) + Number(invoice.otherChargesSgst || 0) + Number(invoice.otherChargesIgst || 0);
  const getGstTotal = (invoice: Invoice) =>
    Number(invoice.cgst || 0) + Number(invoice.sgst || 0) + Number(invoice.igst || 0);
  const getGrandTotal = (invoice: Invoice) =>
    Number(invoice.totalAfterGst || 0) + (hasTaxableOtherCharges(invoice) ? 0 : getOtherCharges(invoice)) + getRoundOff(invoice);

  const getInvoiceSlips = (invoiceId: string) =>
    slips.filter((slip) => slip.invoiceId === invoiceId && slip.status !== "Cancelled");

  const resolveInvoiceLineItemMasterId = (line: InvoiceLineItem) =>
    String(line.npdId || line.itemId || "").trim();

  const buildInvoiceDetails = (invoice: Invoice): InvoiceDetailRow[] => {
    const invLines = lineItems.filter((line) => line.invoiceId === invoice.id);
    const invoiceSlips = getInvoiceSlips(invoice.id);

    const storedLineQueues = new Map<string, InvoiceLineItem[]>();
    const storedSlipQueues = new Map<string, InvoiceLineItem[]>();

    invLines.forEach((line) => {
      const masterId = resolveInvoiceLineItemMasterId(line);
      const exactKey = `${String(line.loadingSlipId || "").trim()}__${masterId}`;
      if (!storedLineQueues.has(exactKey)) storedLineQueues.set(exactKey, []);
      storedLineQueues.get(exactKey)!.push(line);

      const slipKey = String(line.loadingSlipId || "").trim();
      if (!storedSlipQueues.has(slipKey)) storedSlipQueues.set(slipKey, []);
      storedSlipQueues.get(slipKey)!.push(line);
    });

    if (invoiceSlips.length > 0) {
      const derivedRows = invoiceSlips.flatMap((slip) => {
        const truck = trucks.find((row) => row.id === slip.truckId);
        return (slip.lines || []).map((slipLine: any, index: number) => {
          const plan = dispatchPlans.find((row) => row.id === slipLine.dispatchPlanId);
          const order = orders.find((row) => row.id === plan?.orderId);
          let masterId = String(order?.itemId || slipLine.itemId || "").trim();

          const exactKey = `${slip.id}__${masterId}`;
          let storedLine = masterId ? storedLineQueues.get(exactKey)?.shift() : undefined;
          if (!storedLine) {
            storedLine = storedSlipQueues.get(slip.id)?.shift();
            if (storedLine && !masterId) masterId = resolveInvoiceLineItemMasterId(storedLine);
          }

          const item = npdItems.find((row) => row.id === masterId);
          const qty = Number(slipLine.loadedQty || storedLine?.qty || 0);
          const rate = Number(storedLine?.rate ?? order?.rate ?? 0);
          const amountFromLine = Number(storedLine?.amount || 0);
          const amount = amountFromLine > 0 ? amountFromLine : qty * rate;

          return {
            id: storedLine?.id || `${slip.id}-${index}-${masterId || "line"}`,
            itemId: masterId,
            itemName: item?.name || slipLine.itemName || order?.poNumber || "Unknown",
            erp: String(order?.erpCode || slipLine.erpCode || (item as any)?.erp || "").trim(),
            slipNo: slip.slipNo || `Slip ${index + 1}`,
            truckNo: slip.truckNo || truck?.truckNo || "N/A",
            qty,
            rate,
            gstRate: Number(storedLine?.gstRate ?? invoice.gstRate ?? 0),
            cgst: Number(storedLine?.cgst || 0),
            sgst: Number(storedLine?.sgst || 0),
            igst: Number(storedLine?.igst || 0),
            amount,
          };
        });
      });

      if (derivedRows.length > 0) return derivedRows;
    }

    return invLines.map((line, index) => {
      const masterId = resolveInvoiceLineItemMasterId(line);
      const item = npdItems.find((row) => row.id === masterId);
      const slip = slips.find((row) => row.id === line.loadingSlipId);
      const truck = trucks.find((row) => row.id === slip?.truckId);
      return {
        id: line.id || `${invoice.id}-${index}`,
        itemId: masterId,
        itemName: item?.name || "Unknown",
        erp: String((item as any)?.erp || "").trim(),
        slipNo: slip?.slipNo || "N/A",
        truckNo: slip.truckNo || truck?.truckNo || "N/A",
        qty: Number(line.qty || 0),
        rate: Number(line.rate || 0),
        gstRate: Number(line.gstRate || invoice.gstRate || 0),
        cgst: Number(line.cgst || 0),
        sgst: Number(line.sgst || 0),
        igst: Number(line.igst || 0),
        amount: Number(line.amount || 0),
      };
    });
  };

  const openGatePass = (invoiceId: string) => {
    const existingGatePass = gatePasses.find((gatePass) => gatePass.invoiceId === invoiceId);
    navigate(existingGatePass ? `/gate-pass/form?id=${existingGatePass.id}` : `/gate-pass/form?invoiceId=${invoiceId}`);
  };

  const openInvoiceEditor = (invoiceId: string) => {
    const invoice = invoices.find((row) => row.id === invoiceId);
    if (!canFullEditInvoice(invoice)) return;
    navigate(`/billing/pending?editInvoiceId=${encodeURIComponent(invoiceId)}`);
  };

  const startInlineEdit = (invoice: Invoice) => {
    setEditingInvoiceId(invoice.id);
    setEditDraft({
      invoiceNo: String(invoice.invoiceNo || ""),
      tallyInvNo: String(invoice.tallyInvNo || ""),
    });
  };

  const cancelInlineEdit = () => {
    setEditingInvoiceId(null);
    setEditDraft({ invoiceNo: "", tallyInvNo: "" });
    setSavingEditId(null);
  };

  const saveInlineEdit = async (invoice: Invoice) => {
    const nextInvoiceNo = editDraft.invoiceNo.trim();
    const nextTallyInvNo = editDraft.tallyInvNo.trim();
    const baseInvoice = invoices.find((row) => row.id === invoice.id) || invoice;

    if (!nextInvoiceNo) {
      alert("Invoice number cannot be blank.");
      return;
    }

    const duplicateInvoice = invoices.some(
      (row) => row.id !== invoice.id && String(row.invoiceNo || "").trim().toLowerCase() === nextInvoiceNo.toLowerCase()
    );
    if (duplicateInvoice) {
      alert("This invoice number already exists.");
      return;
    }

    setSavingEditId(invoice.id);
    try {
      const timestamp = new Date().toISOString();
      const updatedBy = user?.name || user?.email || "System User";
      const updatedInvoice: Invoice = {
        ...baseInvoice,
        invoiceNo: nextInvoiceNo,
        tallyInvNo: nextTallyInvNo,
        updatedBy,
        updateTimestamp: timestamp,
      };

      await setInvoices((prev) => prev.map((row) => (row.id === invoice.id ? updatedInvoice : row)));
      setSelectedInvoice((prev) => (prev?.id === invoice.id ? updatedInvoice : prev));
      cancelInlineEdit();
    } catch (error) {
      console.error("Failed to update invoice fields:", error);
      alert("Failed to update invoice details.");
      setSavingEditId(null);
    }
  };

  const processedInvoices = useMemo(() => {
    return invoices
      .map((invoice) => {
        const company = companies.find((row) => row.id === invoice.companyId);
        const details = buildInvoiceDetails(invoice);
        const itemSummary =
          Array.from(
            new Set(
              details
                .map((line) => String(line.itemName || "").trim())
                .filter(Boolean)
            )
          ).join(", ") || "-";
        const erpSummary = Array.from(new Set(details.map((line) => String(line.erp || "").trim()).filter(Boolean))).join(", ");
        const itemKeys = details.map((line) => `${String(line.itemName || "").trim()}::${String(line.erp || "").trim()}`);

        return {
          ...invoice,
          companyName: company?.name || "Unknown",
          address: company?.address || "",
          gstNo: company?.gstNo || "N/A",
          itemSummary,
          erpSummary,
          itemKeys,
          roundOff: getRoundOff(invoice),
          grandTotal: getGrandTotal(invoice),
          details,
        };
      })
      .filter((invoice) => {
        const needle = searchTerm.trim().toLowerCase();
        if (companyFilter && invoice.companyName !== companyFilter) return false;
        if (itemFilter && !invoice.itemKeys.includes(itemFilter)) return false;
        if (!needle) return true;
        return (
          invoice.invoiceNo.toLowerCase().includes(needle) ||
          invoice.companyName.toLowerCase().includes(needle) ||
          invoice.itemSummary.toLowerCase().includes(needle) ||
          String(invoice.erpSummary || "").toLowerCase().includes(needle) ||
          String(invoice.tallyInvNo || "").toLowerCase().includes(needle) ||
          String(invoice.tallyInvId || "").toLowerCase().includes(needle) ||
          String(invoice.tallySyncRemark || "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const aSort = getInvoiceSortValue(a.invoiceNo);
        const bSort = getInvoiceSortValue(b.invoiceNo);
        const prefixCompare = bSort.prefix.localeCompare(aSort.prefix, undefined, { sensitivity: "base" });
        if (prefixCompare !== 0) return prefixCompare;
        if (bSort.numeric !== aSort.numeric) return bSort.numeric - aSort.numeric;
        return bSort.raw.localeCompare(aSort.raw, undefined, { sensitivity: "base" });
      });
  }, [invoices, companies, searchTerm, companyFilter, itemFilter, lineItems, npdItems, slips, trucks, dispatchPlans, orders]);

  const billingSummary = useMemo(
    () => ({
      beforeGst: processedInvoices.reduce((sum, invoice) => sum + Number(invoice.totalBeforeGst || 0), 0),
      gst: processedInvoices.reduce((sum, invoice) => sum + getGstTotal(invoice), 0),
      total: processedInvoices.reduce((sum, invoice) => sum + getGrandTotal(invoice), 0),
    }),
    [processedInvoices]
  );

  const companyOptions = useMemo(() => {
    const names = Array.from(new Set(invoices.map((invoice) => companies.find((company) => company.id === invoice.companyId)?.name || "").filter(Boolean)));
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((name) => ({ value: name, label: name }));
  }, [companies, invoices]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; searchText: string }>();
    invoices.forEach((invoice) => {
      buildInvoiceDetails(invoice).forEach((line) => {
        const itemName = String(line.itemName || "").trim();
        const erp = String(line.erp || "").trim();
        const key = itemName || erp ? `${itemName}::${erp}` : "";
        if (!key || map.has(key)) return;
        const label = !itemName ? erp : !erp || itemName.toLowerCase().includes(erp.toLowerCase()) ? itemName : `${itemName} - ${erp}`;
        map.set(key, { value: key, label, searchText: `${itemName} ${erp}` });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [invoices, lineItems, npdItems, slips, trucks, dispatchPlans, orders]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedInvoices,
  } = useClientPagination(processedInvoices, 25);

  const invoiceDetails = useMemo(() => {
    if (!selectedInvoice) return [];
    return buildInvoiceDetails(selectedInvoice);
  }, [selectedInvoice, lineItems, npdItems, slips, trucks, dispatchPlans, orders]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Billing Master</h2>
        </div>
        <div className="grid w-full gap-3 md:max-w-4xl md:grid-cols-[minmax(220px,1.4fr)_minmax(190px,1fr)_minmax(240px,1.1fr)_auto] md:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search invoice, ERP, company, item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
          <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
          {(searchTerm || companyFilter || itemFilter) ? (
            <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-black bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Before GST</div>
          <div className="mt-1 text-xl font-black text-slate-900">
            {billingSummary.beforeGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded border border-black bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">GST</div>
          <div className="mt-1 text-xl font-black text-slate-900">
            {billingSummary.gst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded border border-black bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total</div>
          <div className="mt-1 text-xl font-black text-indigo-700">
            {billingSummary.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-x-auto overflow-y-hidden">
        <table className="min-w-[1800px] divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr className="divide-x divide-black">
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Invoice</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Company</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Inv Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Tally No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Tally Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Posted At</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Posted By</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Remark</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Tally Id</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Item Summary</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Amount Before GST</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">GST</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Total Amount</th>
              <th className="px-6 py-3 text-center text-xs font-bold text-black uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {paginatedInvoices.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-6 py-12 text-center text-slate-500 italic">
                  No invoices found.
                </td>
              </tr>
            ) : (
              paginatedInvoices.map((invoice) => (
                <React.Fragment key={invoice.id}>
                  <tr className="hover:bg-slate-50 transition-colors divide-x divide-black">
                    <td className="px-4 py-4 text-center">
                      <button
                        onClick={() => toggleRow(invoice.id)}
                        className="p-1 hover:bg-slate-200 rounded transition"
                      >
                        {expandedRows.has(invoice.id) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {canEditInvoiceFields && editingInvoiceId === invoice.id ? (
                        <div className="space-y-1">
                          <div className="flex items-center">
                            <Receipt size={14} className="text-indigo-600 mr-2" />
                            <input
                              type="text"
                              value={editDraft.invoiceNo}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, invoiceNo: e.target.value }))}
                              className="w-full min-w-[170px] rounded border border-black px-2 py-1 text-sm font-bold outline-none"
                            />
                          </div>
                          <div className="text-[10px] text-slate-500 uppercase">Editing invoice no.</div>
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <Receipt size={14} className="text-indigo-600 mr-2" />
                          <span className="font-bold text-sm">{invoice.invoiceNo}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium">{invoice.companyName}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-600">{formatDate(invoice.date)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs">
                      {canEditInvoiceFields && editingInvoiceId === invoice.id ? (
                        <input
                          type="text"
                          value={editDraft.tallyInvNo}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, tallyInvNo: e.target.value }))}
                          className="w-full min-w-[140px] rounded border border-black px-2 py-1 text-xs outline-none"
                          placeholder="Tally No"
                        />
                      ) : (
                        invoice.tallyInvNo || "-"
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs">
                      {invoice.tallyInvDate ? formatDate(invoice.tallyInvDate) : "-"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs">
                      {invoice.tallyTimestamp ? formatDate(invoice.tallyTimestamp) : "-"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs">{invoice.tallyBy || "-"}</td>
                    <td className="px-4 py-4 text-xs max-w-[220px]">
                      <div className="truncate" title={invoice.tallySyncRemark || ""}>
                        {invoice.tallySyncRemark || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[10px] font-mono max-w-[200px]">
                      <div className="truncate" title={invoice.tallyInvId || ""}>
                        {invoice.tallyInvId || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-xs text-slate-600 line-clamp-2 max-w-xs uppercase font-medium">
                        {invoice.itemSummary}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-slate-900">
                      {Number(invoice.totalBeforeGst || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-slate-900">
                      {getGstTotal(invoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-700">
                      {getGrandTotal(invoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex justify-center gap-2">
                        {canEditInvoiceFields && (
                          editingInvoiceId === invoice.id ? (
                            <>
                              <button
                                onClick={() => void saveInlineEdit(invoice)}
                                disabled={savingEditId === invoice.id}
                                className="rounded border border-emerald-700 px-2 py-1 text-[10px] font-black uppercase text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                                title="Save Invoice / Tally No"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelInlineEdit}
                                disabled={savingEditId === invoice.id}
                                className="rounded border border-slate-700 px-2 py-1 text-[10px] font-black uppercase text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                                title="Cancel Edit"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startInlineEdit(invoice)}
                              className="p-1.5 text-slate-700 hover:bg-slate-100 rounded"
                              title="Edit Invoice No / Tally No"
                            >
                              <Pencil size={18} />
                            </button>
                          )
                        )}
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                          title="View Full Details"
                        >
                          <FileText size={18} />
                        </button>
                        {canFullEditInvoice(invoice) && (
                          <button
                            onClick={() => openInvoiceEditor(invoice.id)}
                            className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                            title="Edit Pending Invoice"
                          >
                            <Pencil size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => openGatePass(invoice.id)}
                          className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded"
                          title={gatePasses.some((gatePass) => gatePass.invoiceId === invoice.id) ? "Open Gate Pass" : "Create Gate Pass"}
                        >
                          <TruckIcon size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedRows.has(invoice.id) && (
                    <tr className="bg-slate-50">
                      <td colSpan={15} className="px-12 py-4">
                        <div className="border-2 border-black rounded overflow-x-auto overflow-y-hidden shadow-sm">
                          <table className="min-w-[1100px] divide-y divide-black">
                            <thead className="sticky top-0 z-30 bg-slate-200">
                              <tr className="divide-x divide-black">
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase">ERP</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Item Name</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Slip No</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Truck No</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-24">Qty</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-24">Rate</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-20">GST %</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-32">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-black">
                              {invoice.details.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-slate-500 italic">
                                    No item breakup found for this invoice.
                                  </td>
                                </tr>
                              ) : (
                                invoice.details.map((line, index) => {
                                  const amount = Number(line.amount) || 0;
                                  const tax =
                                    (Number(line.cgst) || 0) +
                                    (Number(line.sgst) || 0) +
                                    (Number(line.igst) || 0);
                                  const total = amount + tax;
                                  return (
                                    <tr key={line.id || index} className="divide-x divide-black">
                                      <td className="px-3 py-2 text-xs font-bold text-slate-700">{line.erp || "-"}</td>
                                      <td className="px-3 py-2 text-xs font-bold uppercase">{line.itemName}</td>
                                      <td className="px-3 py-2 text-xs">{line.slipNo}</td>
                                      <td className="px-3 py-2 text-xs font-bold text-indigo-700">{line.truckNo}</td>
                                      <td className="px-3 py-2 text-xs text-right">{Number(line.qty || 0).toLocaleString()}</td>
                                      <td className="px-3 py-2 text-xs text-right">{Number(line.rate || 0).toFixed(2)}</td>
                                      <td className="px-3 py-2 text-xs text-right">{Number(line.gstRate || 0)}%</td>
                                      <td className="px-3 py-2 text-xs text-right font-bold">
                                        {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-4xl border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <Receipt size={20} />
                <h3 className="font-bold uppercase tracking-tight">Invoice: {selectedInvoice.invoiceNo}</h3>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-slate-50 p-4 border border-black rounded">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Company</div>
                  <div className="font-bold">{companies.find((row) => row.id === selectedInvoice.companyId)?.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Date</div>
                  <div className="font-bold">{formatDate(selectedInvoice.date)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Status</div>
                  <div className="font-bold text-emerald-600 uppercase text-xs">Generated</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Grand Total</div>
                  <div className="font-bold text-indigo-700 text-lg">
                    {getGrandTotal(selectedInvoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {(selectedInvoice.tallyTimestamp || selectedInvoice.tallyInvNo || selectedInvoice.tallyInvId || selectedInvoice.tallySyncRemark) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-emerald-50 p-4 border border-emerald-200 rounded">
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally Inv No</div>
                    <div className="font-bold text-emerald-900">{selectedInvoice.tallyInvNo || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally Inv Date</div>
                    <div className="font-bold text-emerald-900">
                      {selectedInvoice.tallyInvDate ? formatDate(selectedInvoice.tallyInvDate) : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally Inv Id</div>
                    <div className="font-mono text-[10px] break-all text-emerald-800">{selectedInvoice.tallyInvId || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally Timestamp</div>
                    <div className="font-bold text-emerald-900">
                      {selectedInvoice.tallyTimestamp ? formatDate(selectedInvoice.tallyTimestamp) : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally By</div>
                    <div className="font-bold text-emerald-900">{selectedInvoice.tallyBy || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 uppercase font-bold">Tally Remark</div>
                    <div className="text-[11px] text-emerald-900 break-words">{selectedInvoice.tallySyncRemark || "-"}</div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <div className="flex gap-3">
                  {canFullEditInvoice(selectedInvoice) && (
                    <button
                      type="button"
                      onClick={() => openInvoiceEditor(selectedInvoice.id)}
                      className="inline-flex items-center gap-2 rounded border-2 border-amber-700 px-4 py-2 text-xs font-black uppercase text-amber-800 hover:bg-amber-50"
                    >
                      <Pencil size={16} />
                      Edit Invoice
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openGatePass(selectedInvoice.id)}
                    className="inline-flex items-center gap-2 rounded border-2 border-black px-4 py-2 text-xs font-black uppercase hover:bg-slate-50"
                  >
                    <TruckIcon size={16} />
                    {gatePasses.some((gatePass) => gatePass.invoiceId === selectedInvoice.id) ? "Open Gate Pass" : "Create Gate Pass"}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="sticky top-0 z-30 bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Item / Slip</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Qty</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Rate</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">GST %</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Tax</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {invoiceDetails.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500 italic">
                          No item breakup found for this invoice.
                        </td>
                      </tr>
                    ) : (
                      invoiceDetails.map((line, index) => {
                        const amount = Number(line.amount) || 0;
                        const tax =
                          (Number(line.cgst) || 0) +
                          (Number(line.sgst) || 0) +
                          (Number(line.igst) || 0);
                        const total = amount + tax;
                        return (
                          <tr key={line.id || index} className="divide-x divide-black">
                            <td className="px-4 py-3">
                              <div className="font-bold text-sm uppercase">{line.itemName}</div>
                              <div className="flex gap-2">
                                <div className="text-[10px] text-slate-500 font-bold">Slip: {line.slipNo}</div>
                                <div className="text-[10px] text-indigo-500 font-black">Truck: {line.truckNo}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-sm">{Number(line.qty || 0).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-sm">{Number(line.rate || 0).toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-sm">{Number(line.gstRate || 0)}%</td>
                            <td className="px-4 py-3 text-right text-sm">
                              {tax.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-right text-sm font-medium">
                              {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-xs uppercase">Before GST</td>
                      <td className="px-4 py-2 text-right text-xs">
                        {selectedInvoice.totalBeforeGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">CGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                        {selectedInvoice.cgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">SGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                        {selectedInvoice.sgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">IGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                        {selectedInvoice.igst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black bg-indigo-600 text-white">
                      <td colSpan={5} className="px-4 py-3 text-right text-sm uppercase tracking-wider">
                        Total Amount After GST
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-bold">
                        {selectedInvoice.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">
                        Other Charges{hasTaxableOtherCharges(selectedInvoice) ? ` @ ${getOtherChargesGstRate(selectedInvoice)}% GST` : ""}
                      </td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                        {getOtherCharges(selectedInvoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    {getOtherChargesGstTotal(selectedInvoice) !== 0 && (
                      <tr className="divide-x divide-black">
                        <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">Other Charges GST</td>
                        <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                          {getOtherChargesGstTotal(selectedInvoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )}
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">Round Off</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">
                        {getRoundOff(selectedInvoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="divide-x divide-black bg-emerald-700 text-white border-t-2 border-black">
                      <td colSpan={5} className="px-4 py-3 text-right text-sm uppercase tracking-wider">Grand Total</td>
                      <td className="px-4 py-3 text-right text-lg font-black">
                        {getGrandTotal(selectedInvoice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="px-8 py-2 bg-slate-900 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-black transition active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
