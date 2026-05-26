import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { exportsAllowed } from '../lib/exportPolicy';

interface ExcelExportProps {
  data: any[];
  fileName: string;
  sheetName?: string;
  className?: string;
}

export function ExcelExport({ data, fileName, sheetName = 'Sheet1', className }: ExcelExportProps) {
  if (!exportsAllowed()) return null;

  const handleExport = () => {
    if (!data || data.length === 0) return;

    // Create a worksheet
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Create a workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    // Generate Excel file and trigger download
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  return (
    <button
      onClick={handleExport}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-bold border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors uppercase tracking-tight",
        className
      )}
      title="Download Excel"
    >
      <Download size={16} />
      <span>Excel</span>
    </button>
  );
}
