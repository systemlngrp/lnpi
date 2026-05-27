import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Supplier, StateMaster } from "../types";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { Edit, Trash2 } from "lucide-react";
import { MandatoryLegend, MandatoryLabel } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";

type SupplierFormState = {
  name: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  gstNo: string;
  gstSupplyType: "" | "INTRA_STATE" | "INTER_STATE";
  stateId: string;
  district: string;
  pinCode: string;
  address: string;
  active: "Yes" | "No";
};

const createInitialFormState = (): SupplierFormState => ({
  name: "",
  contactPerson: "",
  contactNumber: "",
  email: "",
  gstNo: "",
  gstSupplyType: "INTRA_STATE",
  stateId: "",
  district: "",
  pinCode: "",
  address: "",
  active: "Yes",
});

export function Suppliers() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useData<Supplier>("suppliers", []);
  const [states] = useData<StateMaster>("states", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<SupplierFormState>(createInitialFormState);

  const stateOptions = useMemo(
    () =>
      [...states]
        .filter((state) => state.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((state) => ({ value: state.id, label: state.name })),
    [states]
  );

  const filteredSuppliers = useMemo(
    () =>
      [...suppliers]
        .filter((supplier) => {
          const haystack = [
            supplier.name,
            supplier.contactPerson,
            supplier.contactNumber,
            supplier.email,
            supplier.gstNo,
            supplier.district,
            supplier.pinCode,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchTerm.toLowerCase());
        })
        .sort((a, b) => {
          const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
          const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
          return timeB - timeA || a.name.localeCompare(b.name);
        }),
    [searchTerm, suppliers]
  );

  const resetForm = () => {
    setEditingId(null);
    setFormData(createInitialFormState());
    setIsFormOpen(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(createInitialFormState());
    setIsFormOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setFormData({
      name: supplier.name || "",
      contactPerson: supplier.contactPerson || "",
      contactNumber: supplier.contactNumber || "",
      email: supplier.email || "",
      gstNo: supplier.gstNo || "",
      gstSupplyType: (supplier.gstSupplyType as any) || "INTRA_STATE",
      stateId: supplier.stateId || "",
      district: supplier.district || "",
      pinCode: supplier.pinCode || "",
      address: supplier.address || "",
      active: supplier.active === "No" ? "No" : "Yes",
    });
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    setSuppliers(suppliers.filter((supplier) => supplier.id !== id));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.name.trim()) return;
    if (isMandatoryField("supplier_form", "gstSupplyType") && !formData.gstSupplyType) {
      alert("GST Supply Type is mandatory.");
      return;
    }

    const duplicate = suppliers.some(
      (supplier) => supplier.id !== editingId && supplier.name.toLowerCase() === formData.name.trim().toLowerCase()
    );
    if (duplicate) {
      alert("A supplier with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextSupplier: Supplier = {
        id: editingId || crypto.randomUUID(),
        name: formData.name.trim(),
        contactPerson: formData.contactPerson.trim() || undefined,
        contactNumber: formData.contactNumber.trim() || undefined,
        email: formData.email.trim() || undefined,
        gstNo: formData.gstNo.trim() || undefined,
        gstSupplyType: formData.gstSupplyType || undefined,
        stateId: formData.stateId || undefined,
        district: formData.district.trim() || undefined,
        pinCode: formData.pinCode.trim() || undefined,
        address: formData.address.trim() || undefined,
        active: formData.active,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      await setSuppliers(editingId ? suppliers.map((supplier) => (supplier.id === editingId ? nextSupplier : supplier)) : [nextSupplier, ...suppliers]);
      resetForm();
    } catch (error) {
      console.error("Failed to save supplier:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStateName = (stateId?: string) => states.find((state) => state.id === stateId)?.name || "";

  return (
    <div className="space-y-6">
      {isFormOpen ? (
        <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-200">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-3xl font-black text-blue-700">New Supplier</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="px-7 py-3 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                Back
              </button>
              <button
                type="submit"
                form="supplier-form"
                disabled={isSubmitting}
                className="px-7 py-3 rounded-2xl bg-indigo-700 text-white font-bold hover:bg-indigo-800 transition disabled:opacity-50"
              >
                {isSubmitting ? <Spinner size={18} className="text-white" /> : "Save Supplier"}
              </button>
            </div>
          </div>

          <form id="supplier-form" onSubmit={handleSubmit} className="space-y-6">
            <MandatoryLegend />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Supplier Name" required>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  required
                  autoFocus
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Contact Person">
                <input
                  value={formData.contactPerson}
                  onChange={(e) => setFormData((prev) => ({ ...prev, contactPerson: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Contact Number">
                <input
                  value={formData.contactNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, contactNumber: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="GST No.">
                <input
                  value={formData.gstNo}
                  onChange={(e) => setFormData((prev) => ({ ...prev, gstNo: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="GST Supply Type" required={isMandatoryField("supplier_form", "gstSupplyType")}>
                <select
                  value={formData.gstSupplyType}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, gstSupplyType: e.target.value as SupplierFormState["gstSupplyType"] }))
                  }
                  required={isMandatoryField("supplier_form", "gstSupplyType")}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="" disabled>
                    Select GST Supply Type...
                  </option>
                  <option value="INTRA_STATE">INTRA_STATE (CGST+SGST)</option>
                  <option value="INTER_STATE">INTER_STATE (IGST)</option>
                </select>
              </Field>
              <Field label="State">
                <Select
                  value={formData.stateId}
                  onChange={(value) => setFormData((prev) => ({ ...prev, stateId: value }))}
                  options={stateOptions}
                  placeholder="Select state"
                />
              </Field>
              <Field label="District">
                <input
                  value={formData.district}
                  onChange={(e) => setFormData((prev) => ({ ...prev, district: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="PIN Code">
                <input
                  value={formData.pinCode}
                  onChange={(e) => setFormData((prev) => ({ ...prev, pinCode: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Address" className="md:col-span-2">
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </Field>
              <Field label="Active">
                <select
                  value={formData.active}
                  onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.value === "No" ? "No" : "Yes" }))}
                  className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-between items-center border-b border-black pb-4">
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">Suppliers Master</h2>
            <button
              onClick={openCreate}
              className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center"
            >
              Add New Supplier
            </button>
          </div>

          <div className="bg-white p-4 border border-black rounded shadow-sm">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search suppliers..."
              className="w-full max-w-sm rounded-xl border-2 border-black px-4 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-black">
            <table className="min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  {["Supplier Name", "Contact Person", "Contact Number", "Email", "GST No.", "GST Supply Type", "State", "District", "PIN Code", "Active", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                      No suppliers found.
                    </td>
                  </tr>
                ) : (
                  filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.name}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.contactPerson || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.contactNumber || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.email || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.gstNo || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.gstSupplyType || "INTRA_STATE"}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{getStateName(supplier.stateId)}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.district || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.pinCode || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{supplier.active || "Yes"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium border border-black">
                        <button onClick={() => openEdit(supplier)} className="text-indigo-600 hover:text-indigo-900 mr-4">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => handleDelete(supplier.id)} className="text-red-600 hover:text-red-900 inline-flex items-center justify-end">
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
      )}
    </div>
  );
}

function Field({
  label,
  children,
  required = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <MandatoryLabel label={label} required={required} className="text-blue-700 font-bold" />
      {children}
    </div>
  );
}
