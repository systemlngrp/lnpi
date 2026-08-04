import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle, FileText, Plus, Trash2, Upload, Download, Wand2, X } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Company,
  GateEntry,
  GatePass,
  GstRateMaster,
  Item,
  Material,
  MaterialGroup,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialLine,
  InvoiceCurrency,
  PurchaseOrder,
  PurchaseOrderLine,
  Setting,
  Service,
  Supplier,
  UnitMaster,
  ColorMaster,
} from "../types";
import { generateTransactionNo } from "../lib/serial";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import * as XLSX from "xlsx";
import { useNpdItems } from "../hooks/useNpdItems";
import { applySupplyTypeTaxRates, normalizeInvoiceCurrency, recalculateMaterialLine, summarizeMaterialInLines } from "../lib/materialInTaxes";
import { getGatePassLinesWithReturns } from "../lib/gatePassState";
import { canCreateMrrForGateEntry, isGateEntryCancelled } from "../lib/gateEntryState";
import { parsePoMandatoryMrrTypes, supportsPoMandatorySetting } from "../lib/materialInPoMandatory";

type PackingSlipDraft = {
  id: string;
  materialLineId: string;
  materialId: string;
  supplierReelNo: string;
  ourReelNo: string;
  weightKg: string;
  supplierPoNo: string;
  ourPoId: string;
  ourPoNo: string;
};

type AiMrrItemType = "Reel" | "Other";

type AiMrrLine = {
  itemName?: string;
  erpCode?: string | number;
  itemType?: AiMrrItemType | string;
  materialGroupName?: string;
  uom?: string;
  qty?: number;
  invoiceRate?: number;
  gstRate?: number;
  poNo?: string;
  size?: number | null;
  gsm?: number | null;
  bf?: number | null;
  color?: string;
  confidence?: number;
};

type AiMrrDraft = {
  supplierName?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  mrrDate?: string;
  mrrType?: MaterialIn["mrrType"] | string;
  invoiceCurrency?: InvoiceCurrency | string;
  exchangeRate?: number | null;
  lines?: AiMrrLine[];
};

type AiUploadFile = {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
};

type AiLineMatch = {
  line: AiMrrLine;
  index: number;
  material?: Material;
  po?: { poId?: string; poNo?: string; poLineId?: string; poRate?: number } | null;
  status: "matched" | "missing" | "warning";
  reason: string;
};

type QuickMaterialForm = {
  lineIndex: number;
  type: AiMrrItemType;
  erpCode: string;
  name: string;
  uom: string;
  materialGroupId: string;
  color: string;
  size: string;
  gsm: string;
  bf: string;
  active: "Yes" | "No";
};
type ReelUploadRow = {
  materialId: string;
  materialName: string;
  supplierReelNo: string;
  weightKg: number;
  supplierPoNo: string;
  ourPoId: string;
  ourPoNo: string;
  invoiceRate?: number;
};

function formatReelNo(value: number) {
  return String(value).padStart(5, "0");
}

function roundCurrencyValue(value: number) {
  return Number(Number(value || 0).toFixed(4));
}

