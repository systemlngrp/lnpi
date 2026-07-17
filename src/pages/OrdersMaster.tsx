import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, Search, Calendar } from "lucide-react";
import Select from "react-select";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { formatDate } from "../lib/utils";
import { Company, DispatchPlan, LoadingSlip, Order, OrderSchedule, User, Supplier } from "../types";

type SortDirection = "asc" | "desc";

type OrderMasterRow = {
  order: Order;
  companyName: string;
  itemName: string;
  itemErp: string;
  itemKey: string;
  orderByName: string;
  canceledQty: number;
  invoicedQty: number;
  pendingQty: number;
  orderAmount: number;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseOrderSerial = (orderNo?: string) => {
  const value = String(orderNo || "").trim();
  if (!value) return 0;
  const serialPart = value.split("/").pop() || value;
  const parsed = parseInt(serialPart, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmount = (value: number) => toNumber(value).toFixed(2);

const isWithinDateRange = (value: string, fromDate: string, toDate: string) => {
  if (!value) return false;
  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;
  return true;
};

export function OrdersMaster() {
  const navigate = useNavigate();
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [users] = useData<User>("users", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const { resolveOrderItem } = useOrderItemCatalog();

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [orderByFilter, setOrderByFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orderNoSort, setOrderNoSort] = useState<SortDirection>("desc");
  const [valueGreaterThan, setValueGreaterThan] = useState<number | "">("");
  const [quantityGreaterThan, setQuantityGreaterThan] = useState<number | "">("");

  const companyMap = useMemo(
    () => {
      const map = new Map<string, string>();
      companies.forEach(c => map.set(c.id, c.name || ""));
      suppliers.forEach(s => {
        if (!map.has(s.id)) map.set(s.id, s.name || "");
      });
      return map;
    },
    [companies, suppliers]
  );
  const itemMap = useMemo(
    () => new Map(orders.map((order) => [order.id, resolveOrderItem(order)])),
    [orders, resolveOrderItem]
  );
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.id, user.name || ""])),
    [users]
  );

  const canceledQtyByOrderId = useMemo(() => {
    const map = new Map<string, number>();
    schedules.forEach((schedule) => {
      const orderId = String(schedule.orderId || "");
      if (!orderId) return;
      map.set(orderId, toNumber(map.get(orderId)) + toNumber(schedule.canceledQty));
    });
    return map;
  }, [schedules]);

  const dispatchPlanToOrderMap = useMemo(() => {
    const map = new Map<string, string>();
    dispatchPlans.forEach((plan) => {
      if (plan.id) {
        map.set(plan.id, String(plan.orderId || ""));
      }
    });
    return map;
  }, [dispatchPlans]);

  const invoicedQtyByOrderId = useMemo(() => {
    const map = new Map<string, number>();

    loadingSlips.forEach((slip) => {
      if (!slip.invoiceId || !Array.isArray(slip.lines)) return;

      slip.lines.forEach((line) => {
        const orderId = dispatchPlanToOrderMap.get(String(line.dispatchPlanId || ""));
        if (!orderId) return;
        map.set(orderId, toNumber(map.get(orderId)) + toNumber(line.loadedQty));
      });
    });

    return map;
  }, [dispatchPlanToOrderMap, loadingSlips]);

  const rows = useMemo<OrderMasterRow[]>(() => {
    return orders.map((order) => {
      const canceledQty = toNumber(canceledQtyByOrderId.get(order.id));
      const invoicedQty = toNumber(invoicedQtyByOrderId.get(order.id));
      const orderAmount = toNumber(order.orderAmount) || toNumber(order.qty) * toNumber(order.rate);
      const pendingQty = Math.max(0, toNumber(order.qty) - canceledQty - invoicedQty);

      const item = itemMap.get(order.id);
      const itemName = String(item?.name || "").trim();
      const itemErp = String(order.erpCode || item?.erp || "").trim();
      const itemKey = itemName || itemErp ? `${itemName}::${itemErp}` : "";

      return {
        order,
        companyName: companyMap.get(order.companyId) || "",
        itemName,
        itemErp,
        itemKey,
        orderByName: userMap.get(order.orderBy || "") || "",
        canceledQty,
        invoicedQty,
        pendingQty,
        orderAmount,
      };
    });
  }, [canceledQtyByOrderId, companyMap, invoicedQtyByOrderId, itemMap, orders, userMap]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (companyFilter && row.companyName !== companyFilter) return false;
        if (itemFilter && row.itemKey !== itemFilter) return false;
        if (orderByFilter && row.orderByName !== orderByFilter) return false;
        if ((dateFrom || dateTo) && !isWithinDateRange(row.order.orderDate, dateFrom, dateTo)) return false;
        if (valueGreaterThan !== "" && toNumber(row.orderAmount) <= toNumber(valueGreaterThan)) return false;
        if (quantityGreaterThan !== "" && toNumber(row.order.qty) <= toNumber(quantityGreaterThan)) return false;

        if (!normalizedSearch) return true;

        return [
          row.order.orderNo,
          row.companyName,
          row.itemName,
          row.itemErp,
          row.order.erpCode,
          row.order.poNumber,
          row.orderByName,
        ]
          .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => {
        const serialDiff = parseOrderSerial(left.order.orderNo) - parseOrderSerial(right.order.orderNo);
        if (serialDiff !== 0) {
          return orderNoSort === "asc" ? serialDiff : -serialDiff;
        }

        const orderNoCompare = String(left.order.orderNo || "").localeCompare(String(right.order.orderNo || ""));
        return orderNoSort === "asc" ? orderNoCompare : -orderNoCompare;
      });
  }, [companyFilter, dateFrom, dateTo, itemFilter, orderByFilter, orderNoSort, rows, searchTerm, valueGreaterThan, quantityGreaterThan]);

  const availableCompanies = useMemo(() => {
    const ns = searchTerm.trim().toLowerCase();
    const set = new Set<string>();
    rows.forEach((row) => {
      if (itemFilter && row.itemKey !== itemFilter) return;
      if (orderByFilter && row.orderByName !== orderByFilter) return;
      if ((dateFrom || dateTo) && !isWithinDateRange(row.order.orderDate, dateFrom, dateTo)) return;
      if (valueGreaterThan !== "" && toNumber(row.orderAmount) <= toNumber(valueGreaterThan)) return;
      if (quantityGreaterThan !== "" && toNumber(row.order.qty) <= toNumber(quantityGreaterThan)) return;
      if (ns) {
        const anyMatch = [row.order.orderNo, row.companyName, row.itemName, row.itemErp, row.order.erpCode, row.order.poNumber, row.orderByName]
          .some((v) => String(v || "").toLowerCase().includes(ns));
        if (!anyMatch) return;
      }
      if (row.companyName) set.add(row.companyName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, itemFilter, orderByFilter, dateFrom, dateTo, valueGreaterThan, quantityGreaterThan, searchTerm]);

  const availableItems = useMemo(() => {
    const ns = searchTerm.trim().toLowerCase();
    const set = new Set<string>();
    rows.forEach((row) => {
      if (companyFilter && row.companyName !== companyFilter) return;
      if (orderByFilter && row.orderByName !== orderByFilter) return;
      if ((dateFrom || dateTo) && !isWithinDateRange(row.order.orderDate, dateFrom, dateTo)) return;
      if (valueGreaterThan !== "" && toNumber(row.orderAmount) <= toNumber(valueGreaterThan)) return;
      if (quantityGreaterThan !== "" && toNumber(row.order.qty) <= toNumber(quantityGreaterThan)) return;
      if (ns) {
        const anyMatch = [row.order.orderNo, row.companyName, row.itemName, row.itemErp, row.order.erpCode, row.order.poNumber, row.orderByName]
          .some((v) => String(v || "").toLowerCase().includes(ns));
        if (!anyMatch) return;
      }
      if (row.itemKey) set.add(row.itemKey);
    });
    return Array.from(set)
      .map((key) => {
        const [name = "", erp = ""] = key.split("::");
        const label = !name ? erp : !erp || name.toLowerCase().includes(erp.toLowerCase()) ? name : `${name} - ${erp}`;
        return { value: key, label, searchText: `${name} ${erp}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [rows, companyFilter, orderByFilter, dateFrom, dateTo, valueGreaterThan, quantityGreaterThan, searchTerm]);

  const availableUsers = useMemo(() => {
    const ns = searchTerm.trim().toLowerCase();
    const set = new Set<string>();
    rows.forEach((row) => {
      if (companyFilter && row.companyName !== companyFilter) return;
      if (itemFilter && row.itemKey !== itemFilter) return;
      if ((dateFrom || dateTo) && !isWithinDateRange(row.order.orderDate, dateFrom, dateTo)) return;
      if (valueGreaterThan !== "" && toNumber(row.orderAmount) <= toNumber(valueGreaterThan)) return;
      if (quantityGreaterThan !== "" && toNumber(row.order.qty) <= toNumber(quantityGreaterThan)) return;
      if (ns) {
        const anyMatch = [row.order.orderNo, row.companyName, row.itemName, row.itemErp, row.order.erpCode, row.order.poNumber, row.orderByName]
          .some((v) => String(v || "").toLowerCase().includes(ns));
        if (!anyMatch) return;
      }
      if (row.orderByName) set.add(row.orderByName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, companyFilter, itemFilter, dateFrom, dateTo, valueGreaterThan, quantityGreaterThan, searchTerm]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedRows,
  } = useClientPagination(filteredRows, 25);

  const summary = useMemo(() => {
    const uniqueCompanies = new Set(
      filteredRows.map((row) => String(row.order.companyId || "")).filter(Boolean)
    );

    return {
      totalOrders: filteredRows.length,
      orderValue: filteredRows.reduce((sum, row) => sum + toNumber(row.orderAmount), 0),
      pendingQuantity: filteredRows.reduce((sum, row) => sum + toNumber(row.pendingQty), 0),
      pendingValue: filteredRows.reduce((sum, row) => sum + toNumber(row.pendingQty) * toNumber(row.order.rate), 0),
      companies: uniqueCompanies.size,
    };
  }, [filteredRows]);

  const toggleOrderNoSort = () => {
    setOrderNoSort((current) => (current === "asc" ? "desc" : "asc"));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Orders Master</h2>
        <button
          onClick={() => navigate("/orders/form")}
          className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 font-bold text-white shadow transition hover:bg-indigo-700"
        >
          <Plus size={18} /> New Order
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded p-4 bg-gradient-to-r from-indigo-50 to-indigo-100 border border-indigo-200">
          <div className="text-xs font-bold uppercase tracking-wide text-indigo-600">Total Orders</div>
          <div className="mt-2 text-2xl font-bold text-indigo-800">{summary.totalOrders}</div>
        </div>
        <div className="rounded p-4 bg-gradient-to-r from-emerald-50 to-emerald-100 border border-emerald-200">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-600">Order Value</div>
          <div className="mt-2 text-2xl font-bold text-emerald-800">{formatAmount(summary.orderValue)}</div>
        </div>
        <div className="rounded p-4 bg-gradient-to-r from-yellow-50 to-yellow-100 border border-yellow-200">
          <div className="text-xs font-bold uppercase tracking-wide text-yellow-700">Companies</div>
          <div className="mt-2 text-2xl font-bold text-yellow-800">{summary.companies}</div>
        </div>
        <div className="rounded p-4 bg-gradient-to-r from-rose-50 to-rose-100 border border-rose-200">
          <div className="text-xs font-bold uppercase tracking-wide text-rose-600">Pending Order Quantity</div>
          <div className="mt-2 text-2xl font-bold text-rose-800">{formatAmount(summary.pendingQuantity)}</div>
        </div>
        <div className="rounded p-4 bg-gradient-to-r from-purple-50 to-purple-100 border border-purple-200">
          <div className="text-xs font-bold uppercase tracking-wide text-purple-600">Pending Order Value</div>
          <div className="mt-2 text-2xl font-bold text-purple-800">{formatAmount(summary.pendingValue)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm font-bold text-black xl:col-span-2">
            <span>Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search order, ERP, company, item, PO..."
                className="w-full rounded border border-black py-2 pl-10 pr-3 font-normal"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black">
            <span>Company</span>
            <Select
              options={availableCompanies.map((c) => ({ value: c, label: c }))}
              value={companyFilter ? { value: companyFilter, label: companyFilter } : null}
              onChange={(opt) => setCompanyFilter(opt ? (opt as any).value : "")}
              isClearable
              placeholder="All Companies"
              menuPlacement="bottom"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPosition="fixed"
              styles={{
                control: (provided) => ({ ...provided, minHeight: 40 }),
                menu: (provided) => ({ ...provided, zIndex: 9999 }),
                menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black">
            <span>Item</span>
            <Select
              options={availableItems}
              value={availableItems.find((option) => option.value === itemFilter) || null}
              onChange={(opt) => setItemFilter(opt ? (opt as any).value : "")}
              isClearable
              placeholder="All Items"
              menuPlacement="bottom"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPosition="fixed"
              styles={{
                control: (provided) => ({ ...provided, minHeight: 40 }),
                menu: (provided) => ({ ...provided, zIndex: 9999 }),
                menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black">
            <span>Order By</span>
            <Select
              options={availableUsers.map((u) => ({ value: u, label: u }))}
              value={orderByFilter ? { value: orderByFilter, label: orderByFilter } : null}
              onChange={(opt) => setOrderByFilter(opt ? (opt as any).value : "")}
              isClearable
              placeholder="All Users"
              menuPlacement="bottom"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPosition="fixed"
              styles={{
                control: (provided) => ({ ...provided, minHeight: 40 }),
                menu: (provided) => ({ ...provided, zIndex: 9999 }),
                menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
              }}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6 items-end">
          <label className="flex flex-col gap-1 text-sm font-bold text-black xl:col-span-1">
            <span>Order Date From</span>
            <div className="relative">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded border border-black px-3 py-2 pr-10 font-normal"
              />
              <Calendar size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500" />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black xl:col-span-1">
            <span>Order Date To</span>
            <div className="relative">
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded border border-black px-3 py-2 pr-10 font-normal"
              />
              <Calendar size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500" />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black">
            <span>Value Greater Than</span>
            <input
              type="number"
              value={valueGreaterThan === "" ? "" : String(valueGreaterThan)}
              onChange={(e) => setValueGreaterThan(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Value Greater Than"
              className="rounded border border-black px-3 py-2 font-normal"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-bold text-black">
            <span>Quantity Greater Than</span>
            <input
              type="number"
              value={quantityGreaterThan === "" ? "" : String(quantityGreaterThan)}
              onChange={(e) => setQuantityGreaterThan(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Quantity Greater than"
              className="rounded border border-black px-3 py-2 font-normal"
            />
          </label>

          <div className="flex items-center gap-2 xl:col-span-1">
            <button
              type="button"
              onClick={() => {
                setCompanyFilter("");
                setItemFilter("");
                setOrderByFilter("");
                setDateFrom("");
                setDateTo("");
                setValueGreaterThan("");
                setQuantityGreaterThan("");
                setSearchTerm("");
              }}
              className="ml-auto rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-black bg-white">
        <table className="min-w-full border-collapse border border-black text-sm">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="border border-black px-3 py-2">
                <button
                  type="button"
                  onClick={toggleOrderNoSort}
                  className="flex items-center gap-2 font-bold text-black"
                >
                  <span>Order No</span>
                  {orderNoSort === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </button>
              </th>
              <th className="border border-black px-3 py-2">Order Date</th>
              <th className="border border-black px-3 py-2">Company</th>
              <th className="border border-black px-3 py-2">ERP</th>
              <th className="border border-black px-3 py-2">Item</th>
              <th className="border border-black px-3 py-2">PO Number</th>
              <th className="border border-black px-3 py-2">Qty</th>
              <th className="border border-black px-3 py-2">Rate</th>
              <th className="border border-black px-3 py-2">Order Amount</th>
              <th className="border border-black px-3 py-2">Invoiced Qty</th>
              <th className="border border-black px-3 py-2">Canceled Qty</th>
              <th className="border border-black px-3 py-2">Pending Order Qty</th>
              <th className="border border-black px-3 py-2">Order By</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="border border-black px-3 py-8 text-center text-slate-500">
                  No orders found for the current filters.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
                <tr key={row.order.id} className="align-top">
                  <td className="border border-black px-3 py-2 font-semibold">{row.order.orderNo}</td>
                  <td className="border border-black px-3 py-2 whitespace-nowrap">{formatDate(row.order.orderDate)}</td>
                  <td className="border border-black px-3 py-2 whitespace-normal break-words">{row.companyName}</td>
                  <td className="border border-black px-3 py-2">{row.order.erpCode}</td>
                  <td className="border border-black px-3 py-2 whitespace-normal break-words">{row.itemName}</td>
                  <td className="border border-black px-3 py-2">{row.order.poNumber}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(toNumber(row.order.qty))}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(toNumber(row.order.rate))}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(row.orderAmount)}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(row.invoicedQty)}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(row.canceledQty)}</td>
                  <td className="border border-black px-3 py-2 text-right">{formatAmount(row.pendingQty)}</td>
                  <td className="border border-black px-3 py-2">{row.orderByName}</td>
                </tr>
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
    </div>
  );
}
