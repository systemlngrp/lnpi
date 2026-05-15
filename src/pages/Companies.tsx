import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Company } from "../types";
import { Spinner } from "../components/Spinner";

export function Companies() {
  const [companies, setCompanies, isLoading] = useData<Company>("companies", []);

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

  const resetForm = () => {
    setName("");
    setContactPerson("");
    setContactNumber("");
    setEmail("");
    setAddress("");
    setDistrict("");
    setStateField("");
    setGstNo("");
    setEditingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Duplicate check by name
    const isDuplicate = companies.some(c => c.name.toLowerCase() === name.trim().toLowerCase() && c.id !== editingId);
    if (isDuplicate) {
      alert("A company with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
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
        ...audit,
      } as Company;

      if (editingId) {
        setCompanies(companies.map(c => c.id === editingId ? { ...c, ...payload } : c));
      } else {
        setCompanies([...companies, payload]);
      }

      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setCompanies(companies.filter(c => c.id !== id));
    setDeletingId(null);
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
    setEditingId(company.id);
    setIsFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Companies Master</h2>
        <button
          onClick={() => {
            setIsFormOpen(!isFormOpen);
            if (isFormOpen) resetForm();
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center"
        >
          {isFormOpen ? "Close Form" : <><Plus size={20} className="mr-2" /> Add New Company</>}
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-black space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Company Name <span className="text-red-500">*</span></label>
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
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-4">
            {companies.sort((a, b) => {
                const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                return timeB - timeA || (a.name || "").localeCompare(b.name || "");
            }).map((c) => (
                <div key={c.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="text-sm font-bold">{c.name}</div>
                            <div className="text-xs text-slate-700">{c.contactPerson} {c.contactNumber ? `• ${c.contactNumber}` : ''}</div>
                            <div className="text-xs text-slate-700">{c.email}</div>
                            <div className="text-xs text-slate-700">{c.district} {c.state ? `• ${c.state}` : ''}</div>
                        </div>
                        <div className="flex items-center gap-2">
                             <button onClick={() => handleEdit(c)} disabled={isSubmitting} className="text-indigo-600 hover:text-indigo-900 flex items-center disabled:opacity-50 font-bold"><Edit size={16} /></button>
                            <button onClick={() => handleDelete(c.id)} className={`${deletingId === c.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold flex items-center`}><Trash2 size={16} /></button>
                        </div>
                    </div>
                    {c.address && <div className="text-xs text-slate-700">{c.address}</div>}
                </div>
            ))}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
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
              <th className="px-4 py-2 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                  {isLoading ? <div className="flex justify-center"><Spinner /></div> : 'No companies found. Click "Add New Company" to create one.'}
                </td>
              </tr>
            ) : (
              companies.sort((a, b) => {
                const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                return timeB - timeA || (a.name || "").localeCompare(b.name || "");
              }).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.contactPerson}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.contactNumber}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.email}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.address}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.district}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black border border-black">{c.state}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-black text-right border border-black">{c.gstNo}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium border border-black">
                    <button
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => handleEdit(c)}
                      disabled={isSubmitting}
                      className="text-indigo-600 hover:text-indigo-900 mr-4 disabled:opacity-50"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      title={deletingId === c.id ? "Confirm delete" : "Delete"}
                      aria-label={deletingId === c.id ? "Confirm delete" : "Delete"}
                      onClick={() => handleDelete(c.id)}
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
  );
}
