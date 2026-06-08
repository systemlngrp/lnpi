import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Edit, Plus, Trash2, Search, Upload, Download, CheckCircle, Package, Layers, Disc } from "lucide-react";
import { useData } from "../hooks/useData";
import { Material, MaterialGroup, MaterialIn, MaterialInPackingSlip, MaterialIssueLine, MaterialIssueReelLine, MaterialReturnLine, MaterialReturnReelLine, Supplier, UnitMaster, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { Select } from "../components/Select";
import * as XLSX from "xlsx";
import { useClientPagination } from "../hooks/useClientPagination";
import { fetchNpdItems } from "../lib/npdItems";

type MaterialType = Material["type"];
type ActiveValue = NonNullable<Material["active"]>;

const TYPE_OPTIONS = [
  { value: "Reel", label: "Reel" },
  { value: "Other", label: "Other" },
];
const ACTIVE_OPTIONS: ActiveValue[] = ["Yes", "No"];

function normalizeBulkMaterialType(value: unknown): MaterialType | "" {
  const normalizedValue = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (normalizedValue === "reel") return "Reel";
  if (normalizedValue === "other" || normalizedValue === "others") return "Other";
  return "";
}

function isBulkMaterialRowEmpty(row: Record<string, unknown>) {
  return Object.values(row).every((value) => String(value ?? "").trim() === "");
}

function normalizeText(value: string | number | undefined | null) {
  return String(value ?? "").trim().toLowerCase();
}

function parseNumericInput(value: string) {
  if (!value.trim()) return "";
  const numeric = Number(value);
  return Number.isNaN(numeric) ? "" : numeric;
}

function formatOptionalNumber(value?: number) {
  return value === undefined || value === null || Number.isNaN(Number(value)) ? "" : String(Number(value));
}

function getMaterialRapcFromSize(size: string | number | undefined | null) {
  const numericSize = Number(size);
  if (!Number.isFinite(numericSize) || numericSize <= 0) return "";
  return String(numericSize * 10);
}

function getReelDisplayName(erpCode: string | number, size: number, uom: string, gsm: number, bf: number) {
  return `${erpCode} - Size: ${size} ${uom} X GSM: ${gsm} X BF: ${bf}`;
}

function getNextNumericErpCode(materials: Material[]) {
  const numericValues = materials
    .filter((material) => material.type === "Reel")
    .map((material) => Number(material.erpCode))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (numericValues.length === 0) return "1";
  return String(Math.max(...numericValues) + 1);
}

function getNextOtherErpCode(materials: Material[]) {
  const otherValues = materials
    .filter((material) => material.type === "Other")
    .map((material) => String(material.erpCode || "").trim().toUpperCase())
    .map((erpCode) => {
      const match = erpCode.match(/^OTH(\d+)$/);
      return match ? Number(match[1]) : NaN;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const nextValue = otherValues.length === 0 ? 100001 : Math.max(...otherValues) + 1;
  return `OTH${nextValue}`;
}

function createInitialFormState(materials: Material[], reelGroupId = "") {
  return {
    type: "Reel" as MaterialType,
    erpCode: getNextNumericErpCode(materials),
    name: "",
    uom: "CM",
    materialGroupId: reelGroupId,
    size: "",
    gsm: "",
    bf: "",
    openingQty: "",
    openingRate: "",
    openingValue: "",
    remarks: "",
    active: "Yes" as ActiveValue,
  };
}

export function Materials() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useData<Material>("materials", []);
  const [materialGroups, setMaterialGroups] = useData<MaterialGroup>("material-groups", []);
  const [units, setUnits] = useData<UnitMaster>("units", []);
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips, setPackingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [reelIssueLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturnsHeader] = useData<MaterialReturn>("material-returns", []);
  const [returnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [reelReturnLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [npdItems, setNpdItems] = useState<Item[]>([]);
  
  useEffect(() => {
    fetchNpdItems().then(setNpdItems).catch(() => setNpdItems([]));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reelGroup = useMemo(
    () => materialGroups.find((group) => group.name.trim().toLowerCase() === "reel") || null,
    [materialGroups]
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sizeFilter, setSizeFilter] = useState("All");
  const [gsmFilter, setGsmFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [savingUnit, setSavingUnit] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const movementSummaryMap = useMemo(() => {
    const map = new Map<string, { receipts: number; issues: number; returns: number }>();
    const materialTypeMap = new Map(materials.map(m => [m.id, m.type]));
    materials.forEach(m => map.set(m.id, { receipts: 0, issues: 0, returns: 0 }));

    // 1. Receipts Filtering
    const filteredReceiptIds = new Set(
      materialIn
        .filter(r => {
          const d = r.date || "";
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
          return true;
        })
        .map(r => r.id)
    );

    // 2. Issues Filtering
    const filteredIssueIds = new Set(
      materialIssues
        .filter(i => {
          const d = i.date || "";
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
          return true;
        })
        .map(i => i.id)
    );

    // 3. Returns Filtering
    const filteredReturnIds = new Set(
      materialReturnsHeader
        .filter(r => {
          const d = r.date || "";
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
          return true;
        })
        .map(r => r.id)
    );

    // Aggregate Receipts
    packingSlips.forEach(slip => {
      if (!filteredReceiptIds.has(slip.materialInId)) return;
      const current = map.get(slip.materialId) || { receipts: 0, issues: 0, returns: 0 };
      current.receipts += Number(slip.weightKg || 0);
      map.set(slip.materialId, current);
    });

    materialIn.forEach(receipt => {
      if (!filteredReceiptIds.has(receipt.id)) return;
      if (receipt.mrrType !== "Reel") {
        receipt.lines.forEach(line => {
          const current = map.get(line.itemId) || { receipts: 0, issues: 0, returns: 0 };
          current.receipts += Number(line.qty || 0);
          map.set(line.itemId, current);
        });
      }
    });

    // Aggregate Issues
    reelIssueLines.forEach(l => {
      if (!filteredIssueIds.has(l.materialIssueId)) return;
      const current = map.get(l.materialId) || { receipts: 0, issues: 0, returns: 0 };
      current.issues += Number(l.weightKg || 0);
      map.set(l.materialId, current);
    });

    issueLines.forEach(l => {
      if (!filteredIssueIds.has(l.materialIssueId)) return;
      // SKIP REELS to avoid double counting from reelIssueLines
      if (materialTypeMap.get(l.materialId) === "Reel") return;
      
      const current = map.get(l.materialId) || { receipts: 0, issues: 0, returns: 0 };
      current.issues += Number(l.qty || 0);
      map.set(l.materialId, current);
    });

    // Aggregate Returns
    reelReturnLines.forEach(l => {
      if (!filteredReturnIds.has(l.materialReturnId)) return;
      const current = map.get(l.materialId) || { receipts: 0, issues: 0, returns: 0 };
      current.returns += Number(l.weightKg || 0);
      map.set(l.materialId, current);
    });

    returnLines.forEach(l => {
      if (!filteredReturnIds.has(l.materialReturnId)) return;
      // SKIP REELS to avoid double counting from reelReturnLines
      if (materialTypeMap.get(l.materialId) === "Reel") return;

      const current = map.get(l.materialId) || { receipts: 0, issues: 0, returns: 0 };
      current.returns += Number(l.qty || 0);
      map.set(l.materialId, current);
    });

    return map;
  }, [materials, packingSlips, materialIn, materialIssues, issueLines, reelIssueLines, materialReturnsHeader, returnLines, reelReturnLines, fromDate, toDate]);

  const metrics = useMemo(() => {
    let totalReelWeight = 0;
    let totalOtherStock = 0;
    filteredMaterials.forEach(m => {
      const mvt = movementSummaryMap.get(m.id) || { receipts: 0, issues: 0, returns: 0 };
      const balance = Number(m.openingQty || 0) + mvt.receipts + mvt.returns - mvt.issues;
      if (m.type === "Reel") totalReelWeight += balance;
      else totalOtherStock += balance;
    });
    return {
      total: filteredMaterials.length,
      active: filteredMaterials.filter(m => m.active !== "No").length,
      reelWeight: totalReelWeight,
      otherStock: totalOtherStock,
    };
  }, [filteredMaterials, movementSummaryMap]);

  const [formData, setFormData] = useState(() => createInitialFormState(materials, reelGroup?.id || ""));

  const unitOptions = useMemo(
    () =>
      units
        .filter((unit) => unit.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((unit) => ({ value: unit.name, label: unit.name })),
    [units]
  );

  function resetForm(nextMaterials = materials, nextReelGroupId = reelGroup?.id || "") {
    setFormData(createInitialFormState(nextMaterials, nextReelGroupId));
    setEditingId(null);
    setIsFormOpen(false);
    setShowGroupModal(false);
    setShowUnitModal(false);
    setNewGroupName("");
    setNewUnitName("");
  }

  function syncReelDefaults(nextType: MaterialType, current = formData) {
    if (nextType === "Reel") {
      return {
        ...current,
        type: "Reel" as MaterialType,
        uom: "CM",
        materialGroupId: reelGroup?.id || current.materialGroupId,
        erpCode: editingId ? current.erpCode : getNextNumericErpCode(materials),
      };
    }
    return {
      ...current,
      type: "Other" as MaterialType,
      uom: "CM",
      erpCode: editingId ? current.erpCode : getNextOtherErpCode(materials),
    };
  }

  function handleOpenNew() {
    setEditingId(null);
    setFormData(createInitialFormState(materials, reelGroup?.id || ""));
    setIsFormOpen(true);
  }

  function handleEdit(material: Material) {
    setEditingId(material.id);
    setFormData({
      type: material.type,
      erpCode: String(material.erpCode ?? ""),
      name: material.type === "Other" ? material.name : "",
      uom: material.uom || "CM",
      materialGroupId: material.materialGroupId || (material.type === "Reel" ? reelGroup?.id || "" : ""),
      size: formatOptionalNumber(material.size),
      gsm: formatOptionalNumber(material.gsm),
      bf: formatOptionalNumber(material.bf),
      openingQty: formatOptionalNumber(material.openingQty),
      openingRate: formatOptionalNumber(material.openingRate),
      openingValue: formatOptionalNumber(material.openingValue),
      remarks: material.remarks || "",
      active: material.active === "No" ? "No" : "Yes",
    });
    setIsFormOpen(true);
  }

  function handleDelete(id: string) {
    setMaterials(materials.filter((material) => material.id !== id));
  }

  function handleToggleActive(material: Material) {
    const timestamp = new Date().toISOString();
    setMaterials(
      materials.map((row) =>
        row.id === material.id
          ? {
              ...row,
              active: material.active === "No" ? "Yes" : "No",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            }
          : row
      )
    );
  }

  async function handleCreateGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    const normalizedName = newGroupName.trim();
    const existing = materialGroups.find((group) => normalizeText(group.name) === normalizedName.toLowerCase());
    if (existing) {
      setFormData((prev) => ({ ...prev, materialGroupId: existing.id }));
      setShowGroupModal(false);
      setNewGroupName("");
      return;
    }
    setSavingGroup(true);
    const timestamp = new Date().toISOString();
    const nextGroup: MaterialGroup = { id: crypto.randomUUID(), name: normalizedName, updatedBy: "System User", updateTimestamp: timestamp };
    try {
      await setMaterialGroups([...materialGroups, nextGroup]);
      setFormData((prev) => ({ ...prev, materialGroupId: nextGroup.id }));
      setShowGroupModal(false);
      setNewGroupName("");
    } catch (error) {
      console.error("Failed to save material group:", error);
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleCreateUnit(event: React.FormEvent) {
    event.preventDefault();
    if (!newUnitName.trim()) return;
    const normalizedName = newUnitName.trim();
    const existing = units.find((unit) => normalizeText(unit.name) === normalizedName.toLowerCase());
    if (existing) {
      setFormData((prev) => ({ ...prev, uom: existing.name }));
      setShowUnitModal(false);
      setNewUnitName("");
      return;
    }
    setSavingUnit(true);
    const timestamp = new Date().toISOString();
    const nextUnit: UnitMaster = { id: crypto.randomUUID(), name: normalizedName, active: "Yes", updatedBy: "System User", updateTimestamp: timestamp };
    try {
      await setUnits([...units, nextUnit]);
      setFormData((prev) => ({ ...prev, uom: nextUnit.name }));
      setShowUnitModal(false);
      setNewUnitName("");
    } catch (error) {
      console.error("Failed to save unit:", error);
    } finally {
      setSavingUnit(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedType = formData.type;
    const erpCode = String(formData.erpCode || "").trim() || (normalizedType === "Reel" ? getNextNumericErpCode(materials) : getNextOtherErpCode(materials));
    const uom = String(formData.uom || "").trim() || "CM";
    const timestamp = new Date().toISOString();
    const size = parseNumericInput(formData.size);
    const gsm = parseNumericInput(formData.gsm);
    const bf = parseNumericInput(formData.bf);
    const openingQty = parseNumericInput(formData.openingQty);
    const openingRate = parseNumericInput(formData.openingRate);
    const openingValueInput = parseNumericInput(formData.openingValue);
    const openingValue = openingValueInput !== "" ? Number(openingValueInput) : openingQty !== "" && openingRate !== "" ? Number(openingQty) * Number(openingRate) : undefined;
    if (normalizedType === "Reel" && (size === "" || gsm === "" || bf === "")) {
      alert("Size, GSM, and BF are required for Reel.");
      return;
    }
    if (normalizedType === "Other" && !formData.materialGroupId) {
      alert("Item Group is required for Other items.");
      return;
    }
    if (normalizedType === "Other" && !formData.name.trim()) {
      alert("Item Name is required for Other items.");
      return;
    }
    setIsSubmitting(true);
    try {
      let reelGroupId = reelGroup?.id || "";
      if (normalizedType === "Reel" && !reelGroupId) {
        const nextReelGroup: MaterialGroup = { id: crypto.randomUUID(), name: "Reel", updatedBy: "System User", updateTimestamp: timestamp };
        await setMaterialGroups([...materialGroups, nextReelGroup]);
        reelGroupId = nextReelGroup.id;
      }
      const nextMaterial: Material = {
        id: editingId || crypto.randomUUID(),
        type: normalizedType,
        erpCode: erpCode || undefined,
        name: normalizedType === "Reel" ? getReelDisplayName(erpCode, Number(size), uom, Number(gsm), Number(bf)) : formData.name.trim(),
        uom,
        materialGroupId: normalizedType === "Reel" ? reelGroupId || undefined : formData.materialGroupId || undefined,
        size: normalizedType === "Reel" ? Number(size) : undefined,
        gsm: normalizedType === "Reel" ? Number(gsm) : undefined,
        bf: normalizedType === "Reel" ? Number(bf) : undefined,
        openingQty: openingQty === "" ? undefined : Number(openingQty),
        openingRate: openingRate === "" ? undefined : Number(openingRate),
        openingValue,
        remarks: String(formData.remarks || "").trim() || undefined,
        active: formData.active,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
      const nextMaterials = editingId ? materials.map((material) => (material.id === editingId ? nextMaterial : material)) : [nextMaterial, ...materials];
      await setMaterials(nextMaterials);
      resetForm(nextMaterials, reelGroupId);
    } catch (error) {
      console.error("Failed to save material:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const sizeOptions = useMemo(() => {
    const values = Array.from(new Set(materials.map((material) => formatOptionalNumber(material.size)).filter(Boolean)));
    return values.sort((a, b) => Number(a) - Number(b));
  }, [materials]);

  const gsmOptions = useMemo(() => {
    const values = Array.from(new Set(materials.map((material) => formatOptionalNumber(material.gsm)).filter(Boolean)));
    return values.sort((a, b) => Number(a) - Number(b));
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    return [...materials]
      .filter((material) => {
        const matchesSearch = !searchTerm || normalizeText(material.erpCode).includes(searchTerm.toLowerCase()) || normalizeText(material.name).includes(searchTerm.toLowerCase());
        const matchesType = typeFilter === "All" || material.type === typeFilter;
        const matchesSize = sizeFilter === "All" || formatOptionalNumber(material.size) === sizeFilter;
        const matchesGsm = gsmFilter === "All" || formatOptionalNumber(material.gsm) === gsmFilter;
        return matchesSearch && matchesType && matchesSize && matchesGsm;
      })
      .sort((a, b) => {
        const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
        const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
        return timeB - timeA || a.name.localeCompare(b.name);
      });
  }, [gsmFilter, materials, searchTerm, sizeFilter, typeFilter]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems: paginatedMaterials } = useClientPagination(filteredMaterials, 25);

  function downloadTemplate() {
    const templateData = [
      { "Type": "Reel", "ERP Code": "1001", "Item Name": "", "Item Group": "Reel", "MRR No.": "MI/26-27/00001", "MRR Date": "2026-06-02", "Supplier Name": "Bizskill", "Our Reel No.": "R00001", "Reel Qty": 250.5, "Unit": "CM", "Size": 120, "GSM": 150, "BF": 18, "Opening Qty": 0, "Opening Rate": 0, "Opening Value": 0, "Remarks": "", "Active": "Yes" },
      { "Type": "Other", "ERP Code": "2001", "Item Name": "Service", "Item Group": "Consumable", "MRR No.": "", "MRR Date": "", "Supplier Name": "", "Our Reel No.": "", "Reel Qty": "", "Unit": "CM", "Size": "", "GSM": "", "BF": "", "Opening Qty": 0, "Opening Rate": 0, "Opening Value": 0, "Remarks": "", "Active": "Yes" }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Materials");
    XLSX.writeFile(wb, "Material_Master_Bulk_Template.xlsx");
  }

  function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
        if (data.length === 0) { alert("The file is empty."); return; }
        setIsUploading(true);
        const timestamp = new Date().toISOString();
        const nextGroups = [...materialGroups];
        let reelGroupId = reelGroup?.id || "";
        let nextMaterialIn = [...materialIn];
        let nextPackingSlips = [...packingSlips];
        if (!reelGroupId) {
          const nextReelGroup: MaterialGroup = { id: crypto.randomUUID(), name: "Reel", updatedBy: "System User", updateTimestamp: timestamp };
          nextGroups.push(nextReelGroup);
          reelGroupId = nextReelGroup.id;
        }
        const groupMap = new Map(nextGroups.map((group) => [normalizeText(group.name), group]));
        const supplierMap = new Map(suppliers.map((supplier) => [normalizeText(supplier.name), supplier]));
        let nextMaterials = [...materials];
        const reelOpeningQtyByErp = new Map<string, number>();
        const reelOpeningBalanceByErp = new Map<string, number>();
        const reelReceiptRows: Array<{ materialId: string; ourReelNo: string; reelQty: number; mrrNo: string; mrrDate: string; supplierId: string; }> = [];
        data.forEach((row: any) => {
          if (isBulkMaterialRowEmpty(row)) return;
          const type = normalizeBulkMaterialType(row["Type"]);
          if (type !== "Reel") return;
          const erpCode = String(row["ERP Code"] || "").trim();
          const reelQtyValue = parseNumericInput(String(row["Reel Qty"] ?? ""));
          const openingQtyValue = parseNumericInput(String(row["Opening Qty"] ?? ""));
          if (!erpCode || reelQtyValue === "") return;
          reelOpeningQtyByErp.set(erpCode, Number((reelOpeningQtyByErp.get(erpCode) || 0) + Number(reelQtyValue || 0)));
          if (openingQtyValue !== "") {
            const numericOpeningQty = Number(openingQtyValue || 0);
            if (reelOpeningBalanceByErp.has(erpCode) && reelOpeningBalanceByErp.get(erpCode) !== numericOpeningQty) throw new Error(`Reel rows for ERP ${erpCode} must use the same Opening Qty balance.`);
            reelOpeningBalanceByErp.set(erpCode, numericOpeningQty);
          }
        });
        data.forEach((row: any, index) => {
          if (isBulkMaterialRowEmpty(row)) return;
          const type = normalizeBulkMaterialType(row["Type"]);
          if (!type) throw new Error(`Row ${index + 2}: Type must be Reel or Other.`);
          const erpCode = String(row["ERP Code"] || "").trim() || (type === "Reel" ? getNextNumericErpCode(nextMaterials) : getNextOtherErpCode(nextMaterials));
          const itemName = String(row["Item Name"] || "").trim();
          const groupName = String(row["Item Group"] || "").trim();
          const unit = String(row["Unit"] || "CM").trim() || "CM";
          const mrrNo = String(row["MRR No."] || "").trim();
          const mrrDate = String(row["MRR Date"] || "").trim();
          const supplierName = String(row["Supplier Name"] || "").trim();
          const ourReelNo = String(row["Our Reel No."] || "").trim();
          const reelQtyValue = parseNumericInput(String(row["Reel Qty"] ?? ""));
          const sizeValue = parseNumericInput(String(row["Size"] ?? ""));
          const gsmValue = parseNumericInput(String(row["GSM"] ?? ""));
          const bfValue = parseNumericInput(String(row["BF"] ?? ""));
          const openingQtyValue = parseNumericInput(String(row["Opening Qty"] ?? ""));
          const openingRateValue = parseNumericInput(String(row["Opening Rate"] ?? ""));
          const openingValueInput = parseNumericInput(String(row["Opening Value"] ?? ""));
          const remarks = String(row["Remarks"] ?? "").trim();
          const activeValue = String(row["Active"] || "Yes").trim() === "No" ? "No" : "Yes";
          if (type === "Reel" && (sizeValue === "" || gsmValue === "" || bfValue === "")) throw new Error(`Row ${index + 2}: Reel rows require Size, GSM, and BF.`);
          if (type === "Reel") if (!mrrNo || !mrrDate || !supplierName || !ourReelNo || reelQtyValue === "") throw new Error(`Row ${index + 2}: Reel rows require MRR No., MRR Date, Supplier Name, Our Reel No., and Reel Qty.`);
          if (type === "Other" && !itemName) throw new Error(`Row ${index + 2}: Other rows require Item Name.`);
          let materialGroupId: string | undefined = undefined;
          if (type === "Reel") materialGroupId = reelGroupId;
          else {
            if (!groupName) throw new Error(`Row ${index + 2}: Other rows require Item Group.`);
            const normalizedGroupName = normalizeText(groupName);
            let matchedGroup = groupMap.get(normalizedGroupName);
            if (!matchedGroup) { matchedGroup = { id: crypto.randomUUID(), name: groupName, updatedBy: "System User", updateTimestamp: timestamp }; nextGroups.push(matchedGroup); groupMap.set(normalizedGroupName, matchedGroup); }
            materialGroupId = matchedGroup.id;
          }
          const openingValue = openingValueInput !== "" ? Number(openingValueInput) : openingQtyValue !== "" && openingRateValue !== "" ? Number(openingQtyValue) * Number(openingRateValue) : undefined;
          const generatedName = type === "Reel" ? getReelDisplayName(erpCode, Number(sizeValue), unit, Number(gsmValue), Number(bfValue)) : itemName;
          const existing = nextMaterials.find((material) => type === "Reel" ? normalizeText(material.erpCode) === normalizeText(erpCode) : normalizeText(material.name) === normalizeText(generatedName));
          const nextMaterial: Material = {
            id: existing?.id || crypto.randomUUID(), type, erpCode: erpCode || undefined, name: generatedName, uom: unit, materialGroupId, size: type === "Reel" && sizeValue !== "" ? Number(sizeValue) : undefined, gsm: type === "Reel" && gsmValue !== "" ? Number(gsmValue) : undefined, bf: type === "Reel" && bfValue !== "" ? Number(bfValue) : undefined,
            openingQty: type === "Reel" ? Number((reelOpeningQtyByErp.get(erpCode) || 0) + (reelOpeningBalanceByErp.get(erpCode) || 0)) || undefined : openingQtyValue === "" ? undefined : Number(openingQtyValue),
            openingRate: openingRateValue === "" ? undefined : Number(openingRateValue),
            openingValue: type === "Reel" ? (openingValueInput !== "" ? Number(openingValueInput) : Number((Number(reelOpeningQtyByErp.get(erpCode) || 0) + (reelOpeningBalanceByErp.get(erpCode) || 0)) * Number(openingRateValue || 0))) || undefined : openingValue,
            remarks: remarks || undefined, active: activeValue, updatedBy: "System User", updateTimestamp: timestamp
          };
          if (existing) nextMaterials = nextMaterials.map((material) => (material.id === existing.id ? nextMaterial : material));
          else nextMaterials = [nextMaterial, ...nextMaterials];
          if (type === "Reel") {
            const matchedSupplier = supplierMap.get(normalizeText(supplierName));
            if (!matchedSupplier) throw new Error(`Row ${index + 2}: Supplier Name not found.`);
            if (Number(reelQtyValue) <= 0) throw new Error(`Row ${index + 2}: Reel Qty must be greater than 0.`);
            reelReceiptRows.push({ materialId: nextMaterial.id, ourReelNo, reelQty: Number(reelQtyValue), mrrNo, mrrDate, supplierId: matchedSupplier.id });
          }
        });
        const receiptGroups = new Map<string, typeof reelReceiptRows>();
        reelReceiptRows.forEach((row) => {
          const key = `${row.mrrNo}__${row.mrrDate}__${row.supplierId}`;
          const current = receiptGroups.get(key) || [];
          current.push(row);
          receiptGroups.set(key, current);
        });
        receiptGroups.forEach((rowsForReceipt) => {
          const sample = rowsForReceipt[0];
          const existingReceipt = nextMaterialIn.find((entry) => entry.transactionNo === sample.mrrNo && entry.supplierId === sample.supplierId);
          const packingSlipsForReceipt = nextPackingSlips.filter((slip) => slip.materialInId === existingReceipt?.id);
          const existingLineByMaterial = new Map((existingReceipt?.lines || []).map((line) => [line.itemId, line]));
          const existingSlipByReelNo = new Map(packingSlipsForReceipt.map((slip) => [normalizeText(slip.ourReelNo), slip]));
          const mergedSlipMap = new Map(packingSlipsForReceipt.map((slip) => [normalizeText(slip.ourReelNo), { materialId: slip.materialId, ourReelNo: slip.ourReelNo, weightKg: Number(slip.weightKg || 0), existingSlip: slip }]));
          rowsForReceipt.forEach((row) => { mergedSlipMap.set(normalizeText(row.ourReelNo), { materialId: row.materialId, ourReelNo: row.ourReelNo, weightKg: Number(row.reelQty || 0), existingSlip: existingSlipByReelNo.get(normalizeText(row.ourReelNo)) }); });
          const aggregatedWeightByMaterial = new Map<string, number>();
          Array.from(mergedSlipMap.values()).forEach((slip) => { aggregatedWeightByMaterial.set(slip.materialId, Number((aggregatedWeightByMaterial.get(slip.materialId) || 0) + Number(slip.weightKg || 0))); });
          const nextLines = Array.from(aggregatedWeightByMaterial.entries()).map(([materialId, totalQty]) => {
            const existingLine = existingLineByMaterial.get(materialId);
            return { id: existingLine?.id || crypto.randomUUID(), itemId: materialId, qty: totalQty, uom: "KG", invoiceQty: totalQty, invoiceRate: Number(existingLine?.invoiceRate ?? existingLine?.rate ?? 0), invoiceValue: 0, actualQty: totalQty, actualValue: 0, rate: Number(existingLine?.rate || 0), value: 0 };
          });
          const nextReceiptId = existingReceipt?.id || crypto.randomUUID();
          const nextReceipt: MaterialIn = { id: nextReceiptId, transactionNo: sample.mrrNo, mrrType: "Reel", timestamp: existingReceipt?.timestamp || timestamp, entryEmailId: existingReceipt?.entryEmailId || "system@lngrp.in", date: sample.mrrDate, invoiceNo: existingReceipt?.invoiceNo || sample.mrrNo, invDate: sample.mrrDate, supplierId: sample.supplierId, totalAmount: 0, totalInvoiceValue: 0, totalActualValue: 0, lines: nextLines, status: existingReceipt?.status || "Completed", updatedBy: "System User", updateTimestamp: timestamp };
          if (existingReceipt) nextMaterialIn = nextMaterialIn.map((entry) => (entry.id === existingReceipt.id ? nextReceipt : entry));
          else nextMaterialIn = [...nextMaterialIn, nextReceipt];
          Array.from(mergedSlipMap.values()).forEach((row) => {
            const matchingLine = nextLines.find((line) => line.itemId === row.materialId);
            const existingSlip = row.existingSlip;
            const nextSlip: MaterialInPackingSlip = { id: existingSlip?.id || crypto.randomUUID(), materialInId: nextReceiptId, materialLineId: matchingLine?.id || crypto.randomUUID(), materialId: row.materialId, ourReelNo: row.ourReelNo, weightKg: Number(row.weightKg), updatedBy: "System User", updateTimestamp: timestamp };
            if (existingSlip) nextPackingSlips = nextPackingSlips.map((slip) => (slip.id === existingSlip.id ? nextSlip : slip));
            else nextPackingSlips = [...nextPackingSlips, nextSlip];
          });
        });
        await setMaterialGroups(nextGroups); await setMaterials(nextMaterials); await setMaterialIn(nextMaterialIn); await setPackingSlips(nextPackingSlips);
        alert(`Successfully uploaded ${data.length} material rows.`);
      } catch (error) {
        console.error("Material bulk upload error:", error);
        alert(error instanceof Error ? error.message : "Failed to parse the Excel file.");
      } finally { setIsUploading(false); e.target.value = ""; }
    };
    reader.readAsBinaryString(file);
  }

  function clearFilters() {
    setSearchTerm("");
    setTypeFilter("All");
    setSizeFilter("All");
    setGsmFilter("All");
    setFromDate("");
    setToDate("");
  }

  const groupOptions = materialGroups
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({ value: group.id, label: group.name }));

  return (
    <div className="space-y-6">
      {isFormOpen ? (
        <div className="bg-white border border-black rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">{editingId ? "Edit Item" : "New Item"}</h2>
            <button
              type="button"
              onClick={() => resetForm()}
              className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
            >
              Back
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-7">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">
                  Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const nextType = e.target.value as MaterialType;
                    setFormData((prev) => {
                      if (nextType === "Reel") {
                        return syncReelDefaults(nextType, {
                          ...prev,
                          type: nextType,
                          name: "",
                          size: prev.size,
                          gsm: prev.gsm,
                          bf: prev.bf,
                        });
                      }
                      return {
                        ...prev,
                        type: nextType,
                        erpCode: prev.erpCode || "",
                        name: prev.type === "Reel" ? "" : prev.name,
                        uom: prev.uom || "CM",
                        materialGroupId: "",
                        size: "",
                        gsm: "",
                        bf: "",
                        openingQty: prev.openingQty,
                        openingRate: prev.openingRate,
                        openingValue: prev.openingValue,
                        remarks: prev.remarks || "",
                      };
                    });
                  }}
                  className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {formData.type === "Reel" ? (
                <div className="space-y-2">
                  <label className="text-blue-700 font-bold">Unit</label>
                  <input
                    value="CM"
                    readOnly
                    className="w-full rounded border-2 border-black bg-slate-100 px-4 py-3 text-black focus:outline-none"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-blue-700 font-bold">ERP Code</label>
                  <input
                    value={formData.erpCode}
                    onChange={(e) => setFormData((prev) => ({ ...prev, erpCode: e.target.value }))}
                    className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
              )}

              {formData.type === "Reel" ? (
                <div className="space-y-2">
                  <label className="text-blue-700 font-bold">Item Group</label>
                  <input
                    value="Reel"
                    readOnly
                    className="w-full rounded border-2 border-black bg-slate-100 px-4 py-3 text-black focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">Unit</label>
                    <Select
                      value={formData.uom}
                      onChange={(value) => setFormData((prev) => ({ ...prev, uom: value }))}
                      options={unitOptions}
                      placeholder="Select unit"
                      onAdd={() => setShowUnitModal(true)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      Item Group <span className="text-red-500">*</span>
                    </label>
                    <Select
                      value={formData.materialGroupId}
                      onChange={(value) => setFormData((prev) => ({ ...prev, materialGroupId: value }))}
                      options={groupOptions}
                      placeholder="Select group"
                      onAdd={() => setShowGroupModal(true)}
                    />
                  </div>
                </>
              )}

              {formData.type === "Reel" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      Size <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.size}
                      onChange={(e) => setFormData((prev) => ({ ...prev, size: e.target.value }))}
                      className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      GSM <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.gsm}
                      onChange={(e) => setFormData((prev) => ({ ...prev, gsm: e.target.value }))}
                      className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      BF <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.bf}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bf: e.target.value }))}
                      className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2 md:col-span-2">
                  <label className="text-blue-700 font-bold">
                    Item Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">Opening Qty</label>
                <input
                  value={formData.openingQty}
                  onChange={(e) => setFormData((prev) => ({ ...prev, openingQty: e.target.value }))}
                  className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">Opening Rate</label>
                <input
                  value={formData.openingRate}
                  onChange={(e) => setFormData((prev) => ({ ...prev, openingRate: e.target.value }))}
                  className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">Opening Value</label>
                <input
                  value={formData.openingValue}
                  onChange={(e) => setFormData((prev) => ({ ...prev, openingValue: e.target.value }))}
                  placeholder={
                    formData.openingQty && formData.openingRate && !formData.openingValue
                      ? String(Number(formData.openingQty || 0) * Number(formData.openingRate || 0))
                      : ""
                  }
                  className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">Remarks</label>
                <input
                  value={formData.remarks}
                  onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                  className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-blue-700 font-bold">RAPC</label>
                <input
                  value={formData.type === "Reel" ? getMaterialRapcFromSize(formData.size) : ""}
                  readOnly
                  className="w-full rounded border-2 border-black bg-slate-100 px-4 py-3 text-black focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-blue-700 font-bold">Active</label>
              <select
                value={formData.active}
                onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.value as ActiveValue }))}
                className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              >
                {ACTIVE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2 rounded transition disabled:opacity-50 border border-black shadow"
              >
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save Item"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-black tracking-tight uppercase">Material Master</h2>
                <p className="text-sm font-medium text-slate-600 uppercase">
                  Inventory Overview & Tracking
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center justify-center gap-2 rounded border border-black bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-slate-50 whitespace-nowrap shadow"
                >
                  <Download size={14} /> Template
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded border border-black bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-slate-50 whitespace-nowrap shadow">
                  {isUploading ? <Spinner size={14} /> : <Upload size={14} />}
                  Bulk Upload
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={handleBulkUpload}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleOpenNew}
                  className="inline-flex items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 whitespace-nowrap border border-black shadow"
                >
                  <Plus size={14} /> New Item
                </button>
              </div>
            </div>

            {/* Colorful Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
                <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Total Materials</div>
                <div className="text-3xl font-black">{metrics.total}</div>
                <div className="text-[10px] font-bold mt-1 opacity-90">{metrics.active} Active Items</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
                <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Reel Stock</div>
                <div className="text-3xl font-black">{metrics.reelWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm">KG</span></div>
                <div className="text-[10px] font-bold mt-1 opacity-90">Net Weight in Godown</div>
              </div>
              <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
                <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Other Stock</div>
                <div className="text-3xl font-black">{metrics.otherStock.toLocaleString()}</div>
                <div className="text-[10px] font-bold mt-1 opacity-90">Consumables & Spares</div>
              </div>
              <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
                <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Filtered Items</div>
                <div className="text-3xl font-black">{filteredMaterials.length}</div>
                <div className="text-[10px] font-bold mt-1 opacity-90">Based on active filters</div>
              </div>
            </div>

            <div className="bg-white border-2 border-black rounded-xl p-4 shadow-sm space-y-4 mt-6">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[240px] space-y-1">
                  <div className="text-blue-700 font-bold text-[10px] uppercase tracking-wider">Search</div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search by ERP Code or Item Name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full rounded border border-black pl-9 pr-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-blue-700 font-bold text-[10px] uppercase tracking-wider">From Date</div>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="border border-black rounded px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-blue-700 font-bold text-[10px] uppercase tracking-wider">To Date</div>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="border border-black rounded px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-slate-100">
                <FilterSelect compact label="Material Type" value={typeFilter} onChange={setTypeFilter} options={["All", ...TYPE_OPTIONS.map((option) => option.value)]} />
                <FilterSelect compact label="Size Filter" value={sizeFilter} onChange={setSizeFilter} options={["All", ...sizeOptions]} />
                <FilterSelect compact label="GSM Filter" value={gsmFilter} onChange={setGsmFilter} options={["All", ...gsmOptions]} />

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded transition uppercase"
                  >
                    Reset All
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 border border-black rounded text-xs font-bold hover:bg-slate-50 transition uppercase shadow-sm"
                  >
                    Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded shadow-sm border border-black overflow-hidden mt-6">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-indigo-700 text-white divide-x divide-indigo-800">
                    {["SL", "Type", "ERP Code", "Item Name", "Size", "GSM", "BF", "Opening", "Receipts", "Issues", "Returns", "Balance", "Unit"].map((heading) => (
                      <th key={heading} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wider border-b-2 border-black whitespace-nowrap">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black">
                  {filteredMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-6 py-10 text-center text-slate-500 font-medium italic">
                        No materials matching your search criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedMaterials.map((material, index) => {
                      const mvt = movementSummaryMap.get(material.id) || { receipts: 0, issues: 0, returns: 0 };
                      const balance = Number(material.openingQty || 0) + mvt.receipts + mvt.returns - mvt.issues;
                      return (
                        <tr key={material.id} className={`hover:bg-indigo-50/30 transition-colors divide-x divide-black ${material.active === "No" ? "opacity-50 grayscale" : ""}`}>
                          <td className="px-4 py-3 text-black font-bold text-xs">{(page - 1) * pageSize + index + 1}</td>
                          <td className="px-4 py-3 text-black text-[10px] font-bold uppercase">{material.type}</td>
                          <td className="px-4 py-3 text-black text-xs font-black tracking-tight">{material.erpCode || ""}</td>
                          <td className="px-4 py-3 text-black text-xs font-bold min-w-[300px]">{material.name}</td>
                          <td className="px-4 py-3 text-black text-xs">{material.size ?? "-"}</td>
                          <td className="px-4 py-3 text-black text-xs">{material.gsm ?? "-"}</td>
                          <td className="px-4 py-3 text-black text-xs">{material.bf ?? "-"}</td>
                          <td className="px-4 py-3 text-black text-xs font-medium bg-slate-50">{material.openingQty?.toLocaleString() ?? "0"}</td>
                          <td className="px-4 py-3 text-emerald-700 text-xs font-bold bg-emerald-50/30">{mvt.receipts.toLocaleString()}</td>
                          <td className="px-4 py-3 text-rose-700 text-xs font-bold bg-rose-50/30">{mvt.issues.toLocaleString()}</td>
                          <td className="px-4 py-3 text-indigo-700 text-xs font-bold bg-indigo-50/30">{mvt.returns.toLocaleString()}</td>
                          <td className={`px-4 py-3 text-xs font-black border-r-2 border-black ${balance < 0 ? "text-red-600 bg-red-50" : "text-slate-900 bg-amber-50/50"}`}>
                            {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-black text-[10px] font-black uppercase">{material.uom || ""}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <ClientPagination page={page} pageSize={pageSize} totalItems={totalItems} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        </div>
      )}

      {showGroupModal ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-xl border-2 border-black p-6 shadow-2xl">
            <h3 className="text-lg font-black text-black uppercase mb-4">Create Material Group</h3>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div className="space-y-2">
                <label className="font-bold text-black">Group Name *</label>
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} autoFocus className="w-full border-2 border-black rounded p-3 text-black focus:outline-none focus:ring-1 focus:ring-indigo-600" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setShowGroupModal(false); setNewGroupName(""); }} className="px-5 py-2 border-2 border-black rounded font-bold text-black">Cancel</button>
                <button type="submit" disabled={savingGroup} className="px-5 py-2 bg-indigo-600 text-white rounded font-bold border border-black disabled:opacity-50">
                  {savingGroup ? <Spinner size={16} className="text-white" /> : "Save Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showUnitModal ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-xl border-2 border-black p-6 shadow-2xl">
            <h3 className="text-lg font-black text-black uppercase mb-4">Create Unit</h3>
            <form onSubmit={handleCreateUnit} className="space-y-4">
              <div className="space-y-2">
                <label className="font-bold text-black">Unit Name *</label>
                <input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} autoFocus className="w-full border-2 border-black rounded p-3 text-black focus:outline-none focus:ring-1 focus:ring-indigo-600" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setShowUnitModal(false); setNewUnitName(""); }} className="px-5 py-2 border-2 border-black rounded font-bold text-black">Cancel</button>
                <button type="submit" disabled={savingUnit} className="px-5 py-2 bg-indigo-600 text-white rounded font-bold border border-black disabled:opacity-50">
                  {savingUnit ? <Spinner size={16} className="text-white" /> : "Save Unit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-1 min-w-[120px]" : "space-y-1"}>
      <div className="text-blue-700 font-bold text-sm">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={compact ? "w-full rounded border-2 border-black px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" : "min-w-[160px] rounded-2xl border border-slate-300 px-5 py-4 text-lg text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
