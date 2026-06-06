import React, { useState, useRef } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2, Upload, Download, FileSpreadsheet } from "lucide-react";
import { Company } from "../types";
import { Spinner } from "../components/Spinner";
import { MandatoryLabel, MandatoryLegend } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";
import * as XLSX from "xlsx";

export function Companies() {
  const [companies, setCompanies, isLoading] = useData<Company>("companies", []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [stateField, setStateField] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [gstSupplyType, setGstSupplyType] = useState<"" | "INTRA_STATE" | "INTER_STATE">("INTRA_STATE");
  const [deviationAllowed, setDeviationAllowed] = useState<number | "">("");
  const [toleranceAllowed, setToleranceAllowed] = useState<number | "">("");

  const resetForm = () => {
    setName("");
    setContactPerson("");
    setContactNumber("");
    setEmail("");
    setAddress("");
    setDistrict("");
    setStateField("");
    setGstNo("");
    setGstSupplyType("INTRA_STATE");
    setDeviationAllowed("");
    setToleranceAllowed("");
    setEditingId(null);
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        "Company Name": "Example Company Ltd",
        "Contact Person": "John Doe",
        "Contact Number": "9876543210",
        "Email Id": "john@example.com",
        "Address": "123 Business Park",
        "District": "Mumbai",
        "State": "Maharashtra",
        "GST NO": "27AAAAA0000A1Z5",
        "GST Supply Type": "INTRA_STATE",
        "Deviation Allowed (%)": 5,
        "Tolerance Allowed (%)": 2
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Companies_Bulk_Upload_Template.xlsx");
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
        const newCompanies: Company[] = data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: String(row["Company Name"] || "").trim(),
          contactPerson: String(row["Contact Person"] || "").trim() || undefined,
          contactNumber: String(row["Contact Number"] || "").trim() || undefined,
          email: String(row["Email Id"] || "").trim() || undefined,
          address: String(row["Address"] || "").trim() || undefined,
          district: String(row["District"] || "").trim() || undefined,
          state: String(row["State"] || "").trim() || undefined,
          gstNo: String(row["GST NO"] || "").trim() || undefined,
          gstSupplyType: (row["GST Supply Type"] === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE") as any,
          deviationAllowed: row["Deviation Allowed (%)"] ? Number(row["Deviation Allowed (%)"]) : undefined,
          toleranceAllowed: row["Tolerance Allowed (%)"] ? Math.max(0, Math.min(10, Number(row["Tolerance Allowed (%)"]))) : undefined,
          ...audit,
        })).filter(c => c.name);

        if (newCompanies.length === 0) {
          alert("No valid companies found in the file. Ensure 'Company Name' column is filled.");
          setIsSubmitting(false);
          return;
        }

        const existingNames = new Set(companies.map(c => c.name.toLowerCase()));
        const uniqueNewCompanies = newCompanies.filter(c => !existingNames.has(c.name.toLowerCase()));
        
        const skippedCount = newCompanies.length - uniqueNewCompanies.length;

        if (uniqueNewCompanies.length > 0) {
          await setCompanies([...companies, ...uniqueNewCompanies]);
          alert(`Successfully uploaded ${uniqueNewCompanies.length} companies.${skippedCount > 0 ? ` Skipped ${skippedCount} duplicates.` : ""}`);
        } else {
          alert("All companies in the file already exist.");
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
    const dataToExport = sortedCompanies.map(c => ({
      "Company Name": c.name,
      "Contact Person": c.contactPerson || "",
      "Contact Number": c.contactNumber || "",
      "Email Id": c.email || "",
      "Address": c.address || "",
      "District": c.district || "",
      "State": c.state || "",
      "GST NO": c.gstNo || "",
      "GST Supply Type": c.gstSupplyType || "INTRA_STATE",
      "Deviation Allowed (%)": c.deviationAllowed ?? "",
      "Tolerance Allowed (%)": c.toleranceAllowed ?? ""
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Companies");
    XLSX.writeFile(wb, "Companies_Master_Export.xlsx");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isMandatoryField("company_form", "gstSupplyType") && !gstSupplyType) {
      alert("GST Supply Type is mandatory.");
      return;
    }

    const isDuplicate = companies.some(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.id !== editingId
    );
    if (isDuplicate) {
      alert("A company with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as Partial<Company>;
      const payload: Company = {
        id: editingId || crypto.randomUUID(),
        name: name.trim(),
        contactPerson: contactPerson.trim() || undefined,
        contactNumber: contactNumber.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        district: district.trim() || undefined,
        state: stateField.trim() || undefined,
        gstNo: gstNo.trim() || undefined,
        gstSupplyType: gstSupplyType || undefined,
        deviationAllowed: deviationAllowed === "" ? undefined : Number(deviationAllowed),
        toleranceAllowed: toleranceAllowed === "" ? undefined : Number(toleranceAllowed),
        ...audit,
      };

      if (editingId) {
        await setCompanies(companies.map((c) => (c.id === editingId ? { ...c, ...payload } : c)));
      } else {
        await setCompanies([...companies, payload]);
      }

      resetForm();
      setIsFormOpen(false);
    } catch (err) {
      console.error("Failed to save company:", err);
      alert("Failed to save company. Please check the console for details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    try {
      await setCompanies(companies.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Failed to delete company:", err);
      alert("Failed to delete company.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (company: Company) => {
    setName(company.name || "");
    setContactPerson(company.contactPerson || "");
    setContactNumber(company.contactNumber || "");
    setEmail(company.email || "");
    setAddress(company.address || "");
    setDistrict(company.district || "");
    setStateField(company.state || "");
    setGstNo(company.gstNo || "");
    setGstSupplyType((company.gstSupplyType as any) || "INTRA_STATE");
    setDeviationAllowed(company.deviationAllowed ?? "");
    setToleranceAllowed(company.toleranceAllowed ?? "");
    setEditingId(company.id);
    setIsFormOpen(true);
  };

  const sortedCompanies = [...companies].sort((a, b) => {
    const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
    const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
    return timeB - timeA || (a.name || "").localeCompare(b.name || "");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-black pb-4 gap-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Companies Master</h2>
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
            onClick={exportToExcel}
            className="bg-emerald-50 text-emerald-700 border-2 border-emerald-700 px-3 py-2 rounded font-bold hover:bg-emerald-100 transition flex items-center text-sm"
            title="Export to Excel"
          >
            <FileSpreadsheet size={18} className="mr-2" /> Export
          </button>

          <button
            onClick={() => {
              setIsFormOpen(!isFormOpen);
              if (isFormOpen) resetForm();
            }}
            className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center text-sm"
          >
            {isFormOpen ? "Close Form" : <><Plus size={20} className="mr-2" /> Add New</>}
          </button>
        </div>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-black space-y-4 max-w-2xl">
          <MandatoryLegend />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Company Name" required className="font-bold text-black" />
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Contact Person</label>
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Contact Number</label>
              <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Email Id</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1 md:col-span-2">
              <label className="font-bold text-black">Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">District</label>
              <input value={district} onChange={(e) => setDistrict(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">State</label>
              <input value={stateField} onChange={(e) => setStateField(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1 md:col-span-2">
              <label className="font-bold text-black">GST NO</label>
              <input value={gstNo} onChange={(e) => setGstNo(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors" />
            </div>

            <div className="flex flex-col space-y-1 md:col-span-2">
              <MandatoryLabel label="GST Supply Type" required={isMandatoryField("company_form", "gstSupplyType")} className="font-bold text-black" />
              <select
                value={gstSupplyType}
                onChange={(e) => setGstSupplyType(e.target.value as "" | "INTRA_STATE" | "INTER_STATE")}
                required={isMandatoryField("company_form", "gstSupplyType")}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              >
                <option value="" disabled>
                  Select GST Supply Type...
                </option>
                <option value="INTRA_STATE">INTRA_STATE (CGST+SGST)</option>
                <option value="INTER_STATE">INTER_STATE (IGST)</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Deviation Allowed (%)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={deviationAllowed}
                onChange={(e) => setDeviationAllowed(e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Tolerance Allowed (%)</label>
              <input
                type="number"
                min={0}
                max={10}
                step="any"
                value={toleranceAllowed}
                onChange={(e) => {
                  const rawValue = e.target.value;
                  if (rawValue === "") {
                    setToleranceAllowed("");
                    return;
                  }
                  const numericValue = Math.max(0, Math.min(10, parseFloat(rawValue)));
                  setToleranceAllowed(numericValue);
                }}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              />
            </div>
          </div>

          <div className="flex space-x-3 pt-2 items-center">
            <button type="submit" disabled={isSubmitting} className="flex items-center justify-center min-w-[100px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50">
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
            </button>
            <button type="button" onClick={() => { setIsFormOpen(false); resetForm(); }} disabled={isSubmitting} className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-100 transition disabled:opacity-50">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-black">
        <div className="block md:hidden space-y-4 p-4">
          {sortedCompanies.map((c) => (
            <div
              key={c.id}
              onClick={() => handleEdit(c)}
              className="cursor-pointer bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-bold">{c.name}</div>
                  <div className="text-xs text-slate-700">{c.contactPerson} {c.contactNumber ? `| ${c.contactNumber}` : ""}</div>
                  <div className="text-xs text-slate-700">{c.email}</div>
                  <div className="text-xs text-slate-700">{c.district} {c.state ? `| ${c.state}` : ""}</div>
                  <div className="text-xs text-slate-700">GST Supply Type: {c.gstSupplyType || "INTRA_STATE"}</div>
                  <div className="text-xs text-slate-700">Deviation Allowed: {c.deviationAllowed ?? "-"}%</div>
                  <div className="text-xs text-slate-700">Tolerance Allowed: {c.toleranceAllowed ?? "-"}%</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(event) => { event.stopPropagation(); handleEdit(c); }} disabled={isSubmitting} className="text-indigo-600 hover:text-indigo-900 flex items-center disabled:opacity-50 font-bold"><Edit size={16} /></button>
                  <button onClick={(event) => { event.stopPropagation(); handleDelete(c.id); }} className={`${deletingId === c.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold flex items-center`}><Trash2 size={16} /></button>
                </div>
              </div>
              {c.address && <div className="text-xs text-slate-700">{c.address}</div>}
            </div>
          ))}
        </div>

        <div className="table-scroll-shell hidden md:block">
          <table className="min-w-max divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">Company</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">Contact Person</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">Contact Number</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">Email Id</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">Address</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">District</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">State</th>
                <th className="px-4 py-2 text-right text-sm font-bold text-black uppercase border border-black">GST NO</th>
                <th className="px-4 py-2 text-left text-sm font-bold text-black uppercase border border-black">GST Supply Type</th>
                <th className="px-4 py-2 text-right text-sm font-bold text-black uppercase border border-black">Deviation Allowed</th>
                <th className="px-4 py-2 text-right text-sm font-bold text-black uppercase border border-black">Tolerance Allowed</th>
                <th className="px-4 py-2 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {sortedCompanies.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                    {isLoading ? <div className="flex justify-center"><Spinner /></div> : 'No companies found. Click "Add New" to create one.'}
                  </td>
                </tr>
              ) : (
                sortedCompanies.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => handleEdit(c)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors divide-x divide-black"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.contactPerson}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.contactNumber}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.email}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.address}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.district}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.state}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black text-right border border-black">{c.gstNo}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.gstSupplyType || "INTRA_STATE"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black text-right border border-black">{c.deviationAllowed ?? "-"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-black text-right border border-black">{c.toleranceAllowed ?? "-"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium border border-black">
                      <button
                        title="Edit"
                        aria-label="Edit"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEdit(c);
                        }}
                        disabled={isSubmitting}
                        className="text-indigo-600 hover:text-indigo-900 mr-4 disabled:opacity-50"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        title={deletingId === c.id ? "Confirm delete" : "Delete"}
                        aria-label={deletingId === c.id ? "Confirm delete" : "Delete"}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(c.id);
                        }}
                        className={`${deletingId === c.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 inline-flex items-center justify-end`}
                      >
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
    </div>
  );
}
