import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { formatDate } from "../lib/utils";
import { Company, DispatchPlan, LoadingSlip, Order, OrderSchedule, User } from "../types";

type SortDirection = "asc" | "desc";

type OrderMasterRow = {
  order: Order;
  companyName: string;
  itemName: string;
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
  const [users] = useData<User>("users", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const npdItems = useNpdItems();

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [orderByFilter, setOrderByFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orderNoSort, setOrderNoSort] = useState<SortDirection>("desc");

  const companyMap = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name || ""])),
    [companies]
  );
  const itemMap = useMemo(
    () => new Map(npdItems.map((item) => [item.id, item.name || ""])),
    [npdItems]
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
      const pendingQty = Math.max(0, toNumber(order.qty) - canceledQty);

      return {
        order,
        companyName: companyMap.get(order.companyId) || "",
        itemName: itemMap.get(order.itemId) || "",
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
        if (companyFilter && row.order.companyId !== companyFilter) return false;
        if (itemFilter && row.order.itemId !== itemFilter) return false;
        if (orderByFilter && row.order.orderBy !== orderByFilter) return false;
        if ((dateFrom || dateTo) && !isWithinDateRange(row.order.orderDate, dateFrom, dateTo)) return false;

        if (!normalizedSearch) return true;

        return [
          row.order.orderNo,
          row.companyName,
          row.itemName,
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
  }, [companyFilter, dateFrom, dateTo, itemFilter, orderByFilter, orderNoSort, rows, searchTerm]);

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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded border border-black bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Total Orders</div>
          <div className="mt-2 text-2xl font-bold text-black">{summary.totalOrders}</div>
        </div>
        <div className="rounded border border-black bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Order Value</div>
          <div className="mt-2 text-2xl font-bold text-black">{formatAmount(summary.orderValue)}</div>
        </div>
        <div className="rounded border border-black bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-600">Companies</div>
          <div className="mt-2 text-2xl font-bold text-black">{summary.companies}</div>
        </div>
      </div>

      <div className="grid gap-3 rounded border border-black bg-white p-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm font-bold text-black xl:col-span-2">
          <span>Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search order, ERP, item, PO..."
              className="w-full rounded border border-black py-2 pl-10 pr-3 font-normal"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm font-bold text-black">
          <span>Company</span>
          <select
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
            className="rounded border border-black px-3 py-2 font-normal"
          >
            <option value="">All Companies</option>
            {companies
              .slice()
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-bold text-black">
          <span>Item</span>
          <select
            value={itemFilter}
            onChange={(event) => setItemFilter(event.target.value)}
            className="rounded border border-black px-3 py-2 font-normal"
          >
            <option value="">All Items</option>
            {npdItems
              .slice()
              .sort((left, right) => (left.name || "").localeCompare(right.name || ""))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-bold text-black">
          <span>Order By</span>
          <select
            value={orderByFilter}
            onChange={(event) => setOrderByFilter(event.target.value)}
            className="rounded border border-black px-3 py-2 font-normal"
          >
            <option value="">All Users</option>
            {users
              .slice()
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-bold text-black">
          <span>Order Date From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded border border-black px-3 py-2 font-normal"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-bold text-black">
          <span>Order Date To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded border border-black px-3 py-2 font-normal"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded border border-black bg-white">
        <table className="min-w-full border-collapse border border-black text-sm">
          <thead className="bg-slate-100">
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
