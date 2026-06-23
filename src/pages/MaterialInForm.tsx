import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Upload, Download } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Company,
  GateEntry,
  GatePass,
  GstRateMaster,
  Item,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialLine,
  PurchaseOrder,
  PurchaseOrderLine,
  Service,
  Supplier,
} from "../types";
import { generateTransactionNo } from "../lib/serial";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import * as XLSX from "xlsx";
import { useNpdItems } from "../hooks/useNpdItems";
import { applySupplyTypeTaxRates, recalculateMaterialLine, summarizeMaterialInLines } from "../lib/materialInTaxes";
import { getGatePassLinesWithReturns } from "../lib/gatePassState";

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

export function MaterialInForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips, setPackingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [materials] = useData<Material>("materials", []);
  const [services] = useData<Service>("services", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [gstRateMasters] = useData<GstRateMaster>("gst_rate_masters", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [mrrType, setMrrType] = useState<MaterialIn["mrrType"]>("Others");
  const [insurance, setInsurance] = useState<number | "">("");
  const [otherCharges, setOtherCharges] = useState<number | "">("");
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

  const isReturnableReceiptFlow = Boolean(
    (linkedGateEntry?.purpose === "Returnable Receipt" && linkedGateEntry?.sourceGatePassId) ||
    editingEntry?.mrrType === "Service Return"
  );
  const isFgType = mrrType === "Rejection In" || mrrType === "FG Purchase";
  const isServiceReturn = isReturnableReceiptFlow || mrrType === "Service Return";

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
    setSupplierId(editingEntry.supplierId || "");
    setMrrType(editingEntry.mrrType || "Others");
    setInsurance(editingEntry.insurance ?? "");
    setOtherCharges(editingEntry.otherCharges ?? "");
    setRoundOff(editingEntry.roundOff ?? "");
    setLines((editingEntry.lines || []).map((line) => recalculateMaterialLine({ ...line })));

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

  const getApprovedPoOptionsForMaterial = (materialId: string) => {
    if (isFgType) return [];
    const approvedOrders = purchaseOrders.filter(
      (order) =>
        order.status === "Approved" &&
        (!supplierId || order.supplierId === supplierId)
    );

    return approvedOrders
      .flatMap((order) =>
        purchaseOrderLines
          .filter((line) => line.purchaseOrderId === order.id && line.materialId === materialId)
          .map((line) => ({
            value: line.id,
            label: `${order.poNo} | Qty ${Number(line.qty || 0)} @ ${Number(line.rate || 0).toFixed(2)}`,
          }))
      );
  };

  const getResolvedPoForMaterial = (materialId: string, ourPoNoRaw: string) => {
    const search = String(ourPoNoRaw || "").trim().toLowerCase();
    if (!search) return null;

    const approvedOrders = purchaseOrders.filter(
      (order) => order.status === "Approved" && (!supplierId || order.supplierId === supplierId)
    );

    for (const order of approvedOrders) {
      if (!String(order.poNo || "").trim().toLowerCase().includes(search)) continue;
      const matchingLine = purchaseOrderLines.find(
        (line) => line.purchaseOrderId === order.id && line.materialId === materialId
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
    totalActualValue,
    totalCgst,
    totalSgst,
    totalIgst,
    totalInvoiceValueAfterGst,
    insuranceValue,
    otherChargesValue,
    roundOffValue,
    totalAmount,
  } = useMemo(() => summarizeMaterialInLines(lines, insurance, otherCharges, roundOff), [lines, insurance, otherCharges, roundOff]);

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
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? recalculateMaterialLine({
              ...line,
              qty: totalWeight,
              invoiceQty: totalWeight,
              actualQty: totalWeight,
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
    setCurrentInvoiceRate(Number(poLine.rate || 0));
  };

  const handleMrrTypeChange = (value: any) => {
    setMrrType(value);
    setLines([]);
    setPackingSlipDrafts({});
    resetLineDrafts();
  };

  const handleAddLine = () => {
    if (!currentItemId) return;

    if (mrrType === "Others") {
      for (const line of linesForSubmit) {
        if (!String(line.poLineId || "").trim() || !String(line.poNo || "").trim()) {
          alert("Our PO No. is mandatory for every Others line.");
          return;
        }
      }
    }

    if (isServiceReturn) {
      const service = services.find((entry) => entry.id === currentItemId);
      const sourceLine = pendingGatePassLines.find((line) => line.id === currentSourceGatePassLineId);
      const qty = Number(currentQty || 0);
      const invoiceRate = Number(currentInvoiceRate || 0);
      if (!service || !sourceLine || qty <= 0 || qty > Number(sourceLine.pendingQty || 0) || invoiceRate <= 0) return;

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

      setLines((prev) => [...prev, newLine]);
      resetLineDrafts();
      return;
    }

    const selectedPoLine = currentPoLineId ? getPurchaseOrderLine(currentPoLineId) : undefined;
    const resolvedInvoiceRate =
      currentInvoiceRate !== "" && Number(currentInvoiceRate) > 0
        ? Number(currentInvoiceRate)
        : Number(selectedPoLine?.rate || 0);

    if (mrrType === "Others" && !currentPoLineId) {
      alert("Our PO No. is mandatory before adding an Others line.");
      return;
    }
    if (mrrType === "Others" && (!resolvedInvoiceRate || resolvedInvoiceRate <= 0)) return;
    
    const material = getMaterial(currentItemId);
    if (!material) return;

    if (mrrType === "Others" && (currentQty === "" || Number(currentQty) <= 0)) return;
    if (isFgType && (currentReceiptQty === "" || Number(currentReceiptQty) <= 0)) return;

    let qty = 0;
    if (mrrType === "Others") qty = Number(currentQty);
    else if (isFgType) qty = Number(currentReceiptQty);

    const invoiceRate = resolvedInvoiceRate;
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
        const resolvedInvoiceRate =
          patch.invoiceRate !== undefined
            ? Number(patch.invoiceRate || 0)
            : (line.invoiceRate ? Number(line.invoiceRate) : 0) || Number(poLine?.rate || 0);
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
          invoiceRate: resolvedInvoiceRate,
        });
        if (Object.prototype.hasOwnProperty.call(patch, "gstRate")) {
          return applySupplyTypeTaxRates(nextLine, isInterState ? "INTER_STATE" : "INTRA_STATE", { forceFromGstRate: true });
        }
        return applySupplyTypeTaxRates(nextLine, isInterState ? "INTER_STATE" : "INTRA_STATE");
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

      if (!ourPoSearch) {
        throw new Error(`Row ${index + 2}: Our PO No. is mandatory for ${material.name}.`);
      }
      const resolvedPo = getResolvedPoForMaterial(material.id, ourPoSearch);
      if (!resolvedPo) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !invoiceNo || !invDate || !supplierId || lines.length === 0) return;

    const linesForSubmit =
      mrrType === "Reel"
        ? lines.map((line) => {
            const totalWeight = Number(
              (packingSlipDrafts[line.id] || []).reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0).toFixed(2)
            );
            const invoiceRate = Number(line.invoiceRate ?? line.rate ?? 0);
            return recalculateMaterialLine({
              ...line,
              qty: totalWeight,
              invoiceQty: totalWeight,
              actualQty: totalWeight,
              invoiceRate,
              rate: invoiceRate,
              uom: line.uom || "KG",
            });
          })
        : lines.map((line) => recalculateMaterialLine({ ...line }));

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
        if (slips.some((slip) => !String(slip.ourPoId || "").trim() || !String(slip.ourPoNo || "").trim())) {
          alert("Our PO No. is mandatory for every reel row.");
          return;
        }
      }
    }

    const submitSummary = summarizeMaterialInLines(linesForSubmit, insurance, otherCharges, roundOff);

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
          totalInvoiceValue: submitSummary.totalInvoiceValue,
          totalActualValue: submitSummary.totalActualValue,
          totalCgst: submitSummary.totalCgst,
          totalSgst: submitSummary.totalSgst,
          totalIgst: submitSummary.totalIgst,
          totalInvoiceValueAfterGst: submitSummary.totalInvoiceValueAfterGst,
          insurance: submitSummary.insuranceValue,
          otherCharges: submitSummary.otherChargesValue,
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
            <label className="font-bold text-black">Round Off</label>
            <input
              type="number"
              step="0.01"
              value={roundOff}
              onChange={(e) => setRoundOff(e.target.value === "" ? "" : parseFloat(e.target.value))}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
            />
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
            {!isFgType && mrrType === "Others" ? (
              <div className="flex flex-col space-y-1 w-full md:w-80">
                <label className="text-sm font-bold text-black">Our PO No. <span className="text-red-600">*</span></label>
                <Select
                  options={currentItemId ? getApprovedPoOptionsForMaterial(currentItemId) : []}
                  value={currentPoLineId}
                  onChange={handleCurrentPoLineChange}
                  placeholder="Select PO line..."
                />
              </div>
            ) : null}
            <div className="flex flex-col space-y-1 w-full md:w-24">
              <label className="text-sm font-bold text-black">Invoice Rate</label>
              <input
                type="number"
                value={currentInvoiceRate || ""}
                onChange={(e) => setCurrentInvoiceRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
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
                  <thead className="bg-slate-100 divide-x divide-black">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isServiceReturn ? "Service" : isFgType ? "Item" : "Material"}</th>
                      {isServiceReturn ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Returned Item</th> : null}
                      {!isFgType && mrrType === "Others" ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Our PO No.</th> : null}
                      {!isFgType && mrrType === "Others" ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">PO Rate</th> : null}
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">{isServiceReturn ? "Return Qty" : isFgType ? "Item Receipt" : "Invoice Qty"}</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Invoice Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">GST %</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Invoice Value</th>
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
                      const materialName = (line.itemName || getMaterial(line.itemId)?.name || "Unknown");
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
                          {!isFgType && mrrType === "Others" ? (
                            <td className="px-4 py-3 text-sm text-black border border-black min-w-[220px]">
                              <Select
                                options={getApprovedPoOptionsForMaterial(line.itemId)}
                                value={line.poLineId || ""}
                                onChange={(value) => updateLine(line.id, { poLineId: value })}
                                placeholder="Select PO line..."
                              />
                            </td>
                          ) : null}
                          {!isFgType && mrrType === "Others" ? (
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
                              step="0.01"
                              value={(line.invoiceRate ?? line.rate) === 0 ? "" : (line.invoiceRate ?? line.rate)}
                              onChange={(e) => updateLine(line.id, { invoiceRate: Number(e.target.value || 0) })}
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
                                <span className="text-indigo-600 uppercase">Invoice Rate: Rs {Number(line.invoiceRate || 0).toFixed(2)}</span>
                                <span className="text-amber-700 uppercase">PO Rate: Rs {Number(line.poRate || 0).toFixed(2)}</span>
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
                            <thead className="bg-slate-100">
                              <tr>
                                {["Supplier Reel No.", "Our Reel No.", "Weight (KG)", "Supplier PO No.", "Our PO No.", "Action"].map((heading) => (
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
            <div>Total Invoice Value: <span className="text-amber-700">Rs {totalInvoiceValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total CGST: <span className="text-slate-700">Rs {totalCgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total SGST: <span className="text-slate-700">Rs {totalSgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total IGST: <span className="text-slate-700">Rs {totalIgst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Invoice Value After GST: <span className="text-amber-700">Rs {totalInvoiceValueAfterGst.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total Actual Value: <span className="text-indigo-700">Rs {totalActualValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Insurance: <span className="text-slate-700">Rs {insuranceValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Other Charges: <span className="text-slate-700">Rs {otherChargesValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Round Off: <span className="text-slate-700">Rs {roundOffValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div>Total Amount: <span className="text-emerald-700">Rs {totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
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






