import React from "react";
import { Search, Download } from "lucide-react";

interface TableControlsProps {
  searchTerm: string;
  onSearchChange: (val: string) => void;
  placeholder?: string;
}

export function TableControls({ searchTerm, onSearchChange, placeholder = "Search..." }: TableControlsProps) {
  return (
    <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 border border-black rounded shadow-sm mb-4">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder={placeholder} 
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 pr-4 py-2 w-full border-2 border-black rounded focus:outline-none focus:ring-1 focus:ring-indigo-600 font-medium"
        />
      </div>
      <div className="flex gap-2">
        <button 
          onClick={() => alert("Exporting to PDF...")}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 border border-black rounded font-bold text-sm hover:bg-slate-200 uppercase tracking-tighter shadow-sm transition-colors"
        >
          <Download size={16} /> PDF
        </button>
        <button 
          onClick={() => alert("Exporting to Excel...")}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-black rounded font-bold text-sm hover:bg-slate-200 uppercase tracking-tighter shadow-sm transition-colors"
        >
          <Download size={16} /> Excel
        </button>
      </div>
    </div>
  );
}
