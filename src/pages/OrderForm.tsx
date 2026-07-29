import React, { useState, useEffect, useMemo, useRef } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2, Upload, Download } from "lucide-react";
import { Order, Company, OrderItemSource } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/utils";
import { Select } from "../components/Select";
import { useLocation, useNavigate } from "react-router-dom";
import { User } from "../types";
import { getFinancialYear } from "../lib/serial";
import * as XLSX from "xlsx";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import {
  getOrderItemDisplayName,
  getOrderItemSourceLabel,
  normalizeOrderItemSource,
  normalizeOrderRecord,
  OrderCatalogItem,
} from "../lib/orderItems";

export function OrderForm() {
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll("table tbody tr");
    rows.forEach((row) => {
      const txt = (row.textContent || "").toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? "none" : "";
    });
  }, [searchTerm]);

  const navigate = useNavigate();
  const [orders, setOrders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [users] = useData<User>("users", []);
  const { itemsBySource, fgItems, resolveOrderItem } = useOrderItemCatalog();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isFormOpen, setIsFormOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [isUniversal, setIsUniversal] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState<"Verbal" | "Ref No.">("Verbal");
  const [poNumber, setPoNumber] = useState("");
  const [itemSource, setItemSource] = useState<OrderItemSource>("FG");
  const [itemId, setItemId] = useState("");
  const [erpCode, setErpCode] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const orderAmount = (() => {
    const qtyNumber = Number(qty || 0);
    const rateNumber = Number(rate || 0);
    return Number.isFinite(qtyNumber) && Number.isFinite(rateNumber) ? qtyNumber * rateNumber : 0;
  })();
  const [orderBy, setOrderBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const location = useLocation();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentSourceItems = itemsBySource[itemSource] || [];

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

  const itemSourceOptions = (["FG", "PHP", "PLATE"] as OrderItemSource[]).map((source) => ({
    value: source,
    label: getOrderItemSourceLabel(source),
  }));

  const isCompanyActive = (company: Company) => company.active !== "No";

  const companyOptions = useMemo(() => {
    return companies
      .filter((company) => isCompanyActive(company) || (editingId && company.id === companyId))
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((company) => ({
        value: company.id,
        label: `${company.name}${isCompanyActive(company) ? "" : " (Inactive)"}`,
      }));
  }, [companies, companyId, editingId]);

  const normalizeCompanyName = (value: string | null | undefined) =>
    String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizeText = (value: string | null | undefined) =>
    String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

  const resolveItemCompanyId = (item: OrderCatalogItem | undefined) => {
    if (!item) return "";
    const companyName = normalizeCompanyName(item.companyName);
    if (!companyName) return "";
    return companies.find((company) => normalizeCompanyName(company.name) === companyName && isCompanyActive(company))?.id || "";
  };

  const itemOptions = useMemo(() => {
    const selectedCompanyName = normalizeCompanyName(companies.find((company) => company.id === companyId)?.name);
    return currentSourceItems
      .filter((item) => {
        if (isUniversal || !companyId) return true;
        const itemCompanyName = normalizeCompanyName(item.companyName);
        if (!itemCompanyName) return true;
        return itemCompanyName === selectedCompanyName;
      })
      .slice()
      .sort((a, b) => getOrderItemDisplayName(a).localeCompare(getOrderItemDisplayName(b)))
      .map((item) => {
        const itemDisplayName = getOrderItemDisplayName(item);
        const itemErp = String(item.erp || "").trim();
        const label = itemErp ? `${itemDisplayName} (${itemErp})` : itemDisplayName;
        return {
          value: item.id,
          label,
          searchText: [itemDisplayName, itemErp, label].filter(Boolean).join(" "),
        };
      });
  }, [companyId, companies, currentSourceItems, isUniversal]);

  const userOptions = users
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((user) => ({ value: user.id, label: user.name }));

  const downloadTemplate = () => {
    const templateData = [
      {
        "Order Date": new Date().toISOString().slice(0, 10),
        "PO Type": "Verbal",
        "PO Number": "",
        "Item Name": "Example Item",
        Qty: 100,
        Rate: 12.5,
        "Order By": "Admin",
        Remarks: "Urgent order",
      },
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

        const bulkSource: OrderItemSource = "FG";
        const bulkItems = fgItems;
        const itemMap = new Map<string, OrderCatalogItem>();
        bulkItems.forEach((item) => {
          const keys = [item.name, item.erp]
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
            erpCode: matchedItem?.erp || "",
            itemId: matchedItem?.id || "",
            itemSource: bulkSource,
            npdId: matchedItem?.source === "FG" ? matchedItem.id : undefined,
            qty: /^[0-9]+$/.test(qtyValue) ? parseInt(qtyValue, 10) : 0,
            rate: Number.isFinite(rateNumber) ? rateNumber : 0,
            orderAmount: /^[0-9]+$/.test(qtyValue) && Number.isFinite(rateNumber) ? parseInt(qtyValue, 10) * rateNumber : 0,
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
    setOrders(orders.filter((order) => order.id !== id));
    setDeletingId(null);
  };

  const loadOrderIntoForm = (order: Order) => {
    const normalizedOrder = normalizeOrderRecord(order);
    setIsUniversal(false);
    setEditingId(order.id);
    setOrderDate(order.orderDate || "");
    setCompanyId(order.companyId || "");
    setPoType(order.poType || "Verbal");
    setPoNumber(order.poNumber || "");
    setItemSource(normalizedOrder.itemSource);
    setItemId(order.itemId || "");
    setErpCode((order.erpCode || "").toString());
    setQty(order.qty?.toString() || "");
    setRate(order.rate?.toString() || "");
    setOrderBy(order.orderBy || "");
    setRemarks(order.remarks || "");
    setIsFormOpen(true);
  };

  const handleEdit = (order: Order) => {
    loadOrderIntoForm(order);
  };

  const resetForm = () => {
    setIsUniversal(false);
    setEditingId(null);
    setOrderDate(new Date().toISOString().slice(0, 10));
    setCompanyId("");
    setPoType("Verbal");
    setPoNumber("");
    setItemSource("FG");
    setItemId("");
    setErpCode("");
    setQty("");
    setRate("");
    setOrderBy("");
    setRemarks("");
  };

  useEffect(() => {
    if (poType === "Verbal") {
      const editingOrder = editingId ? orders.find((order) => order.id === editingId) : null;
      if (editingOrder?.poType === "Verbal" && editingOrder.poNumber) {
        setPoNumber(editingOrder.poNumber);
      } else {
        setPoNumber(getNextVerbalPoNumber(orderDate, editingId));
      }
    } else if (editingId) {
      const editingOrder = orders.find((order) => order.id === editingId);
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
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as const;
      const payload: Order = {
        id: editingId || crypto.randomUUID(),
        ...(editingId ? { orderNo: orders.find((order) => order.id === editingId)?.orderNo } : {}),
        orderDate,
        companyId,
        poNumber: poType === "Verbal" ? getNextVerbalPoNumber(orderDate, editingId) : poNumber,
        erpCode,
        itemId,
        itemSource,
        npdId: itemSource === "FG" ? itemId : undefined,
        qty: parseInt(qty, 10),
        rate: rateNumber,
        orderAmount,
        orderBy,
        poType,
        remarks,
        status: editingId ? orders.find((order) => order.id === editingId)?.status || "Pending PH" : "Pending PH",
        ...audit,
      };

      if (editingId) {
        setOrders(orders.map((order) => (order.id === editingId ? { ...order, ...payload } : order)));
      } else {
        setOrders([...orders, payload]);
      }

      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
      navigate("/orders/master");
    }, 500);
  };

  const handleItemChange = (id: string) => {
    if (id === itemId) return;
    if (!id) {
      setItemId("");
      setErpCode("");
      setRate("");
      return;
    }
    setItemId(id);
    const item = currentSourceItems.find((entry) => entry.id === id);
    const linkedCompanyId = resolveItemCompanyId(item);
    if (!isUniversal && !companyId && linkedCompanyId) {
      setCompanyId(linkedCompanyId);
    }
    setErpCode(item?.erp || "");
    if (typeof item?.rate !== "undefined") {
      setRate(String(item.rate ?? ""));
    }
  };

  const handleItemSourceChange = (value: string) => {
    const nextSource = normalizeOrderItemSource(value);
    if (nextSource === itemSource) return;
    setItemSource(nextSource);
    setItemId("");
    setErpCode("");
    setRate("");
  };

  const handleCompanyChange = (id: string) => {
    setCompanyId(id);
    if (!id) {
      if (!isUniversal) {
        setItemId("");
        setErpCode("");
        setRate("");
      }
      return;
    }
    if (isUniversal || !itemId) return;
    const selectedItem = currentSourceItems.find((item) => item.id === itemId);
    const resolvedCompanyId = resolveItemCompanyId(selectedItem);
    if (resolvedCompanyId && resolvedCompanyId !== id) {
      setItemId("");
      setErpCode("");
      setRate("");
    }
  };

  useEffect(() => {
    if (isUniversal || !companyId || !itemId) return;
    const selectedItem = currentSourceItems.find((item) => item.id === itemId);
    const resolvedCompanyId = resolveItemCompanyId(selectedItem);
    if (resolvedCompanyId && resolvedCompanyId !== companyId) {
      setItemId("");
      setErpCode("");
      setRate("");
    }
  }, [companyId, currentSourceItems, isUniversal, itemId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editId = params.get("edit");
    if (!editId) return;
    const order = orders.find((entry) => entry.id === editId);
    if (order) loadOrderIntoForm(order);
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
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-lg border border-slate-200 space-y-6 max-w-4xl mx-auto">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Order Date</label>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="w-full border border-slate-300 rounded-md p-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Company Name</label>
              <div className="w-full">
                <Select
                  value={companyId}
                  onChange={handleCompanyChange}
                  options={companyOptions}
                  placeholder="Select Company..."
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">PO Type</label>
              <div className="w-full">
                <Select value={poType} onChange={(value: any) => setPoType(value)} options={poOptions} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">PO Number</label>
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={`w-full border rounded-md p-3 ${poType === "Verbal" ? "bg-slate-100 border-slate-200 text-slate-600" : "border-slate-300 text-slate-900"}`} disabled={poType === "Verbal"} />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Item Source</label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={isUniversal}
                    onChange={(e) => setIsUniversal(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Show All Items
                </label>
                {itemSourceOptions.map((option) => {
                  const checked = itemSource === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${checked ? "border-indigo-600 bg-indigo-50 text-indigo-900" : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleItemSourceChange(option.value)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Item Name (ERP)</label>
              <div className="w-full">
                <Select value={itemId} onChange={handleItemChange} options={itemOptions} placeholder="Select Item Name / ERP..." />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">ERP Code</label>
              <input value={erpCode} onChange={(e) => setErpCode(e.target.value)} className="w-full border border-slate-300 rounded-md p-3 bg-slate-50 text-slate-700" readOnly />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Qty</label>
              <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} className="w-full border border-slate-300 rounded-md p-3" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Rate</label>
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
                className="w-full border border-slate-300 rounded-md p-3"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Order Amount</label>
              <input value={orderAmount.toFixed(2)} className="w-full border border-slate-300 rounded-md p-3 bg-slate-50 text-slate-700" readOnly />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Order By <span className="text-red-500">*</span></label>
              <div className="w-full">
                <Select value={orderBy} onChange={setOrderBy} options={userOptions} placeholder="Select user..." required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Remarks</label>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border border-slate-300 rounded-md p-3" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-2 rounded-md font-semibold shadow">{isSubmitting ? <Spinner /> : "Submit"}</button>
            <button type="button" onClick={() => { setIsFormOpen(false); resetForm(); navigate("/orders/master"); }} className="bg-white text-black border border-slate-300 px-6 py-2 rounded-md font-semibold">Cancel</button>
          </div>
        </form>
      )}

      {!isFormOpen && <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
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
            {orders.map((order) => {
              const resolvedItem = resolveOrderItem(order);
              return (
                <tr key={order.id} className="divide-x divide-black hover:bg-slate-50">
                  <td className="px-4 py-2 border border-black">{order.orderNo}</td>
                  <td className="px-4 py-2 border border-black">{formatDate(order.orderDate)}</td>
                  <td className="px-4 py-2 border border-black">{companies.find((company) => company.id === order.companyId)?.name}</td>
                  <td className="px-4 py-2 border border-black">{order.poNumber}</td>
                  <td className="px-4 py-2 border border-black">{resolvedItem?.erp || order.erpCode}</td>
                  <td className="px-4 py-2 border border-black">{getOrderItemDisplayName(resolvedItem)}</td>
                  <td className="px-4 py-2 text-right border border-black">{order.qty}</td>
                  <td className="px-4 py-2 text-right border border-black">{order.rate}</td>
                  <td className="px-4 py-2 text-right border border-black">{users.find((user) => user.id === order.orderBy)?.name}</td>
                  <td className="px-4 py-2 text-right border border-black">
                    <button title="Edit" aria-label="Edit" onClick={() => handleEdit(order)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit size={16} /></button>
                    <button title={deletingId === order.id ? "Confirm cancel" : "Cancel"} aria-label={deletingId === order.id ? "Confirm cancel" : "Cancel"} onClick={() => handleDelete(order.id)} className={`${deletingId === order.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900`}><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

