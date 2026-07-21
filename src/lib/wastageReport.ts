import type { Company, Invoice, InvoiceLineItem, OrderItemSource } from "../types";
import { normalizeOrderItemSource, type OrderCatalogItem } from "./orderItems";

export type ScrapInvoiceRow = {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  companyId: string;
  companyName: string;
  erp: string;
  itemName: string;
  qty: number;
  rate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAmount: number;
};

export type ScrapInvoiceFilters = {
  fromDate?: string;
  toDate?: string;
  companyId?: string;
  searchTerm?: string;
};

export type BuildScrapInvoiceRowsArgs = {
  invoices: Invoice[];
  lineItems: InvoiceLineItem[];
  companies: Company[];
  filters?: ScrapInvoiceFilters;
  findItem: (source: OrderItemSource | undefined, itemId: string | undefined) => OrderCatalogItem | undefined;
  findItemAcrossSources: (
    itemId: string | undefined,
    preferredSource?: OrderItemSource,
    erpCode?: string | number
  ) => OrderCatalogItem | undefined;
};

export type ScrapInvoiceSummary = {
  totalQty: number;
  taxableAmount: number;
  gstValue: number;
  totalAmount: number;
  invoiceCount: number;
};

function parseAppDate(value?: string | null) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const onlyDate = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
    const [year, month, day] = onlyDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function buildScrapInvoiceRows({ invoices, lineItems, companies, filters, findItem, findItemAcrossSources }: BuildScrapInvoiceRowsArgs) {
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const from = parseAppDate(filters?.fromDate);
  const to = parseAppDate(filters?.toDate);
  const fromTime = from ? normalizeDate(from) : null;
  const toTime = to ? normalizeDate(to) : null;
  const companyId = String(filters?.companyId || "").trim();
  const needle = String(filters?.searchTerm || "").trim().toLowerCase();

  return lineItems
    .map((line) => {
      const invoice = invoiceMap.get(line.invoiceId);
      if (!invoice) return null;
      const invoiceDate = parseAppDate(invoice.date);
      const invoiceTime = invoiceDate ? normalizeDate(invoiceDate) : null;
      const itemSource = normalizeOrderItemSource(line.itemSource);
      const resolvedItem =
        findItem(itemSource, line.itemId) ||
        (line.npdId ? findItem("FG", line.npdId) : undefined) ||
        findItemAcrossSources(line.itemId, itemSource);
      const itemName = String(resolvedItem?.name || "Unknown").trim();
      if (!itemName.toLowerCase().includes("scrap")) return null;

      const company = companyMap.get(invoice.companyId);
      const taxableAmount = Number(line.amount || 0);
      const cgst = Number(line.cgst || 0);
      const sgst = Number(line.sgst || 0);
      const igst = Number(line.igst || 0);
      const row: ScrapInvoiceRow = {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo || "-",
        invoiceDate: invoice.date,
        companyId: invoice.companyId,
        companyName: company?.name || "Unknown Company",
        erp: String(resolvedItem?.erp || "").trim(),
        itemName,
        qty: Number(line.qty || 0),
        rate: Number(line.rate || 0),
        taxableAmount,
        cgst,
        sgst,
        igst,
        totalAmount: taxableAmount + cgst + sgst + igst,
      };

      if (fromTime != null && (invoiceTime == null || invoiceTime < fromTime)) return null;
      if (toTime != null && (invoiceTime == null || invoiceTime > toTime)) return null;
      if (companyId && row.companyId !== companyId) return null;
      if (needle) {
        const haystack = `${row.invoiceNo} ${row.companyName} ${row.erp} ${row.itemName}`.toLowerCase();
        if (!haystack.includes(needle)) return null;
      }
      return row;
    })
    .filter((row): row is ScrapInvoiceRow => Boolean(row))
    .sort((a, b) => String(b.invoiceDate || "").localeCompare(String(a.invoiceDate || "")) || a.itemName.localeCompare(b.itemName));
}

export function summarizeScrapInvoiceRows(rows: ScrapInvoiceRow[]): ScrapInvoiceSummary {
  const invoiceIds = new Set(rows.map((row) => row.invoiceId));
  return {
    totalQty: rows.reduce((sum, row) => sum + row.qty, 0),
    taxableAmount: rows.reduce((sum, row) => sum + row.taxableAmount, 0),
    gstValue: rows.reduce((sum, row) => sum + row.cgst + row.sgst + row.igst, 0),
    totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
    invoiceCount: invoiceIds.size,
  };
}