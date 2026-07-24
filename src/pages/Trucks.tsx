import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { LoadingSlip, Truck } from "../types";
import { Spinner } from "../components/Spinner";


import { TableControls } from "../components/TableControls";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
export function Trucks() {
  const [searchTerm, setSearchTerm] = useState('');

  const [trucks, setTrucks, isLoading] = useData<Truck>("trucks", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  
  const [truckNo, setTruckNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [mobileNo, setMobileNo] = useState("");
  const [truckType, setTruckType] = useState<"Internal" | "External">("Internal");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!truckNo.trim() || !driverName.trim()) return;

    // Duplicate check
    const isDuplicate = trucks.some(t => 
      t.truckNo.toLowerCase() === truckNo.trim().toLowerCase() && t.id !== editingId
    );

    if (isDuplicate) {
      alert("A truck with this number already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
      const truckData = { 
        truckNo: truckNo.trim().toUpperCase(), 
        driverName: driverName.trim().toUpperCase(), 
        mobileNo: mobileNo.trim(), 
        truckType,
        ...audit 
      };

      if (editingId) {
        setTrucks(trucks.map(t => t.id === editingId ? { ...t, ...truckData } : t));
      } else {
        setTrucks([...trucks, { id: crypto.randomUUID(), ...truckData }]);
      }
      
      resetForm();
      setIsSubmitting(false);
    }, 500);
  };

  const resetForm = () => {
    setTruckNo("");
    setDriverName("");
    setMobileNo("");
    setTruckType("Internal");
    setEditingId(null);
    setIsFormOpen(false);
  };

  const filteredTrucks = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return [...trucks]
      .filter((truck) => {
        if (!needle) return true;
        return [truck.truckNo, truck.driverName, truck.mobileNo, truck.truckType || "External"].filter(Boolean).join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
        const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
        return timeB - timeA || a.truckNo.localeCompare(b.truckNo);
      });
  }, [searchTerm, trucks]);

  const loadingCountByTruckId = useMemo(() => {
    const counts = new Map<string, number>();
    loadingSlips.forEach((slip) => {
      const truckId = String(slip.truckId || "").trim();
      if (!truckId) return;
      counts.set(truckId, (counts.get(truckId) || 0) + 1);
    });
    return counts;
  }, [loadingSlips]);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeleteError("");
    if ((loadingCountByTruckId.get(id) || 0) > 0) {
      setDeleteError("Truck cannot be deleted because loading has been done against it.");
      return;
    }
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    try {
      await setTrucks(trucks.filter(t => t.id !== id));
    } catch (error) {
      setDeleteError((error as Error).message || "Unable to delete truck.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (truck: Truck) => {
    setTruckNo(truck.truckNo);
    setDriverName(truck.driverName);
    setMobileNo(truck.mobileNo);
    setTruckType(truck.truckType === "Internal" ? "Internal" : "External");
    setEditingId(truck.id);
    setIsFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Trucks Master</h2>
        <button
          onClick={() => {
            if (isFormOpen) {
              resetForm();
            } else {
              setIsFormOpen(true);
            }
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center"
        >
          {isFormOpen ? "Close Form" : <><Plus size={20} className="mr-2" /> Add New Truck</>}
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-black space-y-4 max-w-xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label htmlFor="truckNo" className="font-bold text-black text-sm uppercase">
                Truck No <span className="text-red-500">*</span>
              </label>
              <input
                id="truckNo"
                type="text"
                value={truckNo}
                onChange={(e) => setTruckNo(e.target.value)}
                required
                autoFocus
                placeholder="e.g. MH 01 AB 1234"
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors uppercase"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label htmlFor="driverName" className="font-bold text-black text-sm uppercase">
                Driver Name <span className="text-red-500">*</span>
              </label>
              <input
                id="driverName"
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                required
                placeholder="e.g. John Doe"
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label htmlFor="mobileNo" className="font-bold text-black text-sm uppercase">
                Mobile No.
              </label>
              <input
                id="mobileNo"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={mobileNo}
                onChange={(e) => setMobileNo(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 9876543210"
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label htmlFor="truckType" className="font-bold text-black text-sm uppercase">
                Truck Type <span className="text-red-500">*</span>
              </label>
              <select
                id="truckType"
                value={truckType}
                onChange={(e) => setTruckType(e.target.value === "Internal" ? "Internal" : "External")}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
              >
                <option value="External">External</option>
                <option value="Internal">Internal</option>
              </select>
            </div>
          </div>
          <div className="flex space-x-3 pt-2 items-center">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center min-w-[100px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting}
              className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-100 transition disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      {deleteError ? (
        <div className="rounded border border-red-600 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {deleteError}
        </div>
      ) : null}

      <DataSummaryTiles
        totalRecords={trucks.length}
        filteredRecords={filteredTrucks.length}
        showingRecords={filteredTrucks.length}
        pageLabel="1 / 1"
      />

      <div className="bg-white rounded-lg shadow-sm border border-black table-sticky-scroll">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4">
            {filteredTrucks.map((truck) => {
              const loadingCount = loadingCountByTruckId.get(truck.id) || 0;
              return (
                <div key={truck.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <div className="text-sm font-bold text-indigo-600">{truck.truckNo}</div>
                            <div className="text-sm font-bold">{truck.driverName.toUpperCase()}</div>
                            <div className="text-xs text-slate-600">{truck.mobileNo || "-"}</div>
                            <div className="text-xs font-bold text-black">Type: {truck.truckType || "External"}</div>
                            <div className="text-xs font-bold text-black">Loadings: {loadingCount}</div>
                        </div>
                        <div className="flex items-center gap-2">
                             <button
                                onClick={() => handleEdit(truck)}
                                disabled={isSubmitting}
                                className="text-indigo-600 hover:text-indigo-900 flex items-center disabled:opacity-50 font-bold"
                            >
                                <Edit size={16} />
                            </button>
                            {loadingCount === 0 ? (
                                <button
                                    onClick={() => handleDelete(truck.id)}
                                    className={`${deletingId === truck.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold flex items-center`}
                                >
                                    <Trash2 size={16} />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
              );
            })}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">SL No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Truck No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Driver Name</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Mobile No.</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Truck Type</th>
              <th className="px-6 py-3 text-center text-sm font-bold text-black uppercase border border-black">Loadings</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredTrucks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                  {isLoading ? <div className="flex justify-center"><Spinner /></div> : 'No trucks found. Click "Add New Truck" to create one.'}
                </td>
              </tr>
            ) : (
              filteredTrucks.map((truck, index) => {
                const loadingCount = loadingCountByTruckId.get(truck.id) || 0;
                return (
                <tr key={truck.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">{index + 1}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">{truck.truckNo}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{truck.driverName.toUpperCase()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{truck.mobileNo || "-"}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">{truck.truckType || "External"}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-bold text-black border border-black">{loadingCount}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium border border-black">
                    <button
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => handleEdit(truck)}
                      disabled={isSubmitting}
                      className="text-indigo-600 hover:text-indigo-900 mr-4 disabled:opacity-50"
                    >
                      <Edit size={16} />
                    </button>
                    {loadingCount === 0 ? (
                      <button
                        title={deletingId === truck.id ? "Confirm delete" : "Delete"}
                        aria-label={deletingId === truck.id ? "Confirm delete" : "Delete"}
                        onClick={() => handleDelete(truck.id)}
                        className={`${deletingId === truck.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 inline-flex items-center justify-end`}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
