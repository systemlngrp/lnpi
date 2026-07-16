import React, { useMemo, useState, useRef } from "react";
import { Supplier, StateMaster } from "../types";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { Select } from "../components/Select";
import { Edit, Trash2, Upload, Download } from "lucide-react";
import { MandatoryLegend, MandatoryLabel } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";
import * as XLSX from "xlsx";
import { useClientPagination } from "../hooks/useClientPagination";

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
  const [suppliers, setSuppliers, suppliersLoading] = useData<Supplier>("suppliers", []);
  const [states] = useData<StateMaster>("states", []);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })),
    [searchTerm, suppliers]
  );
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedSuppliers,
  } = useClientPagination(filteredSuppliers, 25);

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

  const handleDelete = async (id: string) => {
    try {
      await setSuppliers(suppliers.filter((supplier) => supplier.id !== id));
    } catch (err) {
      console.error("Failed to delete supplier:", err);
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        "Supplier Name": "Example Supplier Pvt Ltd",
        "Contact Person": "Jane Smith",
        "Contact Number": "9876543211",
        "Email": "jane@example.com",
        "GST No.": "27BBBBB0000B1Z5",
        "GST Supply Type": "INTRA_STATE",
        "State": "Maharashtra",
        "District": "Pune",
        "PIN Code": "411001",
        "Address": "456 Industrial Area",
        "Active": "Yes"
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Suppliers_Bulk_Upload_Template.xlsx");
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

        setIsSubmitting(true);
        const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
        
        const stateMap = new Map<string, string>();
        states.forEach(s => stateMap.set(s.name.toLowerCase(), s.id));

        const newSuppliers: Supplier[] = data.map((row: any) => {
          const stateName = String(row["State"] || "").trim().toLowerCase();
          return {
            id: crypto.randomUUID(),
            name: String(row["Supplier Name"] || "").trim(),
            contactPerson: String(row["Contact Person"] || "").trim() || undefined,
            contactNumber: String(row["Contact Number"] || "").trim() || undefined,
            email: String(row["Email"] || "").trim() || undefined,
            gstNo: String(row["GST No."] || "").trim() || undefined,
            gstSupplyType: (row["GST Supply Type"] === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE") as any,
            stateId: stateMap.get(stateName) || undefined,
            district: String(row["District"] || "").trim() || undefined,
            pinCode: String(row["PIN Code"] || "").trim() || undefined,
            address: String(row["Address"] || "").trim() || undefined,
            active: row["Active"] === "No" ? "No" : "Yes" as "Yes" | "No",
            ...audit,
          };
        }).filter(s => s.name);

        if (newSuppliers.length === 0) {
          alert("No valid suppliers found in the file. Ensure 'Supplier Name' column is filled.");
          setIsSubmitting(false);
          return;
        }

        const existingNames = new Set(suppliers.map(s => s.name.toLowerCase()));
        const uniqueNewSuppliers = newSuppliers.filter(s => !existingNames.has(s.name.toLowerCase()));
        
        const skippedCount = newSuppliers.length - uniqueNewSuppliers.length;

        if (uniqueNewSuppliers.length > 0) {
          await setSuppliers([...suppliers, ...uniqueNewSuppliers]);
          alert(`Successfully uploaded ${uniqueNewSuppliers.length} suppliers.${skippedCount > 0 ? ` Skipped ${skippedCount} duplicates.` : ""}`);
        } else {
          alert("All suppliers in the file already exist.");
        }
      } catch (error) {
        console.error("Bulk upload error:", error);
        alert("Failed to parse or upload the Excel file.");
      } finally {
        setIsSubmitting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  const exportToExcel = () => {
    const dataToExport = filteredSuppliers.map(s => ({
      "Supplier Name": s.name,
      "Contact Person": s.contactPerson || "",
      "Contact Number": s.contactNumber || "",
      "Email": s.email || "",
      "GST No.": s.gstNo || "",
      "GST Supply Type": s.gstSupplyType || "INTRA_STATE",
      "State": getStateName(s.stateId),
      "District": s.district || "",
      "PIN Code": s.pinCode || "",
      "Address": s.address || "",
      "Active": s.active || "Yes"
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, "Suppliers_Master_Export.xlsx");
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

      if (editingId) {
        await setSuppliers(suppliers.map((supplier) => (supplier.id === editingId ? nextSupplier : supplier)));
      } else {
        await setSuppliers([...suppliers, nextSupplier]);
      }
      resetForm();
    } catch (error) {
      console.error("Failed to save supplier:", error);
      alert("Failed to save supplier.");
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
            <h2 className="text-3xl font-black text-blue-700">{editingId ? "Edit Supplier" : "New Supplier"}</h2>
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
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-black pb-4 gap-4">
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">Suppliers Master</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={downloadTemplate}
                className="bg-white text-black border-2 border-black px-3 py-2 rounded font-bold hover:bg-slate-100 transition flex items-center text-sm"
                title="Download Excel Template"
              >
                <Download size={18} className="mr-2" /> Template
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white text-black border-2 border-black px-3 py-2 rounded font-bold hover:bg-slate-100 transition flex items-center text-sm"
                title="Upload Bulk Data"
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

              <button
                onClick={openCreate}
                className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center text-sm"
              >
                Add New Supplier
              </button>
            </div>
          </div>

<div className="bg-white p-4 border border-black rounded shadow-sm">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search suppliers..."
              className="w-full max-w-sm rounded-xl border-2 border-black px-4 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <DataSummaryTiles
            totalRecords={suppliers.length}
            filteredRecords={filteredSuppliers.length}
            showingRecords={paginatedSuppliers.length}
            pageLabel={`${page} / ${Math.max(1, Math.ceil(totalItems / pageSize))}`}
          />

          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-black">
            <div className="table-sticky-scroll">
            <table className="min-w-max divide-y divide-black border-collapse border border-black">
              <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  {["SL No", "Supplier Name", "Contact Person", "Contact Number", "Email", "GST No.", "GST Supply Type", "State", "District", "PIN Code", "Active", "Actions"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                      {suppliersLoading || isSubmitting ? <Spinner /> : "No suppliers found."}
                    </td>
                  </tr>
                ) : (
                  paginatedSuppliers.map((supplier, index) => (
                    <tr key={supplier.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                      <td className="px-4 py-3 text-sm font-bold text-black border border-black whitespace-nowrap">{(page - 1) * pageSize + index + 1}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.name}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.contactPerson || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.contactNumber || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.email || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.gstNo || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.gstSupplyType || "INTRA_STATE"}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{getStateName(supplier.stateId)}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.district || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.pinCode || ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{supplier.active || "Yes"}</td>
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
            <ClientPagination
              page={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
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