export function MaterialInForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips, setPackingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [materials, setMaterials] = useData<Material>("materials", []);
  const [services] = useData<Service>("services", []);
  const [materialGroups, setMaterialGroups] = useData<MaterialGroup>("material-groups", []);
  const [units] = useData<UnitMaster>("units", []);
  const [colors] = useData<ColorMaster>("color_masters", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [gstRateMasters] = useData<GstRateMaster>("gst_rate_masters", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [settings] = useData<Setting>("settings", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [invoiceCurrency, setInvoiceCurrency] = useState<InvoiceCurrency>("INR");
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [mrrType, setMrrType] = useState<MaterialIn["mrrType"]>("Others");
  const [insurance, setInsurance] = useState<number | "">("");
  const [otherCharges, setOtherCharges] = useState<number | "">("");
  const [expenseCGST, setExpenseCGST] = useState<number | "">("");
  const [expenseSGST, setExpenseSGST] = useState<number | "">("");
  const [expenseIGST, setExpenseIGST] = useState<number | "">("");
  const [roundOff, setRoundOff] = useState<number | "">("");

  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [currentItemId, setCurrentItemId] = useState("");
  const [currentSourceGatePassLineId, setCurrentSourceGatePassLineId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [currentReceiptQty, setCurrentReceiptQty] = useState<number | "">("");
  const [currentInvoiceRate, setCurrentInvoiceRate] = useState<number | "">("");
  const [currentPoLineId, setCurrentPoLineId] = useState("");
  const [packingSlipDrafts, setPackingSlipDrafts] = useState<Record<string, PackingSlipDraft[]>>({});
  const reelBulkInputRef = useRef<HTMLInputElement>(null);
  const hasAutoFilledServiceReturnRef = useRef(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiFiles, setAiFiles] = useState<AiUploadFile[]>([]);
  const [aiDraft, setAiDraft] = useState<AiMrrDraft | null>(null);
  const [isAiFetching, setIsAiFetching] = useState(false);
  const [aiError, setAiError] = useState("");
  const [quickMaterial, setQuickMaterial] = useState<QuickMaterialForm | null>(null);
  const [newAiGroupName, setNewAiGroupName] = useState("");
  const [savingQuickMaterial, setSavingQuickMaterial] = useState(false);
  const [savingAiGroup, setSavingAiGroup] = useState(false);


  const gateEntryId = searchParams.get("gateEntryId") || "";
  const editId = searchParams.get("edit") || "";
  const linkedGateEntry = useMemo(
    () => gateEntries.find((entry) => entry.id === gateEntryId),
    [gateEntries, gateEntryId]
  );
  const linkedSourceGatePass = useMemo(
    () => gatePasses.find((entry) => entry.id === linkedGateEntry?.sourceGatePassId),
    [gatePasses, linkedGateEntry?.sourceGatePassId]
  );
  const editingEntry = useMemo(
    () => materialIn.find((entry) => entry.id === editId) || null,
    [editId, materialIn]
  );

  const linkedSupplierName = useMemo(() => {
    const s = suppliers.find((supplier) => supplier.id === supplierId);
    if (s) return s.name;
    const c = companies.find((company) => company.id === supplierId);
    if (c) return c.name;
    return "";
  }, [suppliers, companies, supplierId]);

  const supplierGstSupplyType = useMemo(() => {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    if (supplier?.gstSupplyType) return supplier.gstSupplyType;
    const company = companies.find((entry) => entry.id === supplierId);
    return company?.gstSupplyType || "INTRA_STATE";
  }, [companies, supplierId, suppliers]);

  const isInterState = supplierGstSupplyType === "INTER_STATE";
  const totalExpenseBase = Number(insurance || 0) + Number(otherCharges || 0);
  const hasExpenseBase = totalExpenseBase > 0;

  const isReturnableReceiptFlow = Boolean(
    (linkedGateEntry?.purpose === "Returnable Receipt" && linkedGateEntry?.sourceGatePassId) ||
    editingEntry?.mrrType === "Service Return"
  );
  const isFgType = mrrType === "Rejection In" || mrrType === "FG Purchase";
  const isServiceReturn = isReturnableReceiptFlow || mrrType === "Service Return";
  const poMandatoryMrrTypes = useMemo(() => new Set(parsePoMandatoryMrrTypes(settings[0])), [settings]);
  const supportsPoSettingForCurrentMrrType = supportsPoMandatorySetting(mrrType);
  const isPoMandatoryForCurrentMrrType = supportsPoSettingForCurrentMrrType && poMandatoryMrrTypes.has(mrrType);
  const showPoLineSelection = !isServiceReturn && (mrrType === "Others" || mrrType === "FG Purchase");
  const normalizedInvoiceCurrency = normalizeInvoiceCurrency(invoiceCurrency);
  const isUsdInvoice = normalizedInvoiceCurrency === "USD";
  const numericExchangeRate = isUsdInvoice ? Number(exchangeRate || 0) : 0;
  const convertInrToUsd = (amount: number) => {
    if (!numericExchangeRate || numericExchangeRate <= 0) return 0;
    return roundCurrencyValue(Number(amount || 0) / numericExchangeRate);
  };
  const recalculateForCurrentCurrency = (line: MaterialLine) =>
    recalculateMaterialLine(
      {
        ...line,
        invoiceCurrency: normalizedInvoiceCurrency,
        exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
      },
      {
        invoiceCurrency: normalizedInvoiceCurrency,
        exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
      }
    );
  const parseNumberInput = (value: string) => (value === "" ? "" : parseFloat(value));
  const handleExpenseCgstChange = (value: string) => {
    const nextValue = parseNumberInput(value);
    setExpenseCGST(nextValue);
    if (!isInterState) {
      setExpenseSGST(nextValue);
    }
  };
  const handleExpenseSgstChange = (value: string) => {
    const nextValue = parseNumberInput(value);
    setExpenseSGST(nextValue);
    if (!isInterState) {
      setExpenseCGST(nextValue);
    }
  };
  const handleExpenseIgstChange = (value: string) => {
    setExpenseIGST(parseNumberInput(value));
  };

  const materialOptions = useMemo(
    () => {
      if (isFgType) {
        return npdItems
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({
            value: item.id,
            label: `${item.name}${item.erp ? ` (${item.erp})` : ""}`,
          }));
      }
      return materials
        .filter((material) => material.active !== "No")
        .filter((material) => (mrrType === "Reel" ? material.type === "Reel" : material.type !== "Reel"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        }));
    },
    [materials, npdItems, mrrType, isFgType]
  );

  const serviceOptions = useMemo(
    () =>
      services
        .filter((service) => service.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((service) => ({ value: service.id, label: service.name })),
    [services]
  );

  const activeItemOptions = isServiceReturn ? serviceOptions : materialOptions;
  const activeItemLabel = isServiceReturn ? "Service" : isFgType ? "FG Item" : "Material";
  const activeItemPlaceholder = isServiceReturn ? "Select Service..." : isFgType ? "Select Item..." : "Select Material...";
  const activeItemSelectKey = isServiceReturn ? "service" : isFgType ? "fg" : mrrType === "Reel" ? "reel" : "material";

  const supplierOptions = useMemo(
    () => {
      const combined = [
        ...suppliers.filter(s => s.active !== "No").map(s => ({ value: s.id, label: s.name })),
        ...companies.map(c => ({ value: c.id, label: c.name }))
      ];
      return combined.sort((a, b) => a.label.localeCompare(b.label));
    },
    [suppliers, companies]
  );

  const mrrTypeOptions = [
    { value: "Reel", label: "Reel" },
    { value: "Others", label: "Others" },
    { value: "Rejection In", label: "Rejection In" },
    { value: "FG Purchase", label: "FG Purchase" },
    { value: "Service Return", label: "Service Return" },
  ];

  useEffect(() => {
    if (editingEntry) return;
    if (!gateEntryId) return;
    if (!linkedGateEntry) return;
    if (canCreateMrrForGateEntry(linkedGateEntry)) return;
    alert(isGateEntryCancelled(linkedGateEntry)
      ? "Gate Entry is cancelled. MRR cannot be created for this Gate Entry."
      : "MRR has already been created for this Gate Entry.");
    navigate("/material-receipt/pending-mrr", { replace: true });
  }, [editingEntry, gateEntryId, linkedGateEntry, navigate]);

  useEffect(() => {
    if (editingEntry) return;
    if (!linkedGateEntry) return;
    setDate(linkedGateEntry.date || new Date().toISOString().split("T")[0]);
    setInvoiceNo(linkedGateEntry.invoiceNo || "");
    setInvDate(linkedGateEntry.date || "");
    setSupplierId(linkedGateEntry.supplierId || "");
    if (linkedGateEntry.purpose === "Returnable Receipt" && linkedGateEntry.sourceGatePassId) {
      setMrrType("Service Return");
    }
  }, [editingEntry, linkedGateEntry]);

  useEffect(() => {
    hasAutoFilledServiceReturnRef.current = false;
  }, [gateEntryId, editId]);

  useEffect(() => {
    if (!editingEntry) return;

    setDate(editingEntry.date || new Date().toISOString().split("T")[0]);
    setInvoiceNo(editingEntry.invoiceNo || "");
    setInvDate(editingEntry.invDate || "");
    const loadedCurrency = normalizeInvoiceCurrency(editingEntry.invoiceCurrency);
    const loadedExchangeRate = loadedCurrency === "USD" ? (editingEntry.exchangeRate ?? "") : "";
    setSupplierId(editingEntry.supplierId || "");
    setInvoiceCurrency(loadedCurrency);
    setExchangeRate(loadedExchangeRate as number | "");
    setMrrType(editingEntry.mrrType || "Others");
    setInsurance(editingEntry.insurance ?? "");
    setOtherCharges(editingEntry.otherCharges ?? "");
    setExpenseCGST(editingEntry.expenseCGST ?? "");
    setExpenseSGST(editingEntry.expenseSGST ?? "");
    setExpenseIGST(editingEntry.expenseIGST ?? "");
    setRoundOff(editingEntry.roundOff ?? "");
    setLines((editingEntry.lines || []).map((line) => recalculateMaterialLine({ ...line }, { invoiceCurrency: loadedCurrency, exchangeRate: loadedCurrency === "USD" ? Number(editingEntry.exchangeRate || line.exchangeRate || 0) : undefined })));

    const existingPackingSlips = packingSlips.filter((row) => row.materialInId === editingEntry.id);
    const nextDrafts = existingPackingSlips.reduce<Record<string, PackingSlipDraft[]>>((acc, row) => {
      const current = acc[row.materialLineId] || [];
      current.push({
        id: row.id,
        materialLineId: row.materialLineId,
        materialId: row.materialId,
        supplierReelNo: row.supplierReelNo || "",
        ourReelNo: row.ourReelNo,
        weightKg: String(row.weightKg || ""),
        supplierPoNo: row.supplierPoNo || "",
        ourPoId: row.ourPoId || "",
        ourPoNo: row.ourPoNo || "",
      });
      acc[row.materialLineId] = current;
      return acc;
    }, {});
    setPackingSlipDrafts(nextDrafts);
    resetLineDrafts();
  }, [editingEntry, packingSlips]);

  useEffect(() => {
    if (!lines.length) return;
    setLines((prev) =>
      prev.map((line) => applySupplyTypeTaxRates(line, isInterState ? "INTER_STATE" : "INTRA_STATE", { forceFromGstRate: true }))
    );
  }, [isInterState]);

  useEffect(() => {
    if (!hasExpenseBase) {
      if (expenseCGST !== "") setExpenseCGST("");
      if (expenseSGST !== "") setExpenseSGST("");
      if (expenseIGST !== "") setExpenseIGST("");
      return;
    }

    if (isInterState) {
      if (expenseCGST !== "") setExpenseCGST("");
      if (expenseSGST !== "") setExpenseSGST("");
      return;
    }

    if (expenseIGST !== "") {
      setExpenseIGST("");
      return;
    }

    if (expenseCGST === "" && expenseSGST !== "") {
      setExpenseCGST(expenseSGST);
      return;
    }
    if (expenseSGST === "" && expenseCGST !== "") {
      setExpenseSGST(expenseCGST);
      return;
    }
    if (expenseCGST !== "" && expenseSGST !== "" && expenseCGST !== expenseSGST) {
      setExpenseSGST(expenseCGST);
    }
  }, [expenseCGST, expenseIGST, expenseSGST, hasExpenseBase, isInterState]);

  useEffect(() => {
    if (!lines.length) return;
    setLines((prev) => prev.map((line) => recalculateForCurrentCurrency(line)));
  }, [normalizedInvoiceCurrency, numericExchangeRate]);

  const pendingGatePassLines = useMemo(() => {
    if (!linkedSourceGatePass) return [];
    return getGatePassLinesWithReturns(linkedSourceGatePass, materialIn, editingEntry?.id).filter((line) => Number(line.pendingQty || 0) > 0);
  }, [editingEntry?.id, linkedSourceGatePass, materialIn]);

  const resolveServiceForGatePassLine = (sourceLine?: { itemId?: string; itemName?: string; itemDescription?: string }) => {
    if (!sourceLine) return undefined;

    const normalizedCandidates = [sourceLine.itemName, sourceLine.itemDescription]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    return services.find((service) => service.id === sourceLine.itemId)
      || services.find((service) => normalizedCandidates.includes(service.name.trim().toLowerCase()))
      || services.find((service) => normalizedCandidates.some((candidate) => service.name.trim().toLowerCase().includes(candidate) || candidate.includes(service.name.trim().toLowerCase())));
  };

  useEffect(() => {
    if (!isServiceReturn) return;
    const sourceLine = pendingGatePassLines.find((line) => line.id === currentSourceGatePassLineId);
    if (!sourceLine) return;

    const matchedService = resolveServiceForGatePassLine(sourceLine);

    setCurrentItemId(matchedService?.id || "");
    setCurrentQty(Number(sourceLine.pendingQty || 0));
    setCurrentInvoiceRate(Number(sourceLine.rate || 0));
  }, [currentSourceGatePassLineId, isServiceReturn, pendingGatePassLines, services]);

  useEffect(() => {
    if (editingEntry) return;
    if (hasAutoFilledServiceReturnRef.current) return;
    if (!linkedGateEntry || linkedGateEntry.purpose !== "Returnable Receipt" || !linkedGateEntry.sourceGatePassId) return;
    if (!pendingGatePassLines.length) return;

    const autoLines = pendingGatePassLines.map((sourceLine) => {
      const matchedService = resolveServiceForGatePassLine(sourceLine);
      const qty = Number(sourceLine.pendingQty || 0);
      const invoiceRate = Number(sourceLine.rate || 0);

      return applySupplyTypeTaxRates({
        id: crypto.randomUUID(),
        itemId: matchedService?.id || sourceLine.itemId || sourceLine.id,
        itemName: matchedService?.name || sourceLine.itemName || sourceLine.itemDescription,
        lineType: "Service",
        serviceId: matchedService?.id || sourceLine.itemId || sourceLine.id,
        serviceName: matchedService?.name || sourceLine.itemName || sourceLine.itemDescription,
        sourceGatePassId: linkedSourceGatePass?.id,
        sourceGatePassNo: linkedSourceGatePass?.gatePassNo,
        sourceGatePassLineId: sourceLine.id,
        sourceGatePassItemDescription: sourceLine.itemDescription || sourceLine.itemName,
        qty,
        uom: sourceLine.uom || "",
        invoiceQty: qty,
        invoiceRate,
        actualQty: qty,
        rate: invoiceRate,
        value: qty * invoiceRate,
        gstRate: 0,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
      }, isInterState ? "INTER_STATE" : "INTRA_STATE", { forceFromGstRate: true });
    });

    const firstSourceLine = pendingGatePassLines[0];
    const firstMatchedService = resolveServiceForGatePassLine(firstSourceLine);

    setLines(autoLines);
    resetLineDrafts();
    setCurrentSourceGatePassLineId(firstSourceLine?.id || "");
    setCurrentItemId(firstMatchedService?.id || "");
    setCurrentQty(Number(firstSourceLine?.pendingQty || 0));
    setCurrentInvoiceRate(Number(firstSourceLine?.rate || 0));
    hasAutoFilledServiceReturnRef.current = true;
  }, [editingEntry, isInterState, linkedGateEntry, linkedSourceGatePass, pendingGatePassLines, services]);

  const getMaterial = (materialId: string) => {
    if (isServiceReturn) return services.find((service) => service.id === materialId);
    if (isFgType) return npdItems.find((item) => item.id === materialId);
    return materials.find((material) => material.id === materialId);
  };

  const getLineDisplayName = (line: MaterialLine) => {
    if (isServiceReturn) {
      return line.itemName || services.find((service) => service.id === (line.serviceId || line.itemId))?.name || "Unknown";
    }

    if (isFgType) {
      return line.itemName || npdItems.find((item) => item.id === line.itemId)?.name || "Unknown";
    }

    return (
      line.itemName ||
      materials.find((item) => item.id === line.itemId)?.name ||
      npdItems.find((item) => item.id === line.itemId)?.name ||
      "Unknown"
    );
  };

  const normalizeMatchText = (value?: string | number | null) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const normalizePartyName = (value?: string | null) =>
    normalizeMatchText(value)
      .replace(/\b(cr|dr)\b$/i, "")
      .replace(/\s+/g, " ")
      .trim();

  const getPartyName = (partyId?: string) =>
    suppliers.find((supplier) => supplier.id === partyId)?.name ||
    companies.find((company) => company.id === partyId)?.name ||
    "";

  const isApprovedOrderForSelectedSupplier = (order: PurchaseOrder) => {
    if (order.status !== "Approved") return false;
    if (!supplierId) return true;
    if (order.supplierId === supplierId) return true;

    const selectedPartyName = normalizePartyName(getPartyName(supplierId));
    const orderPartyName = normalizePartyName(getPartyName(order.supplierId));
    return Boolean(selectedPartyName && orderPartyName && selectedPartyName === orderPartyName);
  };

  const getMaterialErpCode = (materialId: string) => {
    const item = getMaterial(materialId);
    if (!item) return "";
    if ("erpCode" in item) return normalizeMatchText((item as Material).erpCode);
    if ("erp" in item) return normalizeMatchText((item as Item).erp);
    return "";
  };

  const poLineMatchesMaterial = (line: PurchaseOrderLine, materialId: string) => {
    if (line.materialId === materialId) return true;

    const materialErpCode = getMaterialErpCode(materialId);
    const lineErpCode = normalizeMatchText(line.erpCode);
    return Boolean(materialErpCode && lineErpCode && materialErpCode === lineErpCode);
  };

  const getApprovedPoOptionsForMaterial = (materialId: string) => {
    const approvedOrders = purchaseOrders.filter(isApprovedOrderForSelectedSupplier);

    return approvedOrders
      .flatMap((order) =>
        purchaseOrderLines
          .filter((line) => line.purchaseOrderId === order.id && poLineMatchesMaterial(line, materialId))
          .map((line) => ({
            value: line.id,
            label: `${order.poNo} | Qty ${Number(line.qty || 0)} @ ${Number(line.rate || 0).toFixed(2)}`,
          }))
      );
  };

  const getResolvedPoForMaterial = (materialId: string, ourPoNoRaw: string) => {
    const search = String(ourPoNoRaw || "").trim().toLowerCase();
    if (!search) return null;

    const approvedOrders = purchaseOrders.filter(isApprovedOrderForSelectedSupplier);

    for (const order of approvedOrders) {
      if (!String(order.poNo || "").trim().toLowerCase().includes(search)) continue;
      const matchingLine = purchaseOrderLines.find(
        (line) => line.purchaseOrderId === order.id && poLineMatchesMaterial(line, materialId)
      );
      if (matchingLine) {
        return {
          poId: order.id,
          poNo: order.poNo || "",
          poLineId: matchingLine.id,
          poRate: Number(matchingLine.rate || 0),
        };
      }
    }

    return null;
  };

  const normalizeAiDate = (value?: string) => {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  };

  const normalizeAiItemType = (value?: string): AiMrrItemType =>
    String(value || "").trim().toLowerCase() === "reel" ? "Reel" : "Other";

  const normalizeForAiMatch = (value?: string | number | null) =>
    normalizeMatchText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  const getNextAiErpCode = (type: AiMrrItemType) => {
    const numericValues = materials
      .filter((material) => material.type === type)
      .map((material) => Number(material.erpCode))
      .filter((value) => Number.isFinite(value) && value > 0);
    return String(numericValues.length ? Math.max(...numericValues) + 1 : 1);
  };

  const getReelDisplayName = (erpCode: string | number, size: number, gsm: number, bf: number, color: string) =>
    `${erpCode} - Size: ${size} CM X GSM: ${gsm} X BF: ${bf}   Color - ${color}`;

  const findAiSupplier = (supplierName?: string) => {
    const search = normalizePartyName(supplierName || "");
    if (!search) return null;
    const parties = [
      ...suppliers.filter((entry) => entry.active !== "No").map((entry) => ({ id: entry.id, name: entry.name })),
      ...companies.map((entry) => ({ id: entry.id, name: entry.name })),
    ];
    return (
      parties.find((entry) => normalizePartyName(entry.name) === search) ||
      parties.find((entry) => {
        const name = normalizePartyName(entry.name);
        return Boolean(name && search && (name.includes(search) || search.includes(name)));
      }) ||
      null
    );
  };

  const parseAiPositiveNumber = (value: unknown) => {
    const numeric = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  };

  const parseAiNumberFromText = (text: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseAiPositiveNumber(match[1]);
      if (value) return value;
    }
    return 0;
  };

  const getAiReelSpecs = (line: AiMrrLine) => {
    const text = [line.itemName, line.erpCode].map((part) => String(part || "")).join(" ");
    const combined = text.match(/(?:\bsize\s*[:/-]?\s*)?(\d+(?:\.\d+)?)\s*(?:cm)?\s*(?:x|\/|-)\s*gsm\s*[:/-]?\s*(\d+(?:\.\d+)?)\s*(?:x|\/|-)\s*bf\s*[:/-]?\s*(\d+(?:\.\d+)?)/i);
    const textSize = combined ? parseAiPositiveNumber(combined[1]) : parseAiNumberFromText(text, [/\bsize\s*[:/-]?\s*(\d+(?:\.\d+)?)/i]);
    const textGsm = combined ? parseAiPositiveNumber(combined[2]) : parseAiNumberFromText(text, [/\bgsm\s*[:/-]?\s*(\d+(?:\.\d+)?)/i]);
    const textBf = combined ? parseAiPositiveNumber(combined[3]) : parseAiNumberFromText(text, [/\bbf\s*[:/-]?\s*(\d+(?:\.\d+)?)/i]);
    return {
      size: textSize || parseAiPositiveNumber(line.size),
      gsm: textGsm || parseAiPositiveNumber(line.gsm),
      bf: textBf || parseAiPositiveNumber(line.bf),
    };
  };

  const normalizeAiReelLine = (line: AiMrrLine): AiMrrLine => {
    const specs = getAiReelSpecs(line);
    return {
      ...line,
      size: specs.size || line.size,
      gsm: specs.gsm || line.gsm,
      bf: specs.bf || line.bf,
    };
  };

  const numbersMatch = (left: unknown, right: unknown) => {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;
  };

  const hasValidReelSpecs = (line: AiMrrLine) => {
    const specs = getAiReelSpecs(line);
    return specs.size > 0 && specs.gsm > 0 && specs.bf > 0;
  };

  const getReelSpecLabel = (line: AiMrrLine) => {
    const specs = getAiReelSpecs(line);
    return specs.size && specs.gsm && specs.bf ? `Size ${specs.size} / GSM ${specs.gsm} / BF ${specs.bf}` : "Size/GSM/BF incomplete";
  };

  const findAiReelMaterialBySpecs = (line: AiMrrLine) => {
    const specs = getAiReelSpecs(line);
    if (!specs.size || !specs.gsm || !specs.bf) return undefined;
    return materials
      .filter((material) => material.active !== "No" && material.type === "Reel")
      .find((material) =>
        numbersMatch(material.size, specs.size) &&
        numbersMatch(material.gsm, specs.gsm) &&
        numbersMatch(material.bf, specs.bf)
      );
  };

  const findAiMaterial = (line: AiMrrLine) => {
    const expectedType = normalizeAiItemType(line.itemType);
    const activeMaterials = materials.filter((material) => material.active !== "No");

    if (expectedType === "Reel") {
      return findAiReelMaterialBySpecs(line);
    }

    const erp = normalizeForAiMatch(line.erpCode);
    const name = normalizeForAiMatch(line.itemName);
    if (erp) {
      const byErp = activeMaterials.find((material) => material.type !== "Reel" && normalizeForAiMatch(material.erpCode) === erp);
      if (byErp) return byErp;
    }
    if (!name) return undefined;
    return (
      activeMaterials.find((material) => material.type !== "Reel" && normalizeForAiMatch(material.name) === name) ||
      activeMaterials.find((material) => {
        if (material.type === "Reel") return false;
        const materialName = normalizeForAiMatch(material.name);
        return Boolean(materialName && (materialName.includes(name) || name.includes(materialName)));
      })
    );
  };

  const isApprovedOrderForParty = (order: PurchaseOrder, partyId?: string) => {
    if (order.status !== "Approved") return false;
    if (!partyId) return true;
    if (order.supplierId === partyId) return true;
    const selectedPartyName = normalizePartyName(getPartyName(partyId));
    const orderPartyName = normalizePartyName(getPartyName(order.supplierId));
    return Boolean(selectedPartyName && orderPartyName && selectedPartyName === orderPartyName);
  };

  const getResolvedAiPoForMaterial = (materialId: string, ourPoNoRaw: string, partyId?: string) => {
    const search = String(ourPoNoRaw || "").trim().toLowerCase();
    if (!search) return null;
    const approvedOrders = purchaseOrders.filter((order) => isApprovedOrderForParty(order, partyId));
    for (const order of approvedOrders) {
      if (!String(order.poNo || "").trim().toLowerCase().includes(search)) continue;
      const matchingLine = purchaseOrderLines.find(
        (line) => line.purchaseOrderId === order.id && poLineMatchesMaterial(line, materialId)
      );
      if (matchingLine) {
        return { poId: order.id, poNo: order.poNo || "", poLineId: matchingLine.id, poRate: Number(matchingLine.rate || 0) };
      }
    }
    return null;
  };

  const aiMatchedSupplier = useMemo(() => findAiSupplier(aiDraft?.supplierName), [aiDraft?.supplierName, suppliers, companies]);

  const aiSuggestedMrrType = useMemo<MaterialIn["mrrType"]>(() => {
    const explicitType = String(aiDraft?.mrrType || "").trim().toLowerCase();
    if (explicitType === "reel") return "Reel";
    const hasReelLine = (aiDraft?.lines || []).some((line) => normalizeAiItemType(line.itemType) === "Reel");
    return hasReelLine ? "Reel" : "Others";
  }, [aiDraft]);

  const aiLineMatches = useMemo<AiLineMatch[]>(() => {
    return (aiDraft?.lines || []).map((line, index) => {
      const expectedType = normalizeAiItemType(line.itemType);
      const lineForMatch = expectedType === "Reel" ? normalizeAiReelLine(line) : line;
      if (expectedType === "Reel" && !hasValidReelSpecs(lineForMatch)) {
        return { line: lineForMatch, index, status: "missing", reason: "Reel Size, GSM, and BF are required before matching." };
      }
      const material = findAiMaterial(lineForMatch);
      if (!material) {
        return {
          line: lineForMatch,
          index,
          status: "missing",
          reason: expectedType === "Reel" ? `${getReelSpecLabel(lineForMatch)} not found in Reel Material Master.` : "Item not found in Material Master.",
        };
      }
      const po = getResolvedAiPoForMaterial(material.id, String(lineForMatch.poNo || ""), aiMatchedSupplier?.id);
      if (material.type !== expectedType) {
        return { line: lineForMatch, index, material, po, status: "warning", reason: `Existing item type is ${material.type}, AI suggests ${expectedType}.` };
      }
      return { line: lineForMatch, index, material, po, status: "matched", reason: expectedType === "Reel" ? "Matched by Size/GSM/BF." : "Matched." };
    });
  }, [aiDraft, materials, purchaseOrders, purchaseOrderLines, aiMatchedSupplier?.id]);

  const aiHasMissingSupplier = Boolean(aiDraft && !aiMatchedSupplier);
  const aiBlockingIssues = aiHasMissingSupplier || aiLineMatches.some((entry) => entry.status !== "matched");
  const aiCanSetData = Boolean(aiDraft && !aiBlockingIssues && aiLineMatches.length > 0);

  const materialGroupOptions = useMemo(
    () => materialGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).map((group) => ({ value: group.id, label: group.name })),
    [materialGroups]
  );

  const unitOptions = useMemo(
    () => units.filter((unit) => unit.active !== "No").sort((a, b) => a.name.localeCompare(b.name)).map((unit) => ({ value: unit.name, label: unit.name })),
    [units]
  );

  const colorOptions = useMemo(
    () => colors.slice().sort((a, b) => a.name.localeCompare(b.name)).map((color) => ({ value: color.name, label: color.name })),
    [colors]
  );
  const getPurchaseOrderLine = (poLineId: string) =>
    purchaseOrderLines.find((line) => line.id === poLineId);

  const getPurchaseOrder = (purchaseOrderId?: string) =>
    purchaseOrders.find((order) => order.id === purchaseOrderId);

  const gstRateOptions = useMemo(
    () =>
      [...gstRateMasters]
        .filter((entry) => entry.active !== "No")
        .sort((a, b) => Number(a.rate || 0) - Number(b.rate || 0))
        .map((entry) => ({
          value: String(Number(entry.rate || 0)),
          label: `${entry.name} (${Number(entry.rate || 0).toFixed(2)}%)`,
        })),
    [gstRateMasters]
  );

  const {
    totalInvoiceValue,
    totalInvoiceValueUsd,
    totalActualValue,
    totalActualValueUsd,
    totalCgst,
    totalSgst,
    totalIgst,
    expenseCGSTValue,
    expenseSGSTValue,
    expenseIGSTValue,
    totalInvoiceValueAfterGst,
    insuranceValue,
    otherChargesValue,
    roundOffValue,
    totalAmount,
  } = useMemo(
    () =>
      summarizeMaterialInLines(
        lines,
        insurance,
        otherCharges,
        roundOff,
        {
          expenseCGST,
          expenseSGST,
          expenseIGST,
        },
        {
          invoiceCurrency: normalizedInvoiceCurrency,
          exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
        }
      ),
    [lines, insurance, otherCharges, roundOff, expenseCGST, expenseSGST, expenseIGST, normalizedInvoiceCurrency, numericExchangeRate, isUsdInvoice]
  );

  const getAllDraftSlips = () => Object.values(packingSlipDrafts).flat();

  const getNextOurReelNo = () => {
    const persistedNumbers = packingSlips
      .map((row) => row.ourReelNo)
      .map((value) => Number(String(value).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const draftNumbers = getAllDraftSlips()
      .map((row) => Number(String(row.ourReelNo).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const maxValue = Math.max(0, ...persistedNumbers, ...draftNumbers);
    return formatReelNo(maxValue + 1);
  };

  const syncReelLineTotals = (lineId: string, nextDrafts: PackingSlipDraft[]) => {
    const totalWeight = nextDrafts.reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);
    const uniquePoLineIds = Array.from(new Set(nextDrafts.map((slip) => String(slip.ourPoId || "").trim()).filter(Boolean)));
    const resolvedPoLine = uniquePoLineIds.length === 1 ? getPurchaseOrderLine(uniquePoLineIds[0]) : undefined;
    const resolvedPo = resolvedPoLine ? getPurchaseOrder(resolvedPoLine.purchaseOrderId) : undefined;

    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? recalculateForCurrentCurrency({
              ...line,
              qty: totalWeight,
              invoiceQty: totalWeight,
              actualQty: totalWeight,
              poLineId: resolvedPoLine?.id || (uniquePoLineIds.length === 0 ? "" : line.poLineId),
              poId: resolvedPo?.id || (uniquePoLineIds.length === 0 ? undefined : line.poId),
              poNo: resolvedPo?.poNo || (uniquePoLineIds.length === 0 ? undefined : line.poNo),
              poRate: resolvedPoLine ? Number(resolvedPoLine.rate || 0) : (uniquePoLineIds.length === 0 ? 0 : Number(line.poRate || 0)),
            })
          : line
      )
    );
  };

  const resetLineDrafts = () => {
    setCurrentItemId("");
    setCurrentSourceGatePassLineId("");
    setCurrentQty("");
    setCurrentReceiptQty("");
    setCurrentInvoiceRate("");
    setCurrentPoLineId("");
  };

  const handleCurrentPoLineChange = (value: string) => {
    setCurrentPoLineId(value);
    if (!value) return;
    const poLine = getPurchaseOrderLine(value);
    if (!poLine) return;
    const poRate = Number(poLine.rate || 0);
    if (isUsdInvoice) {
      setCurrentInvoiceRate(numericExchangeRate > 0 ? convertInrToUsd(poRate) : "");
      return;
    }
    setCurrentInvoiceRate(poRate);
  };

  const handleInvoiceCurrencyChange = (value: string) => {
    const nextCurrency = normalizeInvoiceCurrency(value);
    setInvoiceCurrency(nextCurrency);
    if (nextCurrency === "INR") {
      setExchangeRate("");
    }
    setCurrentInvoiceRate("");
  };

  const handleMrrTypeChange = (value: any) => {
    setMrrType(value);
    setLines([]);
    setPackingSlipDrafts({});
    resetLineDrafts();
  };

  const handleAddLine = () => {
    if (!currentItemId) return;
    if (isUsdInvoice && (!numericExchangeRate || numericExchangeRate <= 0)) {
      alert("Exchange rate must be greater than 0 for USD invoices.");
      return;
    }

    if (isServiceReturn) {
      const service = services.find((entry) => entry.id === currentItemId);
      const sourceLine = pendingGatePassLines.find((line) => line.id === currentSourceGatePassLineId);
      const qty = Number(currentQty || 0);
      const invoiceRateInput = Number(currentInvoiceRate || 0);
      if (!service || !sourceLine || qty <= 0 || qty > Number(sourceLine.pendingQty || 0) || invoiceRateInput <= 0) return;

      const newLine = applySupplyTypeTaxRates({
        id: crypto.randomUUID(),
        itemId: service.id,
        itemName: service.name,
        lineType: "Service",
        serviceId: service.id,
        serviceName: service.name,
        sourceGatePassId: linkedSourceGatePass?.id,
        sourceGatePassNo: linkedSourceGatePass?.gatePassNo,
        sourceGatePassLineId: sourceLine.id,
        sourceGatePassItemDescription: sourceLine.itemDescription || sourceLine.itemName,
        qty,
        uom: sourceLine.uom || "",
        invoiceCurrency: normalizedInvoiceCurrency,
        exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
        invoiceQty: qty,
        rate: invoiceRateInput,
        value: qty * invoiceRateInput,
        ...(isUsdInvoice
          ? { invoiceRateUsd: invoiceRateInput }
          : { invoiceRate: invoiceRateInput, rate: invoiceRateInput, value: qty * invoiceRateInput }),
        actualQty: qty,
        gstRate: 0,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
      }, isInterState ? "INTER_STATE" : "INTRA_STATE", {
        forceFromGstRate: true,
        invoiceCurrency: normalizedInvoiceCurrency,
        exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
      });

      setLines((prev) => [...prev, newLine]);
      resetLineDrafts();
      return;
    }

    const selectedPoLine = currentPoLineId ? getPurchaseOrderLine(currentPoLineId) : undefined;
    const fallbackRate = isUsdInvoice ? convertInrToUsd(Number(selectedPoLine?.rate || 0)) : Number(selectedPoLine?.rate || 0);
    const resolvedInvoiceRateInput =
      currentInvoiceRate !== "" && Number(currentInvoiceRate) > 0
        ? Number(currentInvoiceRate)
        : fallbackRate;

    if (showPoLineSelection && isPoMandatoryForCurrentMrrType && !currentPoLineId) {
      alert(`Our PO No. is mandatory before adding a ${mrrType} line.`);
      return;
    }
    if ((mrrType === "Others" || mrrType === "FG Purchase") && (!resolvedInvoiceRateInput || resolvedInvoiceRateInput <= 0)) return;

    const material = getMaterial(currentItemId);
    if (!material) return;
    if (mrrType === "Others" && (currentQty === "" || Number(currentQty) <= 0)) return;
    if (isFgType && (currentReceiptQty === "" || Number(currentReceiptQty) <= 0)) return;

    let qty = 0;
    if (mrrType === "Others") qty = Number(currentQty);
    else if (isFgType) qty = Number(currentReceiptQty);

    const selectedPo = selectedPoLine ? getPurchaseOrder(selectedPoLine.purchaseOrderId) : undefined;
    const newLine = applySupplyTypeTaxRates({
      id: crypto.randomUUID(),
      itemId: currentItemId,
      itemName: material.name,
      qty,
      uom: mrrType === "Reel" ? "KG" : ("uom" in material ? material.uom || "" : ""),
      poId: selectedPo?.id,
      poNo: selectedPo?.poNo,
      poLineId: selectedPoLine?.id,
      poRate: Number(selectedPoLine?.rate || 0),
      invoiceCurrency: normalizedInvoiceCurrency,
      exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
      invoiceQty: qty,
      rate: resolvedInvoiceRateInput,
      value: qty * resolvedInvoiceRateInput,
      ...(isUsdInvoice
        ? { invoiceRateUsd: resolvedInvoiceRateInput }
        : { invoiceRate: resolvedInvoiceRateInput, rate: resolvedInvoiceRateInput, value: qty * resolvedInvoiceRateInput }),
      actualQty: qty,
      gstRate: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
    }, isInterState ? "INTER_STATE" : "INTRA_STATE", {
      forceFromGstRate: true,
      invoiceCurrency: normalizedInvoiceCurrency,
      exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
    });

    setLines((prev) => [...prev, newLine]);
    if (mrrType === "Reel") {
      setPackingSlipDrafts((prev) => ({ ...prev, [newLine.id]: [] }));
    }
    resetLineDrafts();
  };

  const updateLine = (lineId: string, patch: Partial<MaterialLine>) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const poLineId = patch.poLineId ?? line.poLineId;
        const poLine = poLineId ? getPurchaseOrderLine(poLineId) : undefined;
        const po = poLine ? getPurchaseOrder(poLine.purchaseOrderId) : undefined;
        const selectedService = isServiceReturn && patch.itemId
          ? services.find((entry) => entry.id === String(patch.itemId))
          : undefined;
        const nextLine = recalculateMaterialLine({
          ...line,
          ...patch,
          itemId: selectedService?.id || patch.itemId || line.itemId,
          itemName: selectedService?.name || patch.itemName || line.itemName,
          serviceId: selectedService?.id || patch.serviceId || line.serviceId,
          serviceName: selectedService?.name || patch.serviceName || line.serviceName,
          poLineId,
          poId: po?.id,
          poNo: po?.poNo,
          poRate: poLine ? Number(poLine.rate || 0) : Number(patch.poRate ?? line.poRate ?? 0),
          invoiceCurrency: normalizedInvoiceCurrency,
          exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
        }, {
          invoiceCurrency: normalizedInvoiceCurrency,
          exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
        });
        if (Object.prototype.hasOwnProperty.call(patch, "gstRate")) {
          return applySupplyTypeTaxRates(nextLine, isInterState ? "INTER_STATE" : "INTRA_STATE", {
            forceFromGstRate: true,
            invoiceCurrency: normalizedInvoiceCurrency,
            exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
          });
        }
        return applySupplyTypeTaxRates(nextLine, isInterState ? "INTER_STATE" : "INTRA_STATE", {
          invoiceCurrency: normalizedInvoiceCurrency,
          exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
        });
      })
    );
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => prev.filter((line) => line.id !== lineId));
    setPackingSlipDrafts((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const downloadWholeFormReelTemplate = () => {
    const templateData = [
      {
        "Material ERP": "R001",
        "Material Name": "KRAFT REEL 120 GSM",
        "Supplier Reel No.": "SR-001",
        "Weight (KG)": 250.5,
        "Supplier PO No.": "VPO-12345",
        "Our PO No.": "PO-26-00001",
        "Invoice Rate": 52.75,
      },
      {
        "Material ERP": "R001",
        "Material Name": "KRAFT REEL 120 GSM",
        "Supplier Reel No.": "SR-002",
        "Weight (KG)": 248.25,
        "Supplier PO No.": "VPO-12345",
        "Our PO No.": "PO-26-00001",
        "Invoice Rate": 52.75,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reel Material In");
    XLSX.writeFile(wb, "Material_In_Reel_Bulk_Template.xlsx");
  };

  const parseReelBulkUploadRows = (data: any[]) => {
    const activeReelMaterials = materials.filter((material) => material.active !== "No" && material.type === "Reel");
    const materialByErp = new Map(
      activeReelMaterials.map((material) => [String(material.erpCode || "").trim().toLowerCase(), material])
    );
    const materialByName = new Map(
      activeReelMaterials.map((material) => [String(material.name || "").trim().toLowerCase(), material])
    );

    const rows: ReelUploadRow[] = [];
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();

    data.forEach((row: any, index) => {
      const materialErp = String(row["Material ERP"] || "").trim();
      const materialNameInput = String(row["Material Name"] || "").trim();
      const supplierReelNo = String(row["Supplier Reel No."] || "").trim();
      const supplierPoNo = String(row["Supplier PO No."] || "").trim();
      const ourPoSearch = String(row["Our PO No."] || "").trim();
      const weightKg = Number(row["Weight (KG)"] || 0);
      const invoiceRateRaw = String(row["Invoice Rate"] ?? "").trim();
      const invoiceRate = invoiceRateRaw === "" ? undefined : Number(invoiceRateRaw);

      const material =
        (materialErp ? materialByErp.get(materialErp.toLowerCase()) : null) ||
        (materialNameInput ? materialByName.get(materialNameInput.toLowerCase()) : null);

      if (!material) {
        throw new Error(`Row ${index + 2}: reel material not found.`);
      }
      if (Number.isNaN(weightKg) || weightKg <= 0) {
        throw new Error(`Row ${index + 2}: Weight (KG) must be greater than 0.`);
      }
      if (invoiceRateRaw !== "" && (Number.isNaN(invoiceRate) || Number(invoiceRate) < 0)) {
        throw new Error(`Row ${index + 2}: Invoice Rate must be a valid number.`);
      }

      if (isPoMandatoryForCurrentMrrType && !ourPoSearch) {
        throw new Error(`Row ${index + 2}: Our PO No. is mandatory for ${material.name}.`);
      }
      const resolvedPo = ourPoSearch ? getResolvedPoForMaterial(material.id, ourPoSearch) : null;
      if (ourPoSearch && !resolvedPo) {
        throw new Error(`Row ${index + 2}: Our PO No. not matched for ${material.name}.`);
      }

      const duplicateKey = `${material.id}::${supplierReelNo.toLowerCase()}`;
      if (supplierReelNo) {
        if (seenKeys.has(duplicateKey)) duplicateKeys.add(duplicateKey);
        seenKeys.add(duplicateKey);
      }

      rows.push({
        materialId: material.id,
        materialName: material.name,
        supplierReelNo,
        weightKg: Number(weightKg.toFixed(2)),
        supplierPoNo,
        ourPoId: resolvedPo?.poLineId || "",
        ourPoNo: resolvedPo?.poNo || "",
        invoiceRate: invoiceRateRaw === "" ? undefined : Number(invoiceRate),
      });
    });

    if (duplicateKeys.size > 0) {
      throw new Error("Duplicate Supplier Reel No. found for the same material in the upload file.");
    }

    return rows;
  };

  const mergeWholeFormReelUpload = (rows: ReelUploadRow[]) => {
    const groupedByMaterial = new Map<string, ReelUploadRow[]>();
    rows.forEach((row) => {
      const current = groupedByMaterial.get(row.materialId) || [];
      current.push(row);
      groupedByMaterial.set(row.materialId, current);
    });

    const newLineIdsByMaterial = new Map<string, string>();
    const nextPackingSlipDrafts: Record<string, PackingSlipDraft[]> = {};
    const persistedNumbers = packingSlips
      .map((row) => Number(String(row.ourReelNo).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const existingDraftNumbers = Object.values(packingSlipDrafts)
      .flat()
      .map((row) => Number(String(row.ourReelNo).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    let nextReelNumber = Math.max(0, ...persistedNumbers, ...existingDraftNumbers);

    const nextLines = [...lines];

    groupedByMaterial.forEach((materialRows, materialId) => {
      const existingLine = nextLines.find((line) => line.itemId === materialId);
      const resolvedRates = Array.from(
        new Set(
          materialRows
            .map((row) => (row.invoiceRate === undefined ? "" : Number(row.invoiceRate).toFixed(5)))
            .filter((value) => value !== "")
        )
      );

      if (resolvedRates.length > 1) {
        throw new Error(`Multiple invoice rates found for ${materialRows[0].materialName}. Use one rate per material.`);
      }

      const poIds = Array.from(new Set(materialRows.map((row) => row.ourPoId).filter(Boolean)));
      if (poIds.length > 1) {
        throw new Error(`Multiple PO lines found for ${materialRows[0].materialName}. Use one PO per material group.`);
      }

      const firstRow = materialRows[0];
      const totalWeight = Number(materialRows.reduce((sum, row) => sum + row.weightKg, 0).toFixed(2));
      const poLine = firstRow.ourPoId ? getPurchaseOrderLine(firstRow.ourPoId) : undefined;
      const po = poLine ? getPurchaseOrder(poLine.purchaseOrderId) : undefined;
      const invoiceRate =
        resolvedRates.length === 1
          ? Number(resolvedRates[0])
          : existingLine
            ? Number(existingLine.invoiceRate ?? existingLine.rate ?? 0)
            : Number(poLine?.rate || 0);

      const lineId = existingLine?.id || crypto.randomUUID();
      const computedLine = applySupplyTypeTaxRates({
        id: lineId,
        itemId: materialId,
        qty: totalWeight,
        uom: "KG",
        poId: po?.id,
        poNo: po?.poNo,
        poLineId: poLine?.id,
        poRate: Number(poLine?.rate || 0),
        invoiceQty: totalWeight,
        invoiceRate,
        actualQty: totalWeight,
        rate: invoiceRate,
        value: totalWeight * invoiceRate,
        gstRate: existingLine?.gstRate || 0,
        cgstRate: existingLine?.cgstRate || 0,
        sgstRate: existingLine?.sgstRate || 0,
        igstRate: existingLine?.igstRate || 0,
      }, isInterState ? "INTER_STATE" : "INTRA_STATE");

      if (existingLine) {
        const targetIndex = nextLines.findIndex((line) => line.id === existingLine.id);
        nextLines[targetIndex] = computedLine;
      } else {
        nextLines.push(computedLine);
      }

      newLineIdsByMaterial.set(materialId, lineId);
      nextPackingSlipDrafts[lineId] = materialRows.map((row) => ({
        id: crypto.randomUUID(),
        materialLineId: lineId,
        materialId,
        supplierReelNo: row.supplierReelNo,
        ourReelNo: formatReelNo(++nextReelNumber),
        weightKg: String(row.weightKg),
        supplierPoNo: row.supplierPoNo,
        ourPoId: row.ourPoId,
        ourPoNo: row.ourPoNo,
      }));
    });

    const mergedPackingSlipDrafts: Record<string, PackingSlipDraft[]> = {};
    nextLines.forEach((line) => {
      mergedPackingSlipDrafts[line.id] = nextPackingSlipDrafts[line.id] || packingSlipDrafts[line.id] || [];
    });

    setLines(nextLines);
    setPackingSlipDrafts(mergedPackingSlipDrafts);
  };

  const handleWholeFormReelBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          alert("The file is empty.");
          return;
        }

        const parsedRows = parseReelBulkUploadRows(data);
        mergeWholeFormReelUpload(parsedRows);
        alert(`Successfully uploaded ${parsedRows.length} reel rows.`);
      } catch (error) {
        console.error("Whole-form reel upload error:", error);
        alert(error instanceof Error ? error.message : "Failed to parse the reel upload file.");
      }
      e.target.value = "";
    };
    reader.readAsBinaryString(file);
  };

  const downloadReelTemplate = (materialName: string) => {
    const templateData = [
      {
        "Supplier Reel No.": "SR-001",
        "Weight (KG)": 250.50,
        "Supplier PO No.": "VPO-12345",
        "Our PO No.": "",
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reels");
    XLSX.writeFile(wb, `Reel_Template_${materialName.replace(/\s+/g, '_')}.xlsx`);
  };

  const handleReelBulkUpload = (e: React.ChangeEvent<HTMLInputElement>, line: MaterialLine) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          alert("The file is empty.");
          return;
        }

        let nextReelNo = packingSlips
          .map((row) => row.ourReelNo)
          .map((value) => Number(String(value).replace(/\D/g, "")))
          .filter((value) => Number.isFinite(value));
        const draftNumbers = getAllDraftSlips()
          .map((row) => Number(String(row.ourReelNo).replace(/\D/g, "")))
          .filter((value) => Number.isFinite(value));
        
        let currentMax = Math.max(0, ...nextReelNo, ...draftNumbers);

        const poOptions = getApprovedPoOptionsForMaterial(line.itemId);

        const newDrafts: PackingSlipDraft[] = data.map((row: any) => {
          const supplierPoNo = String(row["Supplier PO No."] || "").trim();
          const ourPoNoSearch = String(row["Our PO No."] || "").trim().toLowerCase();
          
          let matchedPoId = "";
          let matchedPoNo = "";

          if (ourPoNoSearch) {
             const matched = poOptions.find(opt => opt.label.toLowerCase().includes(ourPoNoSearch));
             if (matched) {
               matchedPoId = matched.value;
               matchedPoNo = matched.label;
             }
          }

          return {
            id: crypto.randomUUID(),
            materialLineId: line.id,
            materialId: line.itemId,
            supplierReelNo: String(row["Supplier Reel No."] || "").trim(),
            ourReelNo: formatReelNo(++currentMax),
            weightKg: String(row["Weight (KG)"] || "0"),
            supplierPoNo,
            ourPoId: matchedPoId,
            ourPoNo: matchedPoNo,
          };
        });

        setPackingSlipDrafts((prev) => {
          const nextDrafts = [...(prev[line.id] || []), ...newDrafts];
          const next = { ...prev, [line.id]: nextDrafts };
          syncReelLineTotals(line.id, nextDrafts);
          return next;
        });

        alert(`Successfully uploaded ${newDrafts.length} reels.`);
      } catch (error) {
        console.error("Bulk upload error:", error);
        alert("Failed to parse the Excel file.");
      }
      e.target.value = "";
    };
    reader.readAsBinaryString(file);
  };

  const handleAddPackingSlip = (line: MaterialLine) => {
    const nextDraft: PackingSlipDraft = {
      id: crypto.randomUUID(),
      materialLineId: line.id,
      materialId: line.itemId,
      supplierReelNo: "",
      ourReelNo: getNextOurReelNo(),
      weightKg: "",
      supplierPoNo: "",
      ourPoId: "",
      ourPoNo: "",
    };

    setPackingSlipDrafts((prev) => {
      const nextDrafts = [...(prev[line.id] || []), nextDraft];
      const next = { ...prev, [line.id]: nextDrafts };
      syncReelLineTotals(line.id, nextDrafts);
      return next;
    });
  };

  const updatePackingSlip = (lineId: string, slipId: string, patch: Partial<PackingSlipDraft>) => {
    setPackingSlipDrafts((prev) => {
      const nextDrafts = (prev[lineId] || []).map((slip) => (slip.id === slipId ? { ...slip, ...patch } : slip));
      const next = { ...prev, [lineId]: nextDrafts };
      syncReelLineTotals(lineId, nextDrafts);
      return next;
    });
  };

  const removePackingSlip = (lineId: string, slipId: string) => {
    setPackingSlipDrafts((prev) => {
      const nextDrafts = (prev[lineId] || []).filter((slip) => slip.id !== slipId);
      const next = { ...prev, [lineId]: nextDrafts };
      syncReelLineTotals(lineId, nextDrafts);
      return next;
    });
  };

  const handleAiFileUpload = (files?: FileList | null) => {
    const selected = Array.from(files || []);
    if (selected.length === 0) return;
    selected.slice(0, Math.max(0, 8 - aiFiles.length)).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAiFiles((prev) => [
          ...prev,
          { id: crypto.randomUUID(), name: file.name, mimeType: file.type || "application/octet-stream", base64: String(reader.result || "") },
        ].slice(0, 8));
      };
      reader.onerror = () => alert(`Failed to read ${file.name}.`);
      reader.readAsDataURL(file);
    });
  };

  const handleAiFetch = async () => {
    if (aiFiles.length === 0) {
      alert("Please upload at least one invoice photo or PDF.");
      return;
    }
    setIsAiFetching(true);
    setAiError("");
    try {
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/material-in/ai-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ photos: aiFiles.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to fetch invoice data.");
      setAiDraft(result.draft || null);
    } catch (error) {
      const message = (error as Error).message || "Failed to fetch invoice data.";
      setAiError(message);
      alert(message);
    } finally {
      setIsAiFetching(false);
    }
  };

  const openQuickMaterialModal = (match: AiLineMatch) => {
    const line = match.line;
    const type = normalizeAiItemType(line.itemType);
    const reelGroup = materialGroups.find((group) => normalizeMatchText(group.name) === "reel");
    const suggestedGroup = materialGroups.find((group) => normalizeForAiMatch(group.name) === normalizeForAiMatch(line.materialGroupName));
    setNewAiGroupName(String(line.materialGroupName || ""));
    setQuickMaterial({
      lineIndex: match.index,
      type,
      erpCode: String(line.erpCode || "").trim() || getNextAiErpCode(type),
      name: String(line.itemName || "").trim(),
      uom: String(line.uom || (type === "Reel" ? "KGS" : "")).trim(),
      materialGroupId: type === "Reel" ? reelGroup?.id || suggestedGroup?.id || "" : suggestedGroup?.id || "",
      color: String(line.color || "").trim(),
      size: line.size == null ? "" : String(line.size),
      gsm: line.gsm == null ? "" : String(line.gsm),
      bf: line.bf == null ? "" : String(line.bf),
      active: "Yes",
    });
  };

  const handleQuickMaterialTypeChange = (type: AiMrrItemType) => {
    setQuickMaterial((prev) => {
      if (!prev) return prev;
      const reelGroup = materialGroups.find((group) => normalizeMatchText(group.name) === "reel");
      return {
        ...prev,
        type,
        erpCode: getNextAiErpCode(type),
        uom: type === "Reel" ? "KGS" : prev.uom,
        materialGroupId: type === "Reel" ? reelGroup?.id || prev.materialGroupId : prev.materialGroupId,
        color: type === "Reel" ? prev.color : "",
        size: type === "Reel" ? prev.size : "",
        gsm: type === "Reel" ? prev.gsm : "",
        bf: type === "Reel" ? prev.bf : "",
      };
    });
  };

  const handleCreateAiGroup = async () => {
    const normalizedName = newAiGroupName.trim();
    if (!normalizedName) return;
    const existing = materialGroups.find((group) => normalizeMatchText(group.name) === normalizeMatchText(normalizedName));
    if (existing) {
      setQuickMaterial((prev) => prev ? { ...prev, materialGroupId: existing.id } : prev);
      setNewAiGroupName("");
      return;
    }
    setSavingAiGroup(true);
    const timestamp = new Date().toISOString();
    const nextGroup: MaterialGroup = { id: crypto.randomUUID(), name: normalizedName, updatedBy: "System User", updateTimestamp: timestamp };
    try {
      await setMaterialGroups([...materialGroups, nextGroup]);
      setQuickMaterial((prev) => prev ? { ...prev, materialGroupId: nextGroup.id } : prev);
      setNewAiGroupName("");
    } catch (error) {
      console.error("Failed to create material group:", error);
      alert("Failed to create material group.");
    } finally {
      setSavingAiGroup(false);
    }
  };

  const updateAiDraftLineFromQuickMaterial = (form: QuickMaterialForm, material?: Material) => {
    setAiDraft((prev) => {
      if (!prev) return prev;
      const nextLines = (prev.lines || []).map((line, index) => {
        if (index !== form.lineIndex) return line;
        return {
          ...line,
          itemName: material?.name || form.name || line.itemName,
          erpCode: material?.erpCode || form.erpCode || line.erpCode,
          itemType: form.type,
          materialGroupName: materialGroups.find((group) => group.id === form.materialGroupId)?.name || line.materialGroupName,
          uom: form.uom || line.uom,
          size: form.type === "Reel" ? Number(form.size) : line.size,
          gsm: form.type === "Reel" ? Number(form.gsm) : line.gsm,
          bf: form.type === "Reel" ? Number(form.bf) : line.bf,
          color: form.type === "Reel" ? form.color : line.color,
        };
      });
      return { ...prev, lines: nextLines };
    });
  };
  const handleCreateQuickMaterial = async () => {
    if (!quickMaterial) return;
    const name = quickMaterial.name.trim();
    const erpCode = quickMaterial.erpCode.trim() || getNextAiErpCode(quickMaterial.type);
    const uom = quickMaterial.uom.trim();
    const size = Number(quickMaterial.size);
    const gsm = Number(quickMaterial.gsm);
    const bf = Number(quickMaterial.bf);
    const color = quickMaterial.color.trim();
    if (quickMaterial.type === "Other" && !name) { alert("Item Name is required."); return; }
    if (!quickMaterial.materialGroupId) { alert("Material Group is required."); return; }
    if (!uom) { alert("UOM is required."); return; }
    if (quickMaterial.type === "Reel" && (!color || !Number.isFinite(size) || size <= 0 || !Number.isFinite(gsm) || gsm <= 0 || !Number.isFinite(bf) || bf <= 0)) {
      alert("Color, Size, GSM, and BF are required for Reel.");
      return;
    }
    if (quickMaterial.type === "Reel") {
      const existingReel = materials.find((material) =>
        material.active !== "No" &&
        material.type === "Reel" &&
        numbersMatch(material.size, size) &&
        numbersMatch(material.gsm, gsm) &&
        numbersMatch(material.bf, bf)
      );
      if (existingReel) {
        updateAiDraftLineFromQuickMaterial(quickMaterial, existingReel);
        setQuickMaterial(null);
        return;
      }
    }
    setSavingQuickMaterial(true);
    const timestamp = new Date().toISOString();
    const nextMaterial: Material = {
      id: crypto.randomUUID(),
      type: quickMaterial.type,
      erpCode,
      name: quickMaterial.type === "Reel" ? getReelDisplayName(erpCode, size, gsm, bf, color) : name,
      uom,
      materialGroupId: quickMaterial.materialGroupId,
      color: quickMaterial.type === "Reel" ? color : null,
      size: quickMaterial.type === "Reel" ? size : undefined,
      gsm: quickMaterial.type === "Reel" ? gsm : undefined,
      bf: quickMaterial.type === "Reel" ? bf : undefined,
      openingQty: 0,
      openingRate: 0,
      openingValue: 0,
      active: quickMaterial.active,
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };
    try {
      await setMaterials([nextMaterial, ...materials]);
      setQuickMaterial(null);
    } catch (error) {
      console.error("Failed to create material:", error);
      alert("Failed to create material.");
    } finally {
      setSavingQuickMaterial(false);
    }
  };

  const handleSetAiData = () => {
    if (!aiDraft || !aiCanSetData || !aiMatchedSupplier) return;
    const nextMrrType = aiSuggestedMrrType;
    const nextCurrency = normalizeInvoiceCurrency(aiDraft.invoiceCurrency);
    const nextExchangeRate = nextCurrency === "USD" ? Number(aiDraft.exchangeRate || 0) : "";
    if (nextCurrency === "USD" && (!nextExchangeRate || Number(nextExchangeRate) <= 0)) {
      alert("Exchange rate is required for USD invoices before Set Data.");
      return;
    }

    setSupplierId(aiMatchedSupplier.id);
    setInvoiceNo(String(aiDraft.invoiceNo || "").trim());
    setInvDate(normalizeAiDate(aiDraft.invoiceDate));
    setDate(normalizeAiDate(aiDraft.mrrDate) || new Date().toISOString().slice(0, 10));
    setMrrType(nextMrrType);
    setInvoiceCurrency(nextCurrency);
    setExchangeRate(nextExchangeRate as number | "");

    const nextPackingDrafts: Record<string, PackingSlipDraft[]> = {};
    const nextLines = aiLineMatches.map((match) => {
      const material = match.material as Material;
      const qty = Number(match.line.qty || 0);
      const invoiceRate = Number(match.line.invoiceRate || match.po?.poRate || 0);
      const baseLine: MaterialLine = {
        id: crypto.randomUUID(),
        itemId: material.id,
        itemName: material.name,
        qty,
        uom: nextMrrType === "Reel" ? "KG" : material.uom || String(match.line.uom || ""),
        poId: match.po?.poId,
        poNo: match.po?.poNo,
        poLineId: match.po?.poLineId,
        poRate: Number(match.po?.poRate || 0),
        invoiceCurrency: nextCurrency,
        exchangeRate: nextCurrency === "USD" ? Number(nextExchangeRate || 0) : undefined,
        invoiceQty: qty,
        rate: invoiceRate,
        value: qty * invoiceRate,
        ...(nextCurrency === "USD"
          ? { invoiceRateUsd: invoiceRate }
          : { invoiceRate, rate: invoiceRate, value: qty * invoiceRate }),
        actualQty: qty,
        gstRate: Number(match.line.gstRate || 0),
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
      };
      const calculatedLine = applySupplyTypeTaxRates(baseLine, isInterState ? "INTER_STATE" : "INTRA_STATE", {
        forceFromGstRate: true,
        invoiceCurrency: nextCurrency,
        exchangeRate: nextCurrency === "USD" ? Number(nextExchangeRate || 0) : undefined,
      });
      if (nextMrrType === "Reel") nextPackingDrafts[calculatedLine.id] = [];
      return calculatedLine;
    });
    setLines(nextLines);
    setPackingSlipDrafts(nextPackingDrafts);
    resetLineDrafts();
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !invoiceNo || !invDate || !supplierId || lines.length === 0) return;

    if (!editingEntry && gateEntryId && !linkedGateEntry) {
      alert("Gate Entry could not be loaded. MRR cannot be created from this link.");
      navigate("/material-receipt/pending-mrr", { replace: true });
      return;
    }

    if (!editingEntry && linkedGateEntry && !canCreateMrrForGateEntry(linkedGateEntry)) {
      alert(isGateEntryCancelled(linkedGateEntry)
        ? "Gate Entry is cancelled. MRR cannot be created for this Gate Entry."
        : "MRR has already been created for this Gate Entry.");
      navigate("/material-receipt/pending-mrr", { replace: true });
      return;
    }

    const linesForSubmit =
      mrrType === "Reel"
        ? lines.map((line) => {
            const totalWeight = Number(
              (packingSlipDrafts[line.id] || []).reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0).toFixed(2)
            );
            return recalculateMaterialLine({
              ...line,
              qty: totalWeight,
              invoiceQty: totalWeight,
              actualQty: totalWeight,
              uom: line.uom || "KG",
              invoiceCurrency: normalizedInvoiceCurrency,
              exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
            }, {
              invoiceCurrency: normalizedInvoiceCurrency,
              exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
            });
          })
        : lines.map((line) => recalculateMaterialLine({
            ...line,
            invoiceCurrency: normalizedInvoiceCurrency,
            exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
          }, {
            invoiceCurrency: normalizedInvoiceCurrency,
            exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
          }));

    if (isUsdInvoice && (!numericExchangeRate || numericExchangeRate <= 0)) {
      alert("Exchange rate must be greater than 0 for USD invoices.");
      return;
    }

    if (linesForSubmit.some((line) => Number(line.invoiceRate ?? line.rate ?? 0) <= 0)) {
      alert("Invoice rate must be greater than 0 for every MRR line.");
      return;
    }

    if (isServiceReturn) {
      for (const line of linesForSubmit) {
        const sourceLine = pendingGatePassLines.find((entry) => entry.id === line.sourceGatePassLineId);
        const actualQty = Number(line.actualQty ?? line.qty ?? 0);
        if (!sourceLine) {
          alert("Each service return line must be linked to a returnable gate pass item.");
          return;
        }
        if (actualQty <= 0 || actualQty > Number(sourceLine.pendingQty || 0)) {
          alert(`Returned quantity cannot exceed pending quantity for ${sourceLine.itemDescription || sourceLine.itemName}.`);
          return;
        }
      }
    }

    if (mrrType === "Reel") {
      for (const line of lines) {
        const slips = packingSlipDrafts[line.id] || [];
        if (slips.length === 0) {
          alert("Please add at least one packing slip row for each reel item.");
          return;
        }
        if (slips.some((slip) => Number(slip.weightKg || 0) <= 0)) {
          alert("Each packing slip row must have weight in KG.");
          return;
        }
        if (isPoMandatoryForCurrentMrrType && slips.some((slip) => !String(slip.ourPoId || "").trim() || !String(slip.ourPoNo || "").trim())) {
          alert("Our PO No. is mandatory for every reel row.");
          return;
        }
      }
    }

    if (showPoLineSelection && isPoMandatoryForCurrentMrrType) {
      const hasMissingPo = linesForSubmit.some((line) => !String(line.poLineId || line.poNo || "").trim());
      if (hasMissingPo) {
        alert(`Our PO No. is mandatory for every ${mrrType} row.`);
        return;
      }
    }

    const numericExpenseCGST = Number(expenseCGST || 0);
    const numericExpenseSGST = Number(expenseSGST || 0);
    const numericExpenseIGST = Number(expenseIGST || 0);

    if ([numericExpenseCGST, numericExpenseSGST, numericExpenseIGST].some((value) => value < 0)) {
      alert("Expense GST values cannot be negative.");
      return;
    }

    if (!hasExpenseBase && (numericExpenseCGST > 0 || numericExpenseSGST > 0 || numericExpenseIGST > 0)) {
      alert("Expense GST can be entered only when Insurance or Other Charges is greater than 0.");
      return;
    }

    if (isInterState) {
      if (numericExpenseCGST > 0 || numericExpenseSGST > 0) {
        alert("For interstate parties, expense CGST and SGST must be zero.");
        return;
      }
    } else {
      if (numericExpenseIGST > 0) {
        alert("For intrastate parties, expense IGST must be zero.");
        return;
      }
      if (numericExpenseCGST !== numericExpenseSGST) {
        alert("For intrastate parties, expense CGST and expense SGST must be equal.");
        return;
      }
    }

    const submitSummary = summarizeMaterialInLines(
      linesForSubmit,
      insurance,
      otherCharges,
      roundOff,
      {
        expenseCGST: numericExpenseCGST,
        expenseSGST: numericExpenseSGST,
        expenseIGST: numericExpenseIGST,
      }
    );

    setIsSubmitting(true);
    try {
      let transactionNo = editingEntry?.transactionNo || "";
      const materialInId = editingEntry?.id || crypto.randomUUID();
      const timestamp = new Date().toISOString();

      await setMaterialIn((prev) => {
        if (!editingEntry) {
          transactionNo = generateTransactionNo("MI", prev, date);
        }

        const nextEntry: MaterialIn = {
          id: materialInId,
          transactionNo,
          mrrType,
          gateEntryId: editingEntry?.gateEntryId || linkedGateEntry?.id,
          gateEntryNo: editingEntry?.gateEntryNo || linkedGateEntry?.gateEntryNo,
          sourceGatePassId: editingEntry?.sourceGatePassId || linkedGateEntry?.sourceGatePassId,
          sourceGatePassNo: editingEntry?.sourceGatePassNo || linkedGateEntry?.sourceGatePassNo,
          timestamp: editingEntry?.timestamp || timestamp,
          entryEmailId: editingEntry?.entryEmailId || "system@lngrp.in",
          date,
          invoiceNo,
          invDate,
          supplierId,
          invoiceCurrency: normalizedInvoiceCurrency,
          exchangeRate: isUsdInvoice ? numericExchangeRate : undefined,
          totalInvoiceValue: submitSummary.totalInvoiceValue,
          totalInvoiceValueUsd: isUsdInvoice ? submitSummary.totalInvoiceValueUsd : undefined,
          totalActualValue: submitSummary.totalActualValue,
          totalActualValueUsd: isUsdInvoice ? submitSummary.totalActualValueUsd : undefined,
          totalCgst: submitSummary.totalCgst,
          totalSgst: submitSummary.totalSgst,
          totalIgst: submitSummary.totalIgst,
          totalInvoiceValueAfterGst: submitSummary.totalInvoiceValueAfterGst,
          insurance: submitSummary.insuranceValue,
          otherCharges: submitSummary.otherChargesValue,
          expenseCGST: submitSummary.expenseCGSTValue,
          expenseSGST: submitSummary.expenseSGSTValue,
          expenseIGST: submitSummary.expenseIGSTValue,
          roundOff: submitSummary.roundOffValue,
          totalAmount: submitSummary.totalAmount,
          lines: submitSummary.lines,
          status: editingEntry?.status || "Pending PH",
          updatedBy: "System User",
          updateTimestamp: timestamp,
          phTimestamp: editingEntry?.phTimestamp,
          phEmailId: editingEntry?.phEmailId,
          plant_head_remark: editingEntry?.plant_head_remark,
          accTimestamp: editingEntry?.accTimestamp,
          accEmailId: editingEntry?.accEmailId,
          accounts_remark: editingEntry?.accounts_remark,
          debitNote: editingEntry?.debitNote,
          debitNoteDate: editingEntry?.debitNoteDate,
          debitNoteAmount: editingEntry?.debitNoteAmount,
          mdTimestamp: editingEntry?.mdTimestamp,
          mdEmailId: editingEntry?.mdEmailId,
          md_approval_remark: editingEntry?.md_approval_remark,
          tallyTimestamp: editingEntry?.tallyTimestamp,
        };

        return editingEntry
          ? prev.map((entry) => (entry.id === editingEntry.id ? nextEntry : entry))
          : [...prev, nextEntry];
      });

      if (mrrType === "Reel") {
        const newPackingSlips: MaterialInPackingSlip[] = Object.values(packingSlipDrafts)
          .flat()
          .map((slip) => ({
            id: slip.id,
            materialInId,
            materialLineId: slip.materialLineId,
            materialId: slip.materialId,
            supplierReelNo: slip.supplierReelNo || undefined,
            ourReelNo: slip.ourReelNo,
            weightKg: Number(slip.weightKg || 0),
            supplierPoNo: slip.supplierPoNo || undefined,
            ourPoId: slip.ourPoId || undefined,
            ourPoNo: slip.ourPoNo || undefined,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          }));

        if (newPackingSlips.length > 0) {
          await setPackingSlips((prev) => [
            ...prev.filter((row) => row.materialInId !== materialInId),
            ...newPackingSlips,
          ]);
        }
      } else if (editingEntry) {
        await setPackingSlips((prev) => prev.filter((row) => row.materialInId !== materialInId));
      }

      if (!editingEntry && linkedGateEntry) {
        await setGateEntries(
          gateEntries.map((entry) =>
            entry.id === linkedGateEntry.id
              ? {
                  ...entry,
                  mrrId: materialInId,
                  mrrDate: date,
                  mrrNo: transactionNo,
                  updateTimestamp: timestamp,
                }
              : entry
          )
        );
      }

      setInvoiceNo("");
      setInvDate("");
      setSupplierId("");
      setInvoiceCurrency("INR");
      setExchangeRate("");
      setInsurance("");
      setOtherCharges("");
      setExpenseCGST("");
      setExpenseSGST("");
      setExpenseIGST("");
      setRoundOff("");
      setLines([]);
      setPackingSlipDrafts({});
      setCurrentPoLineId("");
      setCurrentInvoiceRate("");
      alert(
        editingEntry
          ? `MRR updated: ${transactionNo}`
          : `MRR created with MRR No: ${transactionNo}`
      );
      navigate("/material-receipt/approvals");
    } catch (err) {
      console.error("Failed to save Material In:", err);
      alert("Failed to save Material In.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">
        {editingEntry ? "Edit MRR" : "Material Receipt Report (MRR) Form"}
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
        {linkedGateEntry ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded border border-emerald-700 bg-emerald-50 p-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Gate Entry No</label>
              <input type="text" value={linkedGateEntry.gateEntryNo || "Syncing..."} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Supplier/Company</label>
              <input type="text" value={linkedSupplierName} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Truck No</label>
              <input type="text" value={linkedGateEntry.truckNo || ""} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
            {linkedSourceGatePass ? (
              <div className="flex flex-col space-y-1 md:col-span-3">
                <label className="font-bold text-black text-sm">Linked Returnable Gate Pass</label>
                <input type="text" value={linkedSourceGatePass.gatePassNo || ""} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
              </div>
            ) : null}
          </div>
        ) : null}

        {!editingEntry && !isServiceReturn ? (
          <div className="rounded border-2 border-indigo-700 bg-indigo-50/40 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-black uppercase text-indigo-800"><Wand2 size={20} /> AI Fetch MRR</h3>
                <div className="text-sm font-semibold text-slate-600">Upload invoice photo/PDF, review matches, then set data into this form.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">
                  <Upload size={16} /> Upload Invoice
                  <input type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => handleAiFileUpload(e.target.files)} />
                </label>
                <button
                  type="button"
                  onClick={handleAiFetch}
                  disabled={isAiFetching || aiFiles.length === 0}
                  className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  {isAiFetching ? <Spinner size={18} className="text-white" /> : <Wand2 size={16} />} Fetch From Invoice
                </button>
              </div>
            </div>

            {aiFiles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {aiFiles.map((file) => (
                  <div key={file.id} className="inline-flex items-center gap-2 rounded border border-indigo-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                    <FileText size={14} /> {file.name}
                    <button type="button" onClick={() => setAiFiles((prev) => prev.filter((entry) => entry.id !== file.id))} className="text-slate-500 hover:text-red-600">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {aiError ? <div className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{aiError}</div> : null}

            {aiDraft ? (
              <div className="space-y-4 rounded border border-black bg-white p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded border border-slate-300 p-3">
                    <div className="text-xs font-black uppercase text-slate-500">Supplier</div>
                    <div className="font-bold text-black">{aiDraft.supplierName || "-"}</div>
                    <div className={aiMatchedSupplier ? "text-xs font-bold text-emerald-700" : "text-xs font-bold text-red-700"}>
                      {aiMatchedSupplier ? `Matched: ${aiMatchedSupplier.name}` : "Supplier not found"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-300 p-3">
                    <div className="text-xs font-black uppercase text-slate-500">Invoice</div>
                    <div className="font-bold text-black">{aiDraft.invoiceNo || "-"}</div>
                    <div className="text-xs font-bold text-slate-600">{normalizeAiDate(aiDraft.invoiceDate) || "Date not found"}</div>
                  </div>
                  <div className="rounded border border-slate-300 p-3">
                    <div className="text-xs font-black uppercase text-slate-500">MRR Type</div>
                    <div className="font-bold text-black">{aiSuggestedMrrType}</div>
                    <div className="text-xs font-bold text-slate-600">{normalizeInvoiceCurrency(aiDraft.invoiceCurrency)}</div>
                  </div>
                  <div className="rounded border border-slate-300 p-3">
                    <div className="text-xs font-black uppercase text-slate-500">Status</div>
                    <div className={aiCanSetData ? "flex items-center gap-1 font-bold text-emerald-700" : "flex items-center gap-1 font-bold text-amber-700"}>
                      {aiCanSetData ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                      {aiCanSetData ? "Ready" : "Needs review"}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded border border-black">
                  <table className="min-w-full border-collapse bg-white text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        {["Item", "ERP", "Type", "Qty", "UOM", "Rate", "GST", "Match", "Action"].map((heading) => (
                          <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-black uppercase text-black">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aiLineMatches.map((match) => (
                        <tr key={match.index}>
                          <td className="border border-black px-3 py-2 font-bold text-black">{normalizeAiItemType(match.line.itemType) === "Reel" ? match.material?.name || getReelSpecLabel(match.line) : match.line.itemName || "-"}</td>
                          <td className="border border-black px-3 py-2 text-black">{String(match.line.erpCode || "-")}</td>
                          <td className="border border-black px-3 py-2 text-black">{normalizeAiItemType(match.line.itemType)}</td>
                          <td className="border border-black px-3 py-2 text-black">{Number(match.line.qty || 0).toLocaleString()}</td>
                          <td className="border border-black px-3 py-2 text-black">{match.line.uom || "-"}</td>
                          <td className="border border-black px-3 py-2 text-black">{Number(match.line.invoiceRate || 0).toFixed(2)}</td>
                          <td className="border border-black px-3 py-2 text-black">{Number(match.line.gstRate || 0).toFixed(2)}%</td>
                          <td className="border border-black px-3 py-2">
                            <div className={match.status === "matched" ? "font-bold text-emerald-700" : match.status === "warning" ? "font-bold text-amber-700" : "font-bold text-red-700"}>
                              {match.material?.name || match.reason}
                            </div>
                            {match.material ? <div className="text-xs text-slate-500">{match.reason}</div> : null}
                          </td>
                          <td className="border border-black px-3 py-2">
                            {match.status === "missing" ? (
                              <button type="button" onClick={() => openQuickMaterialModal(match)} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">Create</button>
                            ) : match.status === "warning" ? (
                              <button type="button" onClick={() => navigate("/masters/materials")} className="rounded border border-black bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-slate-50">Edit Master</button>
                            ) : <span className="text-xs font-bold text-emerald-700">OK</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSetAiData}
                    disabled={!aiCanSetData}
                    className="rounded bg-black px-5 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Next / Set Data
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">MRR No</label>
            <input
              type="text"
              value={editingEntry?.transactionNo || "Generated on Submit"}
              disabled
              className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-mono text-sm opacity-70"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              MRR Type <span className="text-red-500">*</span>
            </label>
            {linkedGateEntry?.purpose === "Returnable Receipt" ? (
              <input value="Service Return" disabled className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-semibold opacity-80" />
            ) : (
              <Select options={mrrTypeOptions} value={mrrType} onChange={handleMrrTypeChange} required />
            )}
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Invoice Currency</label>
            <Select
              options={[{ value: "INR", label: "INR" }, { value: "USD", label: "USD" }]}
              value={normalizedInvoiceCurrency}
              onChange={handleInvoiceCurrencyChange}
            />
          </div>
          {isUsdInvoice ? (
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">
                Exchange Rate (1 USD in INR) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
              />
            </div>
          ) : null}
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              Invoice No <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              required
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              Invoice Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={invDate}
              onChange={(e) => setInvDate(e.target.value)}
              required
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Insurance</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={insurance}
              onChange={(e) => setInsurance(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Other Charges</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={otherCharges}
              onChange={(e) => setOtherCharges(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Expense CGST</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={expenseCGST}
              onChange={(e) => handleExpenseCgstChange(e.target.value)}
              disabled={!hasExpenseBase || isInterState}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Expense SGST</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={expenseSGST}
              onChange={(e) => handleExpenseSgstChange(e.target.value)}
              disabled={!hasExpenseBase || isInterState}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Expense IGST</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={expenseIGST}
              onChange={(e) => handleExpenseIgstChange(e.target.value)}
              disabled={!hasExpenseBase || !isInterState}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Round Off</label>
            <input
              type="number"
              step="0.01"
              value={roundOff}
              onChange={(e) => setRoundOff(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
          </div>
          <div className="md:col-span-2 text-xs text-slate-600">
            Expense GST follows the selected party supply type. For intrastate, CGST and SGST stay equal. For interstate, only IGST is allowed.
          </div>
          <div className="flex flex-col space-y-1 md:col-span-2">
            <label className="font-bold text-black">
              Supplier/Customer <span className="text-red-500">*</span>
            </label>
            {linkedGateEntry ? (
              <input type="text" value={linkedSupplierName} disabled className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-semibold opacity-80" />
            ) : (
              <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} required placeholder="Select Supplier/Customer..." />
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-black pt-4">
          <h3 className="text-lg font-bold text-black mb-4 uppercase">
            {isServiceReturn ? "Service Return Lines" : isFgType ? "FG Items" : (mrrType === "Reel" ? "Reel Items" : "Line Items")}
          </h3>
          {mrrType === "Reel" ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-black bg-indigo-50 px-4 py-3">
              <button
                type="button"
                onClick={downloadWholeFormReelTemplate}
                className="inline-flex items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50 transition"
              >
                <Download size={16} /> Reel Bulk Template
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50 transition">
                <Upload size={16} /> Reel Bulk Upload
                <input
                  ref={reelBulkInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={handleWholeFormReelBulkUpload}
                />
              </label>
              <div className="text-xs font-semibold text-slate-600">
                One row = one reel. Upload creates grouped reel lines and reel stock rows together.
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-4 items-end mb-4 bg-slate-50 p-4 rounded border border-black">
            <div className="flex flex-col space-y-1 w-full md:w-80">
              <label className="text-sm font-bold text-black">
                {activeItemLabel} <span className="text-red-600">*</span>
              </label>
              <Select key={activeItemSelectKey} options={activeItemOptions} value={currentItemId} onChange={setCurrentItemId} placeholder={activeItemPlaceholder} />
            </div>
            {isServiceReturn ? (
              <div className="flex flex-col space-y-1 w-full md:w-80">
                <label className="text-sm font-bold text-black">Returned Item <span className="text-red-600">*</span></label>
                <Select
                  options={pendingGatePassLines.map((line) => ({
                    value: line.id,
                    label: `${line.itemDescription || line.itemName} | Pending ${Number(line.pendingQty || 0).toLocaleString()} ${line.uom || ""}`.trim(),
                  }))}
                  value={currentSourceGatePassLineId}
                  onChange={setCurrentSourceGatePassLineId}
                  placeholder="Select returned item..."
                />
              </div>
            ) : null}
            {mrrType === "Others" || isFgType ? (
              <div className="flex flex-col space-y-1 w-full md:w-24">
                <label className="text-sm font-bold text-black">{isServiceReturn ? "Return Qty" : isFgType ? "Item Receipt" : "Invoice Qty"}</label>
                <input
                  type="number"
                  value={(isFgType ? currentReceiptQty : currentQty) || ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? "" : parseFloat(e.target.value);
                    if (isFgType) setCurrentReceiptQty(val);
                    else setCurrentQty(val);
                  }}
                  className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
                />
              </div>
            ) : null}
            {isServiceReturn ? (
              <div className="flex flex-col space-y-1 w-full md:w-24">
                <label className="text-sm font-bold text-black">Return Qty</label>
                <input
                  type="number"
                  value={currentQty || ""}
                  onChange={(e) => setCurrentQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
                />
              </div>
            ) : null}
            {showPoLineSelection ? (
              <div className="flex flex-col space-y-1 w-full md:w-80">
                <label className="text-sm font-bold text-black">
                  Our PO No. {isPoMandatoryForCurrentMrrType ? <span className="text-red-600">*</span> : null}
                </label>
                <Select
                  options={currentItemId ? getApprovedPoOptionsForMaterial(currentItemId) : []}
                  value={currentPoLineId}
                  onChange={handleCurrentPoLineChange}
                  placeholder="Select PO line..."
                />
              </div>
            ) : null}
            <div className="flex flex-col space-y-1 w-full md:w-24">
              <label className="text-sm font-bold text-black">{isUsdInvoice ? "Invoice Rate (USD)" : "Invoice Rate (INR)"}</label>
              <input
                type="number"
                value={currentInvoiceRate || ""}
                onChange={(e) => setCurrentInvoiceRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
                step={isUsdInvoice ? "0.0001" : "0.01"}
                className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
              />
            </div>
            <button type="button" onClick={handleAddLine} className="bg-black text-white p-[10px] rounded hover:bg-slate-800 transition">
              <Plus size={20} />
            </button>
          </div>

          {lines.length > 0 ? (
            <div className="space-y-4">
              <div className="overflow-x-auto shadow-sm rounded border border-black">
                <table className="min-w-full divide-y divide-black border-collapse border border-black">
                  <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isServiceReturn ? "Service" : isFgType ? "Item" : "Material"}</th>
                      {isServiceReturn ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Returned Item</th> : null}
                      {showPoLineSelection ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Our PO No.</th> : null}
                      {showPoLineSelection ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">PO Rate</th> : null}
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isServiceReturn ? "Return Qty" : isFgType ? "Item Receipt" : "Invoice Qty"}</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isUsdInvoice ? "Invoice Rate (USD)" : "Invoice Rate (INR)"}</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">GST %</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Invoice Value (INR)</th>
                      {!isInterState ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">CGST %</th> : null}
                      {!isInterState ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">SGST %</th> : null}
                      {isInterState ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">IGST %</th> : null}
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isServiceReturn ? "Accepted Qty" : "Kanta Weight"}</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">UOM</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Actual Value</th>
                      <th className="px-4 py-3 text-right border border-black"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {lines.map((line) => {
                      const materialName = getLineDisplayName(line);
                      return (
                        <tr key={line.id} className="divide-x divide-black">
                          <td className="px-4 py-3 text-sm text-black border border-black min-w-[220px]">
                            {isServiceReturn ? (
                              <Select
                                options={serviceOptions}
                                value={line.serviceId || line.itemId || ""}
                                onChange={(value) => updateLine(line.id, { itemId: value, serviceId: value })}
                                placeholder="Select Service..."
                              />
                            ) : materialName}
                          </td>
                          {isServiceReturn ? <td className="px-4 py-3 text-sm text-black border border-black">{line.sourceGatePassItemDescription || "-"}</td> : null}
                          {showPoLineSelection ? (
                            <td className="px-4 py-3 text-sm text-black border border-black min-w-[220px]">
                              <Select
                                options={getApprovedPoOptionsForMaterial(line.itemId)}
                                value={line.poLineId || ""}
                                onChange={(value) => updateLine(line.id, { poLineId: value })}
                                placeholder="Select PO line..."
                              />
                            </td>
                          ) : null}
                          {showPoLineSelection ? (
                            <td className="px-4 py-3 text-sm text-black border border-black">{Number(line.poRate || 0).toFixed(2)}</td>
                          ) : null}
                          <td className="px-4 py-3 text-sm text-black border border-black">
                            {mrrType === "Reel" ? Number(line.invoiceQty || 0).toFixed(2) : (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={(line.invoiceQty ?? line.qty) === 0 ? "" : (line.invoiceQty ?? line.qty)}
                                onChange={(e) => updateLine(line.id, { invoiceQty: Number(e.target.value || 0) })}
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-black border border-black">
                            <input
                              type="number"
                              min="0"
                              step={isUsdInvoice ? "0.0001" : "0.01"}
                              value={isUsdInvoice
                                ? (Number(line.invoiceRateUsd || 0) === 0 ? "" : line.invoiceRateUsd)
                                : ((line.invoiceRate ?? line.rate) === 0 ? "" : (line.invoiceRate ?? line.rate))}
                              onChange={(e) => updateLine(line.id, isUsdInvoice ? { invoiceRateUsd: Number(e.target.value || 0) } : { invoiceRate: Number(e.target.value || 0) })}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-black border border-black min-w-[220px]">
                            <Select
                              options={gstRateOptions}
                              value={Number(line.gstRate || 0) > 0 ? String(Number(line.gstRate || 0)) : ""}
                              onChange={(value) => updateLine(line.id, { gstRate: Number(value || 0) })}
                              placeholder="Select GST..."
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-black border border-black">{Number(line.invoiceValue || 0).toFixed(2)}</td>
                          {!isInterState ? (
                            <td className="px-4 py-3 text-sm text-black border border-black">
                              <input type="number" min="0" step="0.01" value={Number(line.cgstRate || 0) > 0 ? line.cgstRate : ""} onChange={(e) => updateLine(line.id, { cgstRate: Number(e.target.value || 0) })} className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                            </td>
                          ) : null}
                          {!isInterState ? (
                            <td className="px-4 py-3 text-sm text-black border border-black">
                              <input type="number" min="0" step="0.01" value={Number(line.sgstRate || 0) > 0 ? line.sgstRate : ""} onChange={(e) => updateLine(line.id, { sgstRate: Number(e.target.value || 0) })} className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                            </td>
                          ) : null}
                          {isInterState ? (
                            <td className="px-4 py-3 text-sm text-black border border-black">
                              <input type="number" min="0" step="0.01" value={Number(line.igstRate || 0) > 0 ? line.igstRate : ""} onChange={(e) => updateLine(line.id, { igstRate: Number(e.target.value || 0) })} className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-sm text-black border border-black">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={(line.actualQty ?? line.qty) === 0 ? "" : (line.actualQty ?? line.qty)}
                              onChange={(e) => updateLine(line.id, { actualQty: Number(e.target.value || 0) })}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-black border border-black">{line.uom}</td>
                          <td className="px-4 py-3 text-sm font-medium text-black border border-black">{Number(line.actualValue || line.value || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right border border-black">
                            <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800">
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {mrrType === "Reel"
                ? lines.map((line) => {
                    const slipRows = packingSlipDrafts[line.id] || [];
                    const poOptions = getApprovedPoOptionsForMaterial(line.itemId);
                    return (
                      <div key={line.id} className="rounded border border-black bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-4 border-b border-black pb-2">
                          <div>
                            <h4 className="font-bold text-black uppercase tracking-tight">{getMaterial(line.itemId)?.name || "Reel Material"}</h4>
                            <div className="flex gap-4 text-xs font-bold mt-1">
                                {isUsdInvoice ? (
                                  <span className="text-indigo-600 uppercase">Invoice Rate: USD {Number(line.invoiceRateUsd || 0).toFixed(4)} | INR {Number(line.invoiceRate || 0).toFixed(2)}</span>
                                ) : (
                                  <span className="text-indigo-600 uppercase">Invoice Rate: {Number(line.invoiceRate || 0).toFixed(2)}</span>
                                )}
                                <span className="text-amber-700 uppercase">PO Rate: {Number(line.poRate || 0).toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => downloadReelTemplate(getMaterial(line.itemId)?.name || "Reel")}
                              className="inline-flex items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50 transition"
                            >
                              <Download size={16} /> Template
                            </button>
                            <label className="inline-flex items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50 transition cursor-pointer">
                              <Upload size={16} /> Bulk Upload
                              <input
                                type="file"
                                accept=".xlsx, .xls"
                                className="hidden"
                                onChange={(e) => handleReelBulkUpload(e, line)}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => handleAddPackingSlip(line)}
                              className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 transition"
                            >
                              <Plus size={16} /> Add Reel
                            </button>
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse border border-black">
                            <thead className="sticky top-0 z-30 bg-slate-100">
                              <tr>
                                {["Supplier Reel No.", "Our Reel No.", "Weight (KG)", "Supplier PO No.", isPoMandatoryForCurrentMrrType ? "Our PO No. *" : "Our PO No.", "Action"].map((heading) => (
                                  <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase text-black">
                                    {heading}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {slipRows.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="border border-black px-4 py-6 text-center text-sm text-slate-500">
                                    No reels added yet.
                                  </td>
                                </tr>
                              ) : (
                                slipRows.map((slip) => (
                                  <tr key={slip.id}>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.supplierReelNo}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { supplierReelNo: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.ourReelNo}
                                        readOnly
                                        className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-black"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={slip.weightKg}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { weightKg: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.supplierPoNo}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { supplierPoNo: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2 min-w-[220px]">
                                      <Select
                                        options={poOptions}
                                        value={slip.ourPoId}
                                        onChange={(value) => {
                                          const selectedOption = poOptions.find((option) => option.value === value);
                                          updatePackingSlip(line.id, slip.id, {
                                            ourPoId: value,
                                            ourPoNo: selectedOption?.label || "",
                                          });
                                        }}
                                        placeholder="Select PO..."
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2 text-right">
                                      <button type="button" onClick={() => removePackingSlip(line.id, slip.id)} className="text-red-600 hover:text-red-800">
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          ) : (
            <div className="p-4 bg-slate-50 text-black rounded border border-dashed border-black text-sm text-center">
              No items added yet. Please add at least one line item.
            </div>
          )}
          <div className="mt-4 text-right font-bold text-black text-xl">
            {isUsdInvoice ? (
              <>
                <div>Invoice Currency: <span className="text-slate-700">USD</span></div>
                <div>Exchange Rate: <span className="text-slate-700">{numericExchangeRate.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
                <div>Total Invoice Value (USD): <span className="text-amber-700">USD {totalInvoiceValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
                <div>Total Actual Value (USD): <span className="text-indigo-700">USD {totalActualValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
              </>
            ) : null}
            <div>Total Invoice Value: <span className="text-amber-700">{totalInvoiceValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total CGST: <span className="text-slate-700">{totalCgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total SGST: <span className="text-slate-700">{totalSgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total IGST: <span className="text-slate-700">{totalIgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Invoice Value After GST: <span className="text-amber-700">{totalInvoiceValueAfterGst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total Actual Value: <span className="text-indigo-700">{totalActualValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Insurance: <span className="text-slate-700">{insuranceValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Other Charges: <span className="text-slate-700">{otherChargesValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Expense CGST: <span className="text-slate-700">{expenseCGSTValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Expense SGST: <span className="text-slate-700">{expenseSGSTValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Expense IGST: <span className="text-slate-700">{expenseIGSTValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Round Off: <span className="text-slate-700">{roundOffValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total Amount: <span className="text-emerald-700">{totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-3 rounded font-bold border-2 border-black text-black hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0}
            className="flex items-center justify-center min-w-[150px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={24} className="text-white" /> : editingEntry ? "Update Form" : "Submit Form"}
          </button>
        </div>
      </form>
    </div>
  );
}






