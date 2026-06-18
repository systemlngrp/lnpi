import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import type { SheetMasterColumn } from "../lib/sheetMasterConfigs";

type SheetMasterRow = {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
};

function formatCellValue(value: SheetMasterRow[string]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function SheetMasterPage({
  title,
  entity,
  columns,
  searchPlaceholder,
}: {
  title: string;
  entity: string;
  columns: SheetMasterColumn[];
  searchPlaceholder: string;
}) {
  const [rows] = useData<SheetMasterRow>(entity, []);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(query))
    );
  }, [columns, rows, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">{title}</h2>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-black py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-black text-sm">
            <thead className="bg-slate-100">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap border border-black px-3 py-2 text-left text-xs font-bold uppercase text-black">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="border border-black px-3 py-8 text-center font-medium italic text-black">
                    No records found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {columns.map((column) => (
                      <td key={column.key} className="whitespace-nowrap border border-black px-3 py-2 align-top">
                        {formatCellValue(row[column.key])}
                      </td>
                    ))}
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
