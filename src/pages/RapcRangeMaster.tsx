import React, { useEffect, useMemo, useState } from "react";
import { Edit, Plus, Search, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { RapcRange } from "../types";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { useClientPagination } from "../hooks/useClientPagination";
import { buildSeedRapcRanges } from "../lib/rapcRanges";

export function RapcRangeMaster() {
  const [ranges, setRanges, loading] = useData<RapcRange>("rapc-ranges", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterFrom, setFilterFrom] = useState<"" | number>("");
  const [filterTo, setFilterTo] = useState<"" | number>("");
  const [fromValue, setFromValue] = useState<number | "">("");
  const [toValue, setToValue] = useState<number | "">("");
  const [rapcRangeValue, setRapcRangeValue] = useState<number | "">("");
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || ranges.length > 0) return;
    setRanges(buildSeedRapcRanges());
  }, [loading, ranges.length, setRanges]);

  const resetForm = () => {
    setFromValue("");
    setToValue("");
    setRapcRangeValue("");
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromValue === "" || toValue === "" || rapcRangeValue === "") return;

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = {
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString(),
      };
      const payload: RapcRange = {
        id: editingId || crypto.randomUUID(),
        from: Number(fromValue),
        to: Number(toValue),
        rapcRange: Number(rapcRangeValue),
        ...audit,
      };

      if (editingId) {
        setRanges((prev) => prev.map((row) => (row.id === editingId ? payload : row)));
      } else {
        setRanges((prev) => [...prev, payload]);
      }

      resetForm();
      setIsSubmitting(false);
    }, 300);
  };

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setRanges((prev) => prev.filter((row) => row.id !== id));
    setDeletingId(null);
  };

  const filteredRanges = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return ranges.filter((row) => {
      if (!normalized && filterFrom === '' && filterTo === '') return true;
      const matchesSearch =
        String(row.from).includes(normalized) ||
        String(row.to).includes(normalized) ||
        String(row.rapcRange).includes(normalized);
      const matchesFrom = filterFrom === '' || row.from >= Number(filterFrom);
      const matchesTo = filterTo === '' || row.to <= Number(filterTo);
      return matchesSearch && matchesFrom && matchesTo;
    });
  }, [ranges, searchTerm, filterFrom, filterTo]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedRanges,
  } = useClientPagination(filteredRanges, 25);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">RAPC Range Master</h2>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
          >
            <Plus size={18} /> Add RAPC Range
          </button>
        )}
      </div>

      {isFormOpen && (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-2xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">{editingId ? "Edit RAPC Range" : "Create RAPC Range"}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">From *</label>
                <input
                  autoFocus
                  type="number"
                  value={fromValue}
                  onChange={(e) => setFromValue(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">To *</label>
                <input
                  type="number"
                  value={toValue}
                  onChange={(e) => setToValue(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">RAPC Range *</label>
                <input
                  type="number"
                  value={rapcRangeValue}
                  onChange={(e) => setRapcRangeValue(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600"
                />
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t border-black">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save"}
              </button>
              <button type="button" onClick={resetForm} className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 border border-black rounded shadow-sm mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search ranges..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border-2 border-black rounded focus:outline-none focus:ring-1 focus:ring-indigo-600 font-medium"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          placeholder="From"
          value={filterFrom}
          onChange={(e) => setFilterFrom(e.target.value === "" ? "" : Number(e.target.value))}
          className="border-2 border-black rounded px-3 py-2 text-sm w-24"
        />
        <input
          type="number"
          placeholder="To"
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value === "" ? "" : Number(e.target.value))}
          className="border-2 border-black rounded px-3 py-2 text-sm w-24"
        />
        {(filterFrom !== "" || filterTo !== "") && (
          <button
            type="button"
            onClick={() => {
              setFilterFrom("");
              setFilterTo("");
            }}
            className="text-xs bg-gray-200 text-gray-800 px-3 py-2 rounded hover:bg-gray-300"
          >
            Clear Filter
          </button>
        )}
        </div>
      </div>

      <DataSummaryTiles
        totalRecords={ranges.length}
        filteredRecords={filteredRanges.length}
        showingRecords={paginatedRanges.length}
        pageLabel={`${page} / ${Math.max(1, Math.ceil(totalItems / pageSize))}`}
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="table-sticky-scroll">
          <table className="min-w-max divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="divide-x divide-black">
                <th className="border border-black px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">SL No</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">From</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">To</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">RAPC Range</th>
                <th className="border border-black px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {loading ? (
                <tr>
                  <td colSpan={5} className="border border-black px-6 py-8 text-center text-black">
                    <div className="flex justify-center">
                      <Spinner />
                    </div>
                  </td>
                </tr>
              ) : paginatedRanges.length === 0 ? (
                <tr>
                  <td colSpan={5} className="border border-black px-6 py-8 text-center text-black font-medium">
                    No RAPC ranges found.
                  </td>
                </tr>
              ) : (
                paginatedRanges.map((row, index) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm font-bold text-black text-right">{(page - 1) * pageSize + index + 1}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{row.from}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm text-black">{row.to}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm text-black">{row.rapcRange}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setFromValue(row.from);
                          setToValue(row.to);
                          setRapcRangeValue(row.rapcRange);
                          setEditingId(row.id);
                          setIsFormOpen(true);
                        }}
                        className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"
                      >
                        <Edit size={16} className="mr-1" /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(row.id)}
                        className={`${deletingId === row.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                      >
                        <Trash2 size={16} className="mr-1" /> {deletingId === row.id ? "Confirm?" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
