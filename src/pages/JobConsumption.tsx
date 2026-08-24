import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { ExcelExport } from "../components/ExcelExport";
import {
  Material,
  MaterialIssue,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnReelLine,
} from "../types";
import { formatDate } from "../lib/serial";

type JobConsumptionRow = {
  key: string;
  date: string;
  dackel: string;
  gsm: string;
  kg: number;
  jobNo: string;
};

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

function getDateKey(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function makeOptions(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

export function JobConsumption() {
  const [materials] = useData<Material>("materials", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dackelFilter, setDackelFilter] = useState("");
  const [gsmFilter, setGsmFilter] = useState("");

  const allRows = useMemo<JobConsumptionRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const issueMap = new Map(materialIssues.map((issue) => [issue.id, issue]));
    const returnMap = new Map(materialReturns.map((entry) => [entry.id, entry]));
    const groupedRows = new Map<string, JobConsumptionRow>();

    const addMovement = ({
      date,
      materialId,
      jobNo,
      kg,
    }: {
      date: string;
      materialId: string;
      jobNo: string | number | undefined;
      kg: number;
    }) => {
      const movementDate = getDateKey(date);
      const material = materialMap.get(materialId);
      const dackel = String(material?.size ?? "").trim();
      const gsm = String(material?.gsm ?? "").trim();
      const normalizedJobNo = String(jobNo ?? "").trim();
      if (!movementDate || !normalizedJobNo) return;

      const key = `${movementDate}::${dackel}::${gsm}::${normalizedJobNo}`;
      const current =
        groupedRows.get(key) ||
        {
          key,
          date: movementDate,
          dackel,
          gsm,
          kg: 0,
          jobNo: normalizedJobNo,
        };

      current.kg = Number((current.kg + Number(kg || 0)).toFixed(2));
      groupedRows.set(key, current);
    };

    issueReelLines.forEach((line) => {
      const issue = issueMap.get(line.materialIssueId);
      addMovement({
        date: issue?.date || "",
        materialId: line.materialId,
        jobNo: line.jobNo,
        kg: Number(line.weightKg || 0),
      });
    });

    returnReelLines.forEach((line) => {
      const materialReturn = returnMap.get(line.materialReturnId);
      addMovement({
        date: materialReturn?.date || "",
        materialId: line.materialId,
        jobNo: line.jobNo,
        kg: -Number(line.weightKg || 0),
      });
    });

    return Array.from(groupedRows.values())
      .filter((row) => Math.abs(row.kg) > 0.005)
      .sort((a, b) => {
        const dateDiff = new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        const jobDiff = a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" });
        if (jobDiff !== 0) return jobDiff;
        const dackelDiff = a.dackel.localeCompare(b.dackel, undefined, { numeric: true, sensitivity: "base" });
        if (dackelDiff !== 0) return dackelDiff;
        return a.gsm.localeCompare(b.gsm, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [issueReelLines, materialIssues, materialReturns, materials, returnReelLines]);

  const dackelOptions = useMemo(() => makeOptions(allRows.map((row) => row.dackel)), [allRows]);
  const gsmOptions = useMemo(() => makeOptions(allRows.map((row) => row.gsm)), [allRows]);

  const rows = useMemo<JobConsumptionRow[]>(() => {
    const search = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return allRows.filter((row) => {
      const rowMs = new Date(row.date || 0).getTime();
      if (search && !row.jobNo.toLowerCase().includes(search)) return false;
      if (fromMs != null && rowMs < fromMs) return false;
      if (toMs != null && rowMs > toMs) return false;
      if (dackelFilter && row.dackel !== dackelFilter) return false;
      if (gsmFilter && row.gsm !== gsmFilter) return false;
      return true;
    });
  }, [allRows, dackelFilter, dateFrom, dateTo, gsmFilter, searchTerm]);

  const summary = useMemo(
    () => ({
      rowCount: rows.length,
      totalKg: rows.reduce((sum, row) => sum + row.kg, 0),
    }),
    [rows]
  );

  const excelRows = useMemo(
    () =>
      rows.map((row) => ({
        DATE: formatDate(row.date),
        DACKEL: row.dackel,
        GSM: row.gsm,
        KG: Number(formatQty(row.kg)),
        "JOB NUMBER": row.jobNo,
      })),
    [rows]
  );

  const hasActiveFilters = Boolean(searchTerm || dateFrom || dateTo || dackelFilter || gsmFilter);

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setDackelFilter("");
    setGsmFilter("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">JobConsumption</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Total KG</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{formatQty(summary.totalKg)}</div>
        </div>
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Rows</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{summary.rowCount}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.3fr)_130px_130px_130px_130px_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search job number"
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Date From"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Date To"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />

          <select
            value={dackelFilter}
            onChange={(e) => setDackelFilter(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">All Dackel</option>
            {dackelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={gsmFilter}
            onChange={(e) => setGsmFilter(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">All GSM</option>
            {gsmOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="flex items-center justify-end gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleClear}
                className="min-h-[42px] rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
              >
                Clear
              </button>
            ) : null}
            <ExcelExport data={excelRows} fileName="JobConsumption" sheetName="JobConsumption" />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {["DATE", "DACKEL", "GSM", "KG", "JOB NUMBER"].map((heading) => (
                  <th
                    key={heading}
                    className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No job consumption rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap font-bold">{formatDate(row.date)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{row.dackel}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{row.gsm}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right font-bold text-amber-800">{formatQty(row.kg)}</td>
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.jobNo}</td>
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

