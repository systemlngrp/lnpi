import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Edit, Plus, Download, ArrowLeft, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { Material, MaterialGroup } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";

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
    active: "Yes" as ActiveValue,
  };
}

export function Materials() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useData<Material>("materials", []);
  const [materialGroups, setMaterialGroups] = useData<MaterialGroup>("material-groups", []);

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

  const handleExport = () => {
    const exportRows = filteredMaterials.map((material, index) => ({
      SL: index + 1,
      Type: material.type,
      "ERP Code": material.erpCode || "",
      "Item Name": material.name,
      Size: material.size ?? "",
      GSM: material.gsm ?? "",
      BF: material.bf ?? "",
      Unit: material.uom || "",
      Active: material.active || "Yes",
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Item Master");
    XLSX.writeFile(workbook, "Material_Master.xlsx");
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
        <div className="bg-white border border-black rounded-[28px] p-6 md:p-10 shadow-sm">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-3xl font-black tracking-tight text-black">New Item</h2>
            <button
              type="button"
              onClick={() => resetForm()}
              className="px-6 py-3 rounded-2xl border border-slate-300 text-indigo-700 font-bold text-2sm hover:bg-slate-50 transition"
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
                      };
                    });
                  }}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full rounded-2xl border border-slate-300 bg-slate-100 px-5 py-4 text-xl text-slate-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-blue-700 font-bold">ERP Code</label>
                  <input
                    value={formData.erpCode}
                    onChange={(e) => setFormData((prev) => ({ ...prev, erpCode: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {formData.type === "Reel" ? (
                <div className="space-y-2">
                  <label className="text-blue-700 font-bold">Item Group</label>
                  <input
                    value="Reel"
                    readOnly
                    className="w-full rounded-2xl border border-slate-300 bg-slate-100 px-5 py-4 text-xl text-slate-500 focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">Unit</label>
                    <select
                      value={formData.uom}
                      onChange={(e) => setFormData((prev) => ({ ...prev, uom: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      GSM <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.gsm}
                      onChange={(e) => setFormData((prev) => ({ ...prev, gsm: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-blue-700 font-bold">
                      BF <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={formData.bf}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bf: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-blue-700 font-bold">Active</label>
              <select
                value={formData.active}
                onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.value as ActiveValue }))}
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ACTIVE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-[24px] border border-slate-200 min-h-[90px] p-5 flex items-center justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-indigo-700 hover:bg-indigo-800 text-white font-black px-9 py-4 rounded-2xl transition disabled:opacity-50"
              >
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save Item"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-black">Item Master</h2>
              <p className="text-slate-500 text-2sm mt-1">LNKI</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search ERP / name"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[300px] max-w-full rounded-full border border-slate-300 px-6 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={["All", ...TYPE_OPTIONS.map((option) => option.value)]} />
              <FilterSelect label="Size" value={sizeFilter} onChange={setSizeFilter} options={["All", ...sizeOptions]} />
              <FilterSelect label="GSM" value={gsmFilter} onChange={setGsmFilter} options={["All", ...gsmOptions]} />
              <button
                type="button"
                onClick={clearFilters}
                className="px-6 py-4 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 px-6 py-4 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                <Download size={18} /> Download Excel
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-6 py-4 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleOpenNew}
                className="inline-flex items-center gap-2 px-6 py-4 rounded-2xl bg-indigo-700 text-white font-black hover:bg-indigo-800 transition"
              >
                <Plus size={18} /> New Item
              </button>
            </div>
          </div>

          <div className="bg-white rounded-[22px] border border-slate-300 overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 text-slate-600 text-2sm">
              <span>Items: {filteredMaterials.length}</span>
              <span>Saved.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-indigo-700 text-white">
                    {["SL", "Type", "ERP Code", "Item Name", "Size", "GSM", "BF", "Unit", "Active", "Action"].map((heading) => (
                      <th key={heading} className="px-4 py-4 text-left text-sm font-bold border-2 border-black whitespace-nowrap">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
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
          <div className="bg-white w-full max-w-md rounded-2xl border-2 border-black p-6 shadow-2xl">
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
                <button type="submit" disabled={savingGroup} className="px-5 py-2 bg-indigo-700 text-white rounded font-bold border border-black disabled:opacity-50">
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-blue-700 font-bold text-sm">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[160px] rounded-2xl border border-slate-300 px-5 py-4 text-lg text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
