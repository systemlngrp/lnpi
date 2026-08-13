import React, { useMemo, useState } from "react";
import { Edit, Plus, Trash2 } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { TableControls } from "../components/TableControls";
import { useData } from "../hooks/useData";
import type { ExpenseMaster } from "../types";


const EXPENSE_TYPES: NonNullable<ExpenseMaster["type"]>[] = ["Monthly", "Daily"];
export function ExpenseMasters() {
  const [expenses, setExpenses] = useData<ExpenseMaster>("expense_masters", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<NonNullable<ExpenseMaster["type"]>>("Monthly");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredExpenses = useMemo(
    () =>
      [...expenses]
        .filter((expense) => expense.name.toLowerCase().includes(searchTerm.trim().toLowerCase()))
        .sort((a, b) => {
          const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
          const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
          return timeB - timeA || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        }),
    [expenses, searchTerm]
  );

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setType("Monthly");
  };

  const openCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (expense: ExpenseMaster) => {
    setEditingId(expense.id);
    setName(expense.name);
    setType(expense.type === "Daily" ? "Daily" : "Monthly");
    setIsFormOpen(true);
  };

  const closeForm = () => {
    resetForm();
    setIsFormOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;

    const duplicate = expenses.some(
      (expense) => expense.id !== editingId && expense.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );
    if (duplicate) {
      alert("An expense with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextRow: ExpenseMaster = {
        id: editingId || crypto.randomUUID(),
        name: normalizedName,
        type,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
      await setExpenses((current) =>
        editingId ? current.map((expense) => (expense.id === editingId ? nextRow : expense)) : [nextRow, ...current]
      );
      closeForm();
    } catch (error) {
      console.error("Failed to save expense master:", error);
      alert("Failed to save expense. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    await setExpenses((current) => current.filter((expense) => expense.id !== id));
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-black pb-4">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Expense Master</h2>
        {!isFormOpen ? (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 font-bold text-white shadow transition hover:bg-indigo-700"
          >
            <Plus size={18} /> Add Expense
          </button>
        ) : null}
      </div>

      {isFormOpen ? (
        <div className="max-w-xl rounded border border-black bg-white p-6 shadow-sm">
          <h3 className="mb-6 text-lg font-bold uppercase text-black">{editingId ? "Edit Expense" : "Create Expense"}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="flex flex-col gap-1 font-bold text-black">
              Expense Name *
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                className="rounded border-2 border-black p-2 text-black focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
              />
            </label>
            <label className="flex flex-col gap-1 font-bold text-black">
              Type *
              <select
                value={type}
                onChange={(event) => setType(event.target.value as NonNullable<ExpenseMaster["type"]>)}
                className="rounded border-2 border-black bg-white p-2 text-black focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
              >
                {EXPENSE_TYPES.map((expenseType) => (
                  <option key={expenseType} value={expenseType}>
                    {expenseType}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={isSubmitting} className="min-w-[100px] rounded border border-black bg-emerald-600 px-6 py-2 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
              </button>
              <button type="button" onClick={closeForm} className="rounded border-2 border-black bg-white px-6 py-2 font-bold text-black transition hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search expenses..." />
          <div className="table-sticky-scroll rounded border border-black bg-white shadow-sm">
            <table className="min-w-full border-collapse divide-y divide-black border border-black">
              <thead className="sticky top-0 z-30 divide-x divide-black bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="border border-black px-6 py-3 text-left text-sm font-bold uppercase text-black">Expense Name</th>
                  <th className="border border-black px-6 py-3 text-left text-sm font-bold uppercase text-black">Type</th>
                  <th className="border border-black px-6 py-3 text-right text-sm font-bold uppercase text-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center font-medium text-black">No expenses found.</td>
                  </tr>
                ) : (
                  filteredExpenses.map((expense) => (
                    <tr key={expense.id} className="divide-x divide-black hover:bg-slate-50">
                      <td className="border border-black px-6 py-4 text-sm text-black">{expense.name}</td>
                      <td className="border border-black px-6 py-4 text-sm text-black">{expense.type || "Monthly"}</td>
                      <td className="whitespace-nowrap border border-black px-6 py-4 text-right text-sm font-medium">
                        <button onClick={() => openEdit(expense)} className="mr-4 inline-flex items-center font-bold text-indigo-600 hover:text-indigo-900">
                          <Edit size={16} className="mr-1" /> Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(expense.id)}
                          className={`${deletingId === expense.id ? "animate-pulse text-amber-600" : "text-red-600"} inline-flex min-w-[80px] items-center justify-end font-bold hover:text-red-900`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === expense.id ? "Confirm?" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
