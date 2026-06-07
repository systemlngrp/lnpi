import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2, Upload, Download } from "lucide-react";
import { Order, Company, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/utils";
import { Select } from "../components/Select";
import { useLocation } from "react-router-dom";
import { User } from "../types";
import { getFinancialYear } from "../lib/serial";
import * as XLSX from "xlsx";

export function OrderForm() {
  const [orders, setOrders, isLoading] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [users] = useData<User>("users", []);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState<"Verbal"|"Ref No.">("Verbal");
  const [poNumber, setPoNumber] = useState("");
  const [itemId, setItemId] = useState("");
  const [erpCode, setErpCode] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [orderBy, setOrderBy] = useState("");
  const [remarks, setRemarks] = useState("");

  const getNextVerbalPoNumber = (effectiveOrderDate: string, ignoreOrderId?: string | null) => {
    const fy = getFinancialYear(effectiveOrderDate);
    const matching = orders.filter(
      (order) =>
        order.id !== ignoreOrderId &&
        order.poType === "Verbal" &&
        String(order.poNumber || "").startsWith(`${fy}/`)
    );
    const maxNo = matching.reduce((max, order) => {
      const parts = String(order.poNumber || "").split("/");
      const num = parseInt(parts[1] || "0", 10);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);
    return `${fy}/${maxNo + 1}`;
  };

  const normalizeOrderDate = (value: unknown) => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, "0");
      const dd = String(value.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        const yyyy = parsed.y;
        const mm = String(parsed.m).padStart(2, "0");
        const dd = String(parsed.d).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }

    const text = String(value || "").trim();
    if (!text) return "";

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) {
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    return text;
  };

  const getOrderFinancialYearLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "0000-00";
    let fyStart = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month < 4) fyStart -= 1;
    return `${fyStart}-${String(fyStart + 1).slice(2)}`;
  };

  const poOptions = [
    { value: "Verbal", label: "Verbal" },
    { value: "Ref No.", label: "Ref No." },
  ];

  const companyOptions = companies
    .slice()
    .sort((a,b) => (a.name||"").localeCompare(b.name||""))
    .map(c => ({ value: c.id, label: c.name }));

  const normalizeCompanyName = (value: string | null | undefined) =>
    String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const getItemCustomerName = (item: Item | undefined) =>
    normalizeCompanyName((item as any)?.customerName || item?.customer || "");
  const normalizeText = (value: string | null | undefined) =>
    String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

  const resolveItemCompanyId = (item: Item | undefined) => {
    if (!item) return "";
    const customerName = getItemCustomerName(item);
    if (!customerName) return "";
    return companies.find((company) => normalizeCompanyName(company.name) === customerName)?.id || "";
  };

  const fetchAllOrderItems = useCallback(async () => {
    const token = window.localStorage.getItem("authToken") || "";
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const pageSize = 10000;

    try {
      const response = await fetch(`/api/npd?page=1&pageSize=${pageSize}`, { headers });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch full item list");
      }

      const result = await response.json();
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      setAllItems(rows);
    } catch (error) {
      console.error("Failed to fetch full NPD item list for orders:", error);
    }
  }, []);

  useEffect(() => {
    fetchAllOrderItems();
  }, [fetchAllOrderItems]);

  const itemOptions = useMemo(() => {
    const selectedCompanyName = normalizeCompanyName(companies.find((company) => company.id === companyId)?.name);
    return allItems
      .filter((item) => !companyId || getItemCustomerName(item) === selectedCompanyName)
      .slice()
      .sort((a,b) => (a.name||"").localeCompare(b.name||""))
      .map(i => ({ value: i.id, label: i.name }));
  }, [allItems, companyId, companies]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const location = useLocation();

  const userOptions = users.slice().sort((a,b)=> (a.name||"").localeCompare(b.name||"")).map(u=>({ value: u.id, label: u.name }));

  const downloadTemplate = () => {
    const templateData = [
      {
        "Order Date": new Date().toISOString().slice(0, 10),
        "PO Type": "Verbal",
        "PO Number": "",
        "Item Name": "Example Item",
        "Qty": 100,
        "Rate": 12.5,
        "Order By": "Admin",
        "Remarks": "Urgent order",
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, "Orders_Bulk_Upload_Template.xlsx");
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: "binary", cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { raw: true });

        if (data.length === 0) {
          alert("The file is empty.");
          return;
        }

        setIsSubmitting(true);

        const itemMap = new Map<string, Item>();
        allItems.forEach((item) => {
          const keys = [item.name, (item as any)?.itemName]
            .map((value) => normalizeText(value))
            .filter(Boolean);
          keys.forEach((key) => {
            if (key && !itemMap.has(key)) itemMap.set(key, item);
          });
        });

        const userMap = new Map<string, User>();
        users.forEach((user) => {
          const nameKey = normalizeText(user.name);
          const userIdKey = normalizeText(user.userId);
          if (nameKey && !userMap.has(nameKey)) userMap.set(nameKey, user);
          if (userIdKey && !userMap.has(userIdKey)) userMap.set(userIdKey, user);
        });

        const validationErrors: string[] = [];
        const missingItems: string[] = [];
        const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as const;
        const nextVerbalPoNumbers = new Map<string, number>();
        const nextOrderNumbers = new Map<string, number>();

        orders.forEach((order) => {
          if (order.poType !== "Verbal") return;
          const poNumberParts = String(order.poNumber || "").split("/");
          const fy = poNumberParts[0] || "";
          const numberPart = parseInt(poNumberParts[1] || "0", 10);
          if (!fy || !Number.isFinite(numberPart)) return;
          nextVerbalPoNumbers.set(fy, Math.max(nextVerbalPoNumbers.get(fy) || 0, numberPart));
        });

        orders.forEach((order) => {
          const orderNoParts = String(order.orderNo || "").split("/");
          const fy = orderNoParts[0] || "";
          const numberPart = parseInt(orderNoParts[1] || "0", 10);
          if (!fy || !Number.isFinite(numberPart)) return;
          nextOrderNumbers.set(fy, Math.max(nextOrderNumbers.get(fy) || 0, numberPart));
        });

        const newOrders: Order[] = data.map((row: any, index) => {
          const rowNumber = index + 2;
          const orderDateValue = normalizeOrderDate(row["Order Date"]);
          const poTypeValue = String(row["PO Type"] || "").trim();
          const poNumberValue = String(row["PO Number"] || "").trim();
          const itemNameValue = String(row["Item Name"] || "").trim();
          const qtyValue = String(row["Qty"] ?? "").trim();
          const rateValue = String(row["Rate"] ?? "").trim();
          const orderByValue = String(row["Order By"] || "").trim();
          const remarksValue = String(row["Remarks"] || "").trim();

          const rowIssues: string[] = [];

          if (!orderDateValue) rowIssues.push("Order Date is required");

          const normalizedPoType = poTypeValue.toLowerCase();
          const poType =
            normalizedPoType === "verbal"
              ? "Verbal"
              : normalizedPoType === "ref no." || normalizedPoType === "ref no"
                ? "Ref No."
                : "";
          if (!poType) rowIssues.push("PO Type must be Verbal or Ref No.");
          if (poType === "Ref No." && !poNumberValue) rowIssues.push("PO Number is required for Ref No.");

          if (!itemNameValue) {
            rowIssues.push("Item Name is required");
          }

          const matchedItem = itemMap.get(normalizeText(itemNameValue));
          if (itemNameValue && !matchedItem) {
            rowIssues.push(`Item not found: ${itemNameValue}`);
            missingItems.push(`Row ${rowNumber}: ${itemNameValue}`);
          }

          const companyId = resolveItemCompanyId(matchedItem);
          if (matchedItem && !companyId) {
            rowIssues.push(`Company not resolved for item: ${itemNameValue}`);
          }

          if (!qtyValue) {
            rowIssues.push("Qty is required");
          } else if (!/^[0-9]+$/.test(qtyValue)) {
            rowIssues.push("Qty must be a whole number");
          }

          const rateNumber = Number(rateValue);
          if (!rateValue) {
            rowIssues.push("Rate is required");
          } else if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
            rowIssues.push("Rate must be greater than 0");
          }

          if (!orderByValue) {
            rowIssues.push("Order By is required");
          }
          const matchedUser = userMap.get(normalizeText(orderByValue));
          if (orderByValue && !matchedUser) {
            rowIssues.push(`Order By user not found: ${orderByValue}`);
          }

          if (rowIssues.length > 0) {
            validationErrors.push(`Row ${rowNumber}: ${rowIssues.join(", ")}`);
          }

          let resolvedPoNumber = poNumberValue;
          if (poType === "Verbal" && orderDateValue) {
            const fy = getFinancialYear(orderDateValue);
            const nextNumber = (nextVerbalPoNumbers.get(fy) || 0) + 1;
            nextVerbalPoNumbers.set(fy, nextNumber);
            resolvedPoNumber = `${fy}/${nextNumber}`;
          }

          const orderFy = getOrderFinancialYearLabel(orderDateValue);
          const nextOrderNumber = (nextOrderNumbers.get(orderFy) || 0) + 1;
          nextOrderNumbers.set(orderFy, nextOrderNumber);
          const resolvedOrderNo = `${orderFy}/${String(nextOrderNumber).padStart(5, "0")}`;

          return {
            id: crypto.randomUUID(),
            orderNo: resolvedOrderNo,
            orderDate: orderDateValue,
            companyId,
            poNumber: poType === "Ref No." ? poNumberValue : resolvedPoNumber,
            erpCode: matchedItem?.erp?.toString() || "",
            itemId: matchedItem?.id || "",
            qty: /^[0-9]+$/.test(qtyValue) ? parseInt(qtyValue, 10) : 0,
            rate: Number.isFinite(rateNumber) ? rateNumber : 0,
            orderBy: matchedUser?.id || "",
            poType: (poType || "Verbal") as "Verbal" | "Ref No.",
            remarks: remarksValue,
            status: "Pending PH",
            ...audit,
          };
        });

        if (validationErrors.length > 0) {
          const uniqueMissingItems = Array.from(new Set(missingItems));
          const missingSection = uniqueMissingItems.length
            ? `\n\nMissing Items:\n${uniqueMissingItems.join("\n")}`
            : "";
          alert(`Bulk upload blocked.\n\n${validationErrors.join("\n")}${missingSection}`);
          return;
        }

        const token = window.localStorage.getItem("authToken") || "";
        const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

        for (let index = 0; index < newOrders.length; index += 1) {
          const order = newOrders[index];
          const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify(order),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const message = errData.error || `Failed to save row ${index + 2}.`;
            throw new Error(message);
          }
        }

        window.dispatchEvent(new CustomEvent("sync-data-orders"));
        alert(`Successfully uploaded ${newOrders.length} orders to DB.`);
      } catch (error) {
        console.error("Bulk order upload error:", error);
        alert(error instanceof Error ? error.message : "Failed to parse or upload the Excel file.");
      } finally {
        setIsSubmitting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setOrders(orders.filter(o => o.id !== id));
    setDeletingId(null);
  };

  const handleEdit = (o: Order) => {
    setEditingId(o.id);
    setOrderDate(o.orderDate || "");
    setCompanyId(o.companyId);
    setPoType(o.poType || "Verbal");
    setPoNumber(o.poNumber || "");
    setItemId(o.itemId);
    setErpCode((o.erpCode || "").toString());
    setQty(o.qty?.toString() || "");
    setRate(o.rate?.toString() || "");
    setOrderBy(o.orderBy || "");
    setRemarks(o.remarks || "");
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setOrderDate(new Date().toISOString().slice(0,10));
    setCompanyId("");
    setPoType("Verbal");
    setPoNumber("");
    setItemId("");
    setErpCode("");
    setQty("");
    setRate("");
    setOrderBy("");
    setRemarks("");
  };

  useEffect(() => {
    if (poType === "Verbal") {
      const editingOrder = editingId ? orders.find((o) => o.id === editingId) : null;
      if (editingOrder?.poType === "Verbal" && editingOrder.poNumber) {
        setPoNumber(editingOrder.poNumber);
      } else {
        setPoNumber(getNextVerbalPoNumber(orderDate, editingId));
      }
    } else if (editingId) {
      const editingOrder = orders.find((o) => o.id === editingId);
      setPoNumber(editingOrder?.poType === "Ref No." ? editingOrder.poNumber || "" : "");
    } else {
      setPoNumber("");
    }
  }, [poType, orderDate, editingId, orders]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !itemId || !qty) return;
    if (!orderBy) {
      alert("Order By is mandatory.");
      return;
    }

    if (!/^[0-9]+$/.test(qty)) {
      alert("Qty must be a whole number (no decimals) or enter integer value.");
      return;
    }

    const rateNumber = Number(rate);
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      alert("Rate must be greater than 0.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as any;
      const payload: Order = {
        id: editingId || crypto.randomUUID(),
        ...(editingId ? { orderNo: orders.find(o=>o.id===editingId)?.orderNo } : {}),
        orderDate,
        companyId,
        poNumber: poType === "Verbal" ? getNextVerbalPoNumber(orderDate, editingId) : poNumber,
        erpCode,
        itemId,
        qty: parseInt(qty,10),
        rate: rateNumber,
        orderBy,
        poType,
        remarks,
        status: editingId ? orders.find(o=>o.id===editingId)?.status || 'Pending PH' : 'Pending PH',
        ...audit
      };

      if (editingId) {
        setOrders(orders.map(o => o.id === editingId ? { ...o, ...payload } : o));
      } else {
        setOrders([...orders, payload]);
      }

      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  // Auto-fill ERP when item selected
  const handleItemChange = (id: string) => {
    if (id === itemId) return;
    if (!id) {
      setItemId("");
      setErpCode("");
      setRate("");
      return;
    }
    setItemId(id);
    const it = allItems.find(i => i.id === id);
    const linkedCompanyId = resolveItemCompanyId(it);
    if (!companyId && linkedCompanyId) {
      setCompanyId(linkedCompanyId);
    }
    if (it && typeof it.erp !== 'undefined') setErpCode((it.erp || "").toString());
    else setErpCode("");
    if (it && typeof it.rate !== "undefined" && it.rate !== null) {
      setRate(String(it.rate));
    }
  };

  const handleCompanyChange = (id: string) => {
    setCompanyId(id);
    if (!id) {
      setItemId("");
      return;
    }
    if (!itemId) return;
    const selectedItem = allItems.find((item) => item.id === itemId);
    const resolvedCompanyId = resolveItemCompanyId(selectedItem);
    if (resolvedCompanyId !== id) {
      setItemId("");
      setErpCode("");
      setRate("");
    }
  };

  // Auto-open edit when ?edit=<id> in URL (used by Plant Head edit link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editId = params.get("edit");
    if (editId) {
      const o = orders.find(x => x.id === editId);
      if (o) {
        // populate form
        setIsFormOpen(true);
        setEditingId(o.id);
        setOrderDate(o.orderDate || "");
        setCompanyId(o.companyId);
        setPoType(o.poType || "Verbal");
        setPoNumber(o.poNumber || "");
        setItemId(o.itemId);
        setErpCode((o.erpCode || "").toString());
        setQty(o.qty?.toString() || "");
        setRate(o.rate?.toString() || "");
        setOrderBy(o.orderBy || "");
        setRemarks(o.remarks || "");
      }
    }
  }, [location.search, orders]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Order Form</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadTemplate}
            className="bg-white text-black border-2 border-black px-3 py-2 rounded font-bold hover:bg-slate-100 transition flex items-center text-sm"
          >
            <Download size={18} className="mr-2" /> Template
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting}
            className="bg-white text-black border-2 border-black px-3 py-2 rounded font-bold hover:bg-slate-100 transition flex items-center text-sm disabled:opacity-50"
          >
            <Upload size={18} className="mr-2" /> Bulk Upload
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleBulkUpload}
            accept=".xlsx, .xls"
            className="hidden"
          />
          {!isFormOpen && (
            <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
              <Plus size={18} /> New Order
            </button>
          )}
        </div>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-sm border border-black space-y-4">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Order Date</label>
              <input type="date" value={orderDate} onChange={(e)=>setOrderDate(e.target.value)} className="border-2 border-black rounded p-2" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Company Name</label>
              <Select
                value={companyId}
                onChange={handleCompanyChange}
                options={companyOptions}
                placeholder="Select Company..."
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">PO Type</label>
              <Select value={poType} onChange={(v:any)=>setPoType(v)} options={poOptions} />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">PO Number</label>
              <input value={poNumber} onChange={(e)=>setPoNumber(e.target.value)} className={`border-2 rounded p-2 ${poType === 'Verbal' ? 'bg-slate-200 border-gray-300 text-slate-600' : 'border-black text-black'}`} disabled={poType === 'Verbal'} />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Item</label>
              <Select value={itemId} onChange={handleItemChange} options={itemOptions} placeholder="Select Item..." />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">ERP Code</label>
              <input value={erpCode} onChange={(e)=>setErpCode(e.target.value)} className="border-2 border-black rounded p-2 bg-slate-100 text-slate-700" readOnly />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Qty</label>
              <input value={qty} onChange={(e)=>setQty(e.target.value.replace(/[^0-9]/g,''))} className="border-2 border-black rounded p-2" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Rate</label>
              <input
                value={rate}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = raw.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  const normalized = parts.length <= 2 ? cleaned : `${parts[0]}.${parts.slice(1).join("")}`;
                  setRate(normalized);
                }}
                type="number"
                min={0.01}
                step={0.01}
                className="border-2 border-black rounded p-2"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Order By <span className="text-red-500">*</span></label>
              <Select value={orderBy} onChange={setOrderBy} options={userOptions} placeholder="Select user..." required />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Remarks</label>
              <input value={remarks} onChange={(e)=>setRemarks(e.target.value)} className="border-2 border-black rounded p-2" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-2 rounded font-bold">{isSubmitting ? <Spinner /> : 'Submit'}</button>
            <button type="button" onClick={()=>{ setIsFormOpen(false); resetForm(); }} className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Order No.</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Order Date</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Company</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">PO Number</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">ERP Code</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Item</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Rate</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Order By</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {orders.map(o => (
              <tr key={o.id} className="divide-x divide-black hover:bg-slate-50">
                <td className="px-4 py-2 border border-black">{o.orderNo}</td>
                <td className="px-4 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-4 py-2 border border-black">{companies.find(c => c.id === o.companyId)?.name}</td>
                <td className="px-4 py-2 border border-black">{o.poNumber}</td>
                <td className="px-4 py-2 border border-black">{o.erpCode}</td>
                <td className="px-4 py-2 border border-black">{allItems.find(i => i.id === o.itemId)?.name}</td>
                <td className="px-4 py-2 text-right border border-black">{o.qty}</td>
                <td className="px-4 py-2 text-right border border-black">{o.rate}</td>
                <td className="px-4 py-2 text-right border border-black">{users.find(u => u.id === o.orderBy)?.name}</td>
                <td className="px-4 py-2 text-right border border-black">
                  <button title="Edit" aria-label="Edit" onClick={() => handleEdit(o)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit size={16} /></button>
                  <button title={deletingId === o.id ? 'Confirm cancel' : 'Cancel'} aria-label={deletingId === o.id ? 'Confirm cancel' : 'Cancel'} onClick={() => handleDelete(o.id)} className={`${deletingId === o.id ? 'text-amber-600 animate-pulse' : 'text-red-600'} hover:text-red-900`}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
