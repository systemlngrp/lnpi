import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { formatDate } from "../lib/serial";
import { Material, MaterialIssue, MaterialIssueLine } from "../types";

function toDateOnly(value?: string) {
  return (value || "").split("T")[0];
}

export function DailyConsumptionMaster() {
  const [materials] = useData<Material>("materials", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const generalIssuesForDate = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return materialIssues
      .filter((issue) => issue.issueType === "General" && toDateOnly(issue.date) === date)
      .filter((issue) => {
        if (!normalizedSearch) return true;
        return (
          issue.issueNo.toLowerCase().includes(normalizedSearch) ||
          (issue.remarks || "").toLowerCase().includes(normalizedSearch)
        );
      })
      .sort((a, b) => {
        const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
        const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
        return timeB - timeA;
      });
  }, [materialIssues, date, searchTerm]);

  const issueLinesByIssueId = useMemo(() => {
    const map = new Map<string, MaterialIssueLine[]>();
    for (const line of materialIssueLines) {
      const existing = map.get(line.materialIssueId);
      if (existing) existing.push(line);
      else map.set(line.materialIssueId, [line]);
    }
    for (const lines of map.values()) lines.sort((a, b) => a.materialId.localeCompare(b.materialId));
    return map;
  }, [materialIssueLines]);

  const selectedIssue = useMemo(
    () => generalIssuesForDate.find((issue) => issue.id === selectedIssueId) || null,
    [generalIssuesForDate, selectedIssueId]
  );

  const selectedLines = useMemo(() => {
    if (!selectedIssue) return [];
    return issueLinesByIssueId.get(selectedIssue.id) || [];
  }, [issueLinesByIssueId, selectedIssue]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Daily Consumption Master</h2>
          <div className="text-sm font-bold text-slate-600">
            {formatDate(date)}: {generalIssuesForDate.length} issue(s)
          </div>
        </div>
        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
          <div className="w-full md:w-44">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelectedIssueId(null);
              }}
              className="w-full px-3 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search issue no / remarks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="block md:hidden space-y-3 p-3">
          {generalIssuesForDate.length === 0 ? (
            <div className="p-4 bg-slate-50 border border-dashed border-black text-center text-sm">No issues found for this date.</div>
          ) : (
            generalIssuesForDate.map((issue) => {
              const count = (issueLinesByIssueId.get(issue.id) || []).length;
              const isSelected = issue.id === selectedIssueId;
              return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedIssueId((prev) => (prev === issue.id ? null : issue.id))}
                  className={`w-full text-left border-2 border-black p-4 rounded shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                    isSelected ? "bg-slate-50" : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold">{issue.issueNo}</div>
                    <div className="text-xs font-bold text-slate-600">{count} line(s)</div>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{issue.remarks || "-"}</div>
                </button>
              );
            })
          )}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">Issue No</th>
              <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">Remarks</th>
              <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">Lines</th>
              <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">Updated</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {generalIssuesForDate.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-600 border border-black">
                  No issues found for this date.
                </td>
              </tr>
            ) : (
              generalIssuesForDate.map((issue) => {
                const count = (issueLinesByIssueId.get(issue.id) || []).length;
                const isSelected = issue.id === selectedIssueId;
                return (
                  <tr
                    key={issue.id}
                    className={`hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-slate-50" : ""}`}
                    onClick={() => setSelectedIssueId((prev) => (prev === issue.id ? null : issue.id))}
                  >
                    <td className="px-4 py-3 text-sm font-bold border border-black">{issue.issueNo}</td>
                    <td className="px-4 py-3 text-sm border border-black">{issue.remarks || "-"}</td>
                    <td className="px-4 py-3 text-sm border border-black">{count}</td>
                    <td className="px-4 py-3 text-sm border border-black">{formatDate(issue.updateTimestamp || issue.date)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="p-4 border-b border-black flex items-center justify-between">
          <div className="font-bold uppercase tracking-tight">Issue Details</div>
          {selectedIssue ? <div className="text-sm font-bold text-slate-600">{selectedIssue.issueNo}</div> : null}
        </div>
        {!selectedIssue ? (
          <div className="p-6 text-sm text-slate-700">Select an issue to view its lines.</div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Detail label="Date" value={formatDate(selectedIssue.date)} />
              <Detail label="Remarks" value={selectedIssue.remarks || "-"} />
              <Detail label="Total Lines" value={String(selectedLines.length)} />
            </div>

            <div className="bg-slate-50 rounded border border-black overflow-hidden">
              <table className="min-w-full divide-y divide-black border-collapse border border-black">
                <thead className="sticky top-0 z-30 bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">Material</th>
                    <th className="px-4 py-3 text-right text-xs font-black text-black uppercase tracking-wider border border-black">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-black text-black uppercase tracking-wider border border-black">UOM</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {selectedLines.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-sm text-slate-600 border border-black">
                        No lines found.
                      </td>
                    </tr>
                  ) : (
                    selectedLines.map((line) => {
                      const material = materialById.get(line.materialId);
                      return (
                        <tr key={line.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm border border-black">{material?.name || "Unknown Material"}</td>
                          <td className="px-4 py-3 text-sm border border-black text-right">{Number(line.qty || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm border border-black">{line.uom}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black p-3">
      <div className="text-xs font-black text-slate-600 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-black mt-1">{value}</div>
    </div>
  );
}

