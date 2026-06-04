import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Edit, Plus, Trash2, Search, Upload, Download } from "lucide-react";
import { useData } from "../hooks/useData";
import { Material, MaterialGroup, MaterialIn, MaterialInPackingSlip, Supplier } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import * as XLSX from "xlsx";

type MaterialType = Material["type"];
type ActiveValue = NonNullable<Material["active"]>;

const UNIT_OPTIONS = [{ value: "CM", label: "CM" }];
const TYPE_OPTIONS = [
  { value: "Reel", label: "Reel" },
  { value: "Other", label: "Other" },
];
const ACTIVE_OPTIONS: ActiveValue[] = ["Yes", "No"];

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
  return String(numericSize / 10);
}

function getReelDisplayName(erpCode: string | number, size: number, uom: string, gsm: number, bf: number) {
  return `${erpCode} - Size: ${size} ${uom} X GSM: ${gsm} X BF: ${bf}`;
}

function getNextNumericErpCode(materials: Material[]) {
  const numericValues = materials
    .map((material) => Number(material.erpCode))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (numericValues.length === 0) return "1";
  return String(Math.max(...numericValues) + 1);
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
    active: "Yes" as ActiveValue,
  };
}

export function Materials() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useData<Material>("materials", []);
  const [materialGroups, setMaterialGroups] = useData<MaterialGroup>("material-groups", []);
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips, setPackingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
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
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [formData, setFormData] = useState(() => createInitialFormState(materials, reelGroup?.id || ""));

  const resetForm = (nextMaterials = materials, nextReelGroupId = reelGroup?.id || "") => {
    setFormData(createInitialFormState(nextMaterials, nextReelGroupId));
    setEditingId(null);
    setIsFormOpen(false);
    setShowGroupModal(false);
    setNewGroupName("");
  };

  const syncReelDefaults = (nextType: MaterialType, current = formData) => {
    if (nextType !== "Reel") return current;
    return {
      ...current,
      type: "Reel" as MaterialType,
      uom: "CM",
      materialGroupId: reelGroup?.id || current.materialGroupId,
      erpCode: editingId ? current.erpCode : current.erpCode || getNextNumericErpCode(materials),
    };
  };

  const handleOpenNew = () => {
    setEditingId(null);
    setFormData(createInitialFormState(materials, reelGroup?.id || ""));
    setIsFormOpen(true);
  };

  const handleEdit = (material: Material) => {
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
      active: material.active === "No" ? "No" : "Yes",
    });
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    setMaterials(materials.filter((material) => material.id !== id));
  };

  const handleToggleActive = (material: Material) => {
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
  };

  const handleCreateGroup = async (event: React.FormEvent) => {
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
    const nextGroup: MaterialGroup = {
      id: crypto.randomUUID(),
      name: normalizedName,
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };

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
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const normalizedType = formData.type;
    const erpCode = String(formData.erpCode || "").trim() || (normalizedType === "Reel" ? getNextNumericErpCode(materials) : "");
    const uom = "CM";
    const timestamp = new Date().toISOString();

    const size = parseNumericInput(formData.size);
    const gsm = parseNumericInput(formData.gsm);
    const bf = parseNumericInput(formData.bf);
    const openingQty = parseNumericInput(formData.openingQty);
    const openingRate = parseNumericInput(formData.openingRate);
    const openingValueInput = parseNumericInput(formData.openingValue);
    const openingValue =
      openingValueInput !== ""
        ? Number(openingValueInput)
        : openingQty !== "" && openingRate !== ""
          ? Number(openingQty) * Number(openingRate)
          : undefined;

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
        const nextReelGroup: MaterialGroup = {
          id: crypto.randomUUID(),
          name: "Reel",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
        await setMaterialGroups([...materialGroups, nextReelGroup]);
        reelGroupId = nextReelGroup.id;
      }

      const nextMaterial: Material = {
        id: editingId || crypto.randomUUID(),
        type: normalizedType,
        erpCode: erpCode || undefined,
        name:
          normalizedType === "Reel"
            ? getReelDisplayName(erpCode, Number(size), uom, Number(gsm), Number(bf))
            : formData.name.trim(),
        uom,
        materialGroupId: normalizedType === "Reel" ? reelGroupId || undefined : formData.materialGroupId || undefined,
        size: normalizedType === "Reel" ? Number(size) : undefined,
        gsm: normalizedType === "Reel" ? Number(gsm) : undefined,
        bf: normalizedType === "Reel" ? Number(bf) : undefined,
        openingQty: openingQty === "" ? undefined : Number(openingQty),
        openingRate: openingRate === "" ? undefined : Number(openingRate),
        openingValue,
        active: formData.active,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const nextMaterials = editingId
        ? materials.map((material) => (material.id === editingId ? nextMaterial : material))
        : [nextMaterial, ...materials];

      await setMaterials(nextMaterials);
      resetForm(nextMaterials, reelGroupId);
    } catch (error) {
      console.error("Failed to save material:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

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
        const matchesSearch =
          !searchTerm ||
          normalizeText(material.erpCode).includes(searchTerm.toLowerCase()) ||
          normalizeText(material.name).includes(searchTerm.toLowerCase());
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

  const handleExport = () => {};

  const downloadTemplate = () => {
    const templateData = [
      {
        "Type": "Reel",
        "ERP Code": "1001",
        "Item Name": "",
        "Item Group": "Reel",
        "MRR No.": "MI/26-27/00001",
        "MRR Date": "2026-06-02",
        "Supplier Name": "Bizskill",
        "Our Reel No.": "R00001",
        "Reel Qty": 250.5,
        "Unit": "CM",
        "Size": 120,
        "GSM": 150,
        "BF": 18,
        "Opening Qty": 0,
        "Opening Rate": 0,
        "Opening Value": 0,
        "Active": "Yes",
      },
      {
        "Type": "Other",
        "ERP Code": "2001",
        "Item Name": "Service",
        "Item Group": "Consumable",
        "MRR No.": "",
        "MRR Date": "",
        "Supplier Name": "",
        "Our Reel No.": "",
        "Reel Qty": "",
        "Unit": "CM",
        "Size": "",
        "GSM": "",
        "BF": "",
        "Opening Qty": 0,
        "Opening Rate": 0,
        "Opening Value": 0,
        "Active": "Yes",
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Materials");
    XLSX.writeFile(wb, "Material_Master_Bulk_Template.xlsx");
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

        setIsUploading(true);
        const timestamp = new Date().toISOString();
        const nextGroups = [...materialGroups];
        let reelGroupId = reelGroup?.id || "";
        let nextMaterialIn = [...materialIn];
        let nextPackingSlips = [...packingSlips];

        if (!reelGroupId) {
          const nextReelGroup: MaterialGroup = {
            id: crypto.randomUUID(),
            name: "Reel",
            updatedBy: "System User",
            updateTimestamp: timestamp,
          };
          nextGroups.push(nextReelGroup);
          reelGroupId = nextReelGroup.id;
        }

        const groupMap = new Map(nextGroups.map((group) => [normalizeText(group.name), group]));
        const supplierMap = new Map(suppliers.map((supplier) => [normalizeText(supplier.name), supplier]));
        let nextMaterials = [...materials];
        const reelOpeningQtyByErp = new Map<string, number>();
        const reelOpeningBalanceByErp = new Map<string, number>();
        const reelReceiptRows: Array<{
          materialId: string;
          ourReelNo: string;
          reelQty: number;
          mrrNo: string;
          mrrDate: string;
          supplierId: string;
        }> = [];

        data.forEach((row: any) => {
          const rawType = String(row["Type"] || "").trim();
          if (rawType !== "Reel") return;
          const erpCode = String(row["ERP Code"] || "").trim();
          const reelQtyValue = parseNumericInput(String(row["Reel Qty"] ?? ""));
          const openingQtyValue = parseNumericInput(String(row["Opening Qty"] ?? ""));
          if (!erpCode || reelQtyValue === "") return;
          reelOpeningQtyByErp.set(
            erpCode,
            Number((reelOpeningQtyByErp.get(erpCode) || 0) + Number(reelQtyValue || 0))
          );
          if (openingQtyValue !== "") {
            const numericOpeningQty = Number(openingQtyValue || 0);
            if (reelOpeningBalanceByErp.has(erpCode) && reelOpeningBalanceByErp.get(erpCode) !== numericOpeningQty) {
              throw new Error(`Reel rows for ERP ${erpCode} must use the same Opening Qty balance.`);
            }
            reelOpeningBalanceByErp.set(erpCode, numericOpeningQty);
          }
        });

        data.forEach((row: any, index) => {
          const rawType = String(row["Type"] || "").trim();
          const type = rawType === "Reel" ? "Reel" : rawType === "Other" ? "Other" : "";
          if (!type) throw new Error(`Row ${index + 2}: Type must be Reel or Other.`);

          const erpCode = String(row["ERP Code"] || "").trim() || (type === "Reel" ? getNextNumericErpCode(nextMaterials) : "");
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
          const activeValue = String(row["Active"] || "Yes").trim() === "No" ? "No" : "Yes";

          if (type === "Reel" && (sizeValue === "" || gsmValue === "" || bfValue === "")) {
            throw new Error(`Row ${index + 2}: Reel rows require Size, GSM, and BF.`);
          }
          if (type === "Reel") {
            if (!mrrNo || !mrrDate || !supplierName || !ourReelNo || reelQtyValue === "") {
              throw new Error(`Row ${index + 2}: Reel rows require MRR No., MRR Date, Supplier Name, Our Reel No., and Reel Qty.`);
            }
          }
          if (type === "Other" && !itemName) {
            throw new Error(`Row ${index + 2}: Other rows require Item Name.`);
          }

          let materialGroupId: string | undefined = undefined;
          if (type === "Reel") {
            materialGroupId = reelGroupId;
          } else {
            if (!groupName) throw new Error(`Row ${index + 2}: Other rows require Item Group.`);
            const normalizedGroupName = normalizeText(groupName);
            let matchedGroup = groupMap.get(normalizedGroupName);
            if (!matchedGroup) {
              matchedGroup = {
                id: crypto.randomUUID(),
                name: groupName,
                updatedBy: "System User",
                updateTimestamp: timestamp,
              };
              nextGroups.push(matchedGroup);
              groupMap.set(normalizedGroupName, matchedGroup);
            }
            materialGroupId = matchedGroup.id;
          }

          const openingValue =
            openingValueInput !== ""
              ? Number(openingValueInput)
              : openingQtyValue !== "" && openingRateValue !== ""
                ? Number(openingQtyValue) * Number(openingRateValue)
                : undefined;

          const generatedName =
            type === "Reel"
              ? getReelDisplayName(erpCode, Number(sizeValue), unit, Number(gsmValue), Number(bfValue))
              : itemName;

          const existing = nextMaterials.find((material) =>
            type === "Reel"
              ? normalizeText(material.erpCode) === normalizeText(erpCode)
              : normalizeText(material.name) === normalizeText(generatedName)
          );

          const nextMaterial: Material = {
            id: existing?.id || crypto.randomUUID(),
            type,
            erpCode: erpCode || undefined,
            name: generatedName,
            uom: unit,
            materialGroupId,
            size: type === "Reel" && sizeValue !== "" ? Number(sizeValue) : undefined,
            gsm: type === "Reel" && gsmValue !== "" ? Number(gsmValue) : undefined,
            bf: type === "Reel" && bfValue !== "" ? Number(bfValue) : undefined,
            openingQty:
              type === "Reel"
                ? Number((reelOpeningQtyByErp.get(erpCode) || 0) + (reelOpeningBalanceByErp.get(erpCode) || 0)) || undefined
                : openingQtyValue === "" ? undefined : Number(openingQtyValue),
            openingRate: openingRateValue === "" ? undefined : Number(openingRateValue),
            openingValue:
              type === "Reel"
                ? (
                    openingValueInput !== ""
                      ? Number(openingValueInput)
                      : Number(
                          (Number(reelOpeningQtyByErp.get(erpCode) || 0) + (reelOpeningBalanceByErp.get(erpCode) || 0)) *
                            Number(openingRateValue || 0)
                        )
                  ) || undefined
                : openingValue,
            active: activeValue,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          };

          if (existing) {
            nextMaterials = nextMaterials.map((material) => (material.id === existing.id ? nextMaterial : material));
          } else {
            nextMaterials = [nextMaterial, ...nextMaterials];
          }

          if (type === "Reel") {
            const matchedSupplier = supplierMap.get(normalizeText(supplierName));
            if (!matchedSupplier) {
              throw new Error(`Row ${index + 2}: Supplier Name not found.`);
            }
            if (Number(reelQtyValue) <= 0) {
              throw new Error(`Row ${index + 2}: Reel Qty must be greater than 0.`);
            }
            reelReceiptRows.push({
              materialId: nextMaterial.id,
              ourReelNo,
              reelQty: Number(reelQtyValue),
              mrrNo,
              mrrDate,
              supplierId: matchedSupplier.id,
            });
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
          const existingReceipt = nextMaterialIn.find(
            (entry) => entry.transactionNo === sample.mrrNo && entry.supplierId === sample.supplierId
          );

          const packingSlipsForReceipt = nextPackingSlips.filter((slip) => slip.materialInId === existingReceipt?.id);
          const existingLineByMaterial = new Map((existingReceipt?.lines || []).map((line) => [line.itemId, line]));
          const existingSlipByReelNo = new Map(packingSlipsForReceipt.map((slip) => [normalizeText(slip.ourReelNo), slip]));
          const mergedSlipMap = new Map(
            packingSlipsForReceipt.map((slip) => [
              normalizeText(slip.ourReelNo),
              {
                materialId: slip.materialId,
                ourReelNo: slip.ourReelNo,
                weightKg: Number(slip.weightKg || 0),
                existingSlip: slip,
              },
            ])
          );

          rowsForReceipt.forEach((row) => {
            mergedSlipMap.set(normalizeText(row.ourReelNo), {
              materialId: row.materialId,
              ourReelNo: row.ourReelNo,
              weightKg: Number(row.reelQty || 0),
              existingSlip: existingSlipByReelNo.get(normalizeText(row.ourReelNo)),
            });
          });

          const aggregatedWeightByMaterial = new Map<string, number>();
          Array.from(mergedSlipMap.values()).forEach((slip) => {
            aggregatedWeightByMaterial.set(
              slip.materialId,
              Number((aggregatedWeightByMaterial.get(slip.materialId) || 0) + Number(slip.weightKg || 0))
            );
          });

          const nextLines = Array.from(aggregatedWeightByMaterial.entries()).map(([materialId, totalQty]) => {
            const existingLine = existingLineByMaterial.get(materialId);
            return {
              id: existingLine?.id || crypto.randomUUID(),
              itemId: materialId,
              qty: totalQty,
              uom: "KG",
              invoiceQty: totalQty,
              invoiceRate: Number(existingLine?.invoiceRate ?? existingLine?.rate ?? 0),
              invoiceValue: 0,
              actualQty: totalQty,
              actualValue: 0,
              rate: Number(existingLine?.rate || 0),
              value: 0,
            };
          });

          const nextReceiptId = existingReceipt?.id || crypto.randomUUID();
          const nextReceipt: MaterialIn = {
            id: nextReceiptId,
            transactionNo: sample.mrrNo,
            mrrType: "Reel",
            timestamp: existingReceipt?.timestamp || timestamp,
            entryEmailId: existingReceipt?.entryEmailId || "system@lngrp.in",
            date: sample.mrrDate,
            invoiceNo: existingReceipt?.invoiceNo || sample.mrrNo,
            invDate: sample.mrrDate,
            supplierId: sample.supplierId,
            totalAmount: 0,
            totalInvoiceValue: 0,
            totalActualValue: 0,
            lines: nextLines,
            status: existingReceipt?.status || "Completed",
            updatedBy: "System User",
            updateTimestamp: timestamp,
          };

          if (existingReceipt) {
            nextMaterialIn = nextMaterialIn.map((entry) => (entry.id === existingReceipt.id ? nextReceipt : entry));
          } else {
            nextMaterialIn = [...nextMaterialIn, nextReceipt];
          }

          Array.from(mergedSlipMap.values()).forEach((row) => {
            const matchingLine = nextLines.find((line) => line.itemId === row.materialId);
            const existingSlip = row.existingSlip;
            const nextSlip: MaterialInPackingSlip = {
              id: existingSlip?.id || crypto.randomUUID(),
              materialInId: nextReceiptId,
              materialLineId: matchingLine?.id || crypto.randomUUID(),
              materialId: row.materialId,
              ourReelNo: row.ourReelNo,
              weightKg: Number(row.weightKg),
              updatedBy: "System User",
              updateTimestamp: timestamp,
            };

            if (existingSlip) {
              nextPackingSlips = nextPackingSlips.map((slip) => (slip.id === existingSlip.id ? nextSlip : slip));
            } else {
              nextPackingSlips = [...nextPackingSlips, nextSlip];
            }
          });
        });

        await setMaterialGroups(nextGroups);
        await setMaterials(nextMaterials);
        await setMaterialIn(nextMaterialIn);
        await setPackingSlips(nextPackingSlips);
        alert(`Successfully uploaded ${data.length} material rows.`);
      } catch (error) {
        console.error("Material bulk upload error:", error);
        alert(error instanceof Error ? error.message : "Failed to parse the Excel file.");
      } finally {
        setIsUploading(false);
        e.target.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setTypeFilter("All");
    setSizeFilter("All");
    setGsmFilter("All");
  };

  const groupOptions = materialGroups
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({ value: group.id, label: group.name }));

  return (
    <div className="space-y-6">
      {isFormOpen ? (
        <div className="bg-white border border-black rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">New Item</h2>
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
                        uom: "CM",
                        materialGroupId: "",
                        size: "",
                        gsm: "",
                        bf: "",
                        openingQty: prev.openingQty,
                        openingRate: prev.openingRate,
                        openingValue: prev.openingValue,
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
                    <select
                      value={formData.uom}
                      onChange={(e) => setFormData((prev) => ({ ...prev, uom: e.target.value }))}
                      className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
          <div className="rounded-xl border border-black bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black text-black tracking-tight">Material Master</h2>
                  <p className="text-sm font-medium text-slate-600">
                    Showing {filteredMaterials.length} {filteredMaterials.length === 1 ? "material" : "materials"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="inline-flex items-center justify-center gap-2 rounded border border-black bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-slate-50 whitespace-nowrap shadow"
                  >
                    <Download size={16} /> Template
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded border border-black bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-slate-50 whitespace-nowrap shadow">
                    {isUploading ? <Spinner size={16} /> : <Upload size={16} />}
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
                    className="inline-flex items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 whitespace-nowrap border border-black shadow"
                  >
                    <Plus size={16} /> New Item
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(260px,1.6fr)_repeat(3,minmax(120px,0.8fr))]">
                  <div className="space-y-1">
                    <div className="text-blue-700 font-bold text-sm">Search</div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        type="text"
                        placeholder="Search ERP / name"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                  <FilterSelect compact label="Type" value={typeFilter} onChange={setTypeFilter} options={["All", ...TYPE_OPTIONS.map((option) => option.value)]} />
                  <FilterSelect compact label="Size" value={sizeFilter} onChange={setSizeFilter} options={["All", ...sizeOptions]} />
                  <FilterSelect compact label="GSM" value={gsmFilter} onChange={setGsmFilter} options={["All", ...gsmOptions]} />
                </div>

                <div className="flex flex-wrap items-end gap-2 xl:justify-end">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded border border-black px-4 py-2.5 text-sm font-bold text-black transition hover:bg-slate-50 whitespace-nowrap"
                  >
                    Clear
                  </button>
                  {/* Downloads removed (only shown in Delivery Book) */}
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="rounded border border-black px-4 py-2.5 text-sm font-bold text-black transition hover:bg-slate-50 whitespace-nowrap"
                  >
                    Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded shadow-sm border border-black overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 text-slate-600 text-sm border-b border-black">
              <span>Items: {filteredMaterials.length}</span>
              <span>Saved.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-indigo-700 text-white">
                    {["SL", "Type", "ERP Code", "Item Name", "Size", "GSM", "BF", "Opening Qty", "Opening Rate", "Opening Value", "RAPC", "Unit", "Active", "Action"].map((heading) => (
                      <th key={heading} className="px-4 py-4 text-left text-sm font-bold border-2 border-black whitespace-nowrap">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                        No materials found.
                      </td>
                    </tr>
                  ) : (
                    filteredMaterials.map((material, index) => (
                      <tr key={material.id} className="hover:bg-slate-50">
                        <td className="px-4 py-4 text-black font-bold border-2 border-black">{index + 1}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.type}</td>
                        <td className="px-4 py-4 text-black text-sm font-black border-2 border-black">{material.erpCode || ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black min-w-[420px]">{material.name}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.size ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.gsm ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.bf ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.openingQty ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.openingRate ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.openingValue ?? ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.type === "Reel" ? getMaterialRapcFromSize(material.size) : ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.uom || ""}</td>
                        <td className="px-4 py-4 text-black text-sm border-2 border-black">{material.active || "Yes"}</td>
                        <td className="px-4 py-4 border-2 border-black">
                          <div className="flex justify-end gap-2">
                            <ActionButton label="Edit" tone="edit" onClick={() => handleEdit(material)} icon={<Edit size={15} />} />
                            <ActionButton
                              label={material.active === "No" ? "Activate" : "Deactivate"}
                              tone={material.active === "No" ? "activate" : "deactivate"}
                              onClick={() => handleToggleActive(material)}
                            />
                            <ActionButton label="Delete" tone="delete" onClick={() => handleDelete(material.id)} icon={<Trash2 size={15} />} />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  autoFocus
                    className="w-full border-2 border-black rounded p-3 text-black focus:outline-none focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowGroupModal(false);
                    setNewGroupName("");
                  }}
                  className="px-5 py-2 border-2 border-black rounded font-bold text-black"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingGroup} className="px-5 py-2 bg-indigo-600 text-white rounded font-bold border border-black disabled:opacity-50">
                  {savingGroup ? <Spinner size={16} className="text-white" /> : "Save Group"}
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

function ActionButton({
  label,
  tone,
  onClick,
  icon,
}: {
  label: string;
  tone: "edit" | "deactivate" | "activate" | "delete";
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  const toneClasses =
    tone === "edit"
      ? "bg-white text-indigo-700 border-slate-300 hover:bg-slate-50"
      : tone === "activate"
        ? "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
        : tone === "deactivate"
          ? "bg-red-600 text-white border-red-700 hover:bg-red-700"
          : "bg-slate-900 text-white border-slate-900 hover:bg-black";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-4 py-2 rounded-xl border font-bold text-sm transition whitespace-nowrap ${toneClasses}`}
    >
      {icon}
      {label}
    </button>
  );
}
