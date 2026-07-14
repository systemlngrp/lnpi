import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { ClientPagination } from "../components/ClientPagination";
import { TableControls } from "../components/TableControls";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";
import { resolvePhpPlateFgLink } from "../lib/phpPlateFgLink";
import { OrderItemSource, Production } from "../types";
import { Select } from "../components/Select";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

type WorkflowSource = Extract<OrderItemSource, "PHP" | "PLATE"> | "ALL";
type JobRow = Production & { jobSource: Extract<OrderItemSource, "PHP" | "PLATE"> };
type Props = { source: WorkflowSource };

const SOURCE_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "PHP", label: "PHP" },
  { value: "PLATE", label: "Plate" },
];

function formatCell(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "-";
  return String(value);
}

function formatNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "0";
}

function getFgCellClasses(isBlocked: boolean, requiresFgGate: boolean) {
  if (requiresFgGate && isBlocked) return "bg-red-100 text-red-700 font-bold";
  if (requiresFgGate) return "bg-emerald-50 text-emerald-700 font-bold";
  return "bg-slate-50 text-black font-semibold";
}

export function StandaloneProductionExecution({ source }: Props) {
  const [phpJobs, setPhpJobs] = useData<Production>(getJobMasterEntityName("PHP"), []);
  const [plateJobs, setPlateJobs] = useData<Production>(getJobMasterEntityName("PLATE"), []);
  const [fgProductions] = useData<Production>("productions", []);
  const { itemsBySource } = useOrderItemCatalog();
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<WorkflowSource>(source === "ALL" ? "ALL" : source);
  const [selectedJobKey, setSelectedJobKey] = useState("");
  const [completionTime, setCompletionTime] = useState("");
  const [outputQty, setOutputQty] = useState("");

  const jobs = useMemo<JobRow[]>(() => {
    const merged = [
      ...phpJobs.map((job) => ({ ...job, jobSource: "PHP" as const })),
      ...plateJobs.map((job) => ({ ...job, jobSource: "PLATE" as const })),
    ];
    return source === "ALL" ? merged : merged.filter((job) => job.jobSource === source);
  }, [phpJobs, plateJobs, source]);

  const activeSourceFilter = source === "ALL" ? sourceFilter : source;

  const pendingJobs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return jobs
      .filter((job) => job.status !== "Cancelled")
      .filter((job) => activeSourceFilter === "ALL" || job.jobSource === activeSourceFilter)
      .filter((job) => String(job.scheduledDate || "").trim() && String(job.shift || "").trim() && String(job.sequence || "").trim())
      .filter((job) => !String(job.jobCompletionTimeOutput || "").trim() || !(Number(job.productionOutputQty || 0) > 0))
      .filter((job) => {
        const item = (itemsBySource[job.jobSource] || []).find((entry) => entry.id === String(job.itemId || "").trim());
        if (!query) return true;
        const haystack = [job.jobSource, job.transactionNo, job.erpCode, job.sequence, job.shift, job.scheduledDate, job.methodology, item?.name].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => String(a.scheduledDate || "").localeCompare(String(b.scheduledDate || "")) || Number(a.sequence || 0) - Number(b.sequence || 0));
  }, [activeSourceFilter, itemsBySource, jobs, searchTerm]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(pendingJobs, 25);
  const selectedJob = pendingJobs.find((job) => `${job.jobSource}:${job.id}` === selectedJobKey) || jobs.find((job) => `${job.jobSource}:${job.id}` === selectedJobKey);
  const selectedItem = selectedJob
    ? (itemsBySource[selectedJob.jobSource] || []).find((entry) => entry.id === String(selectedJob.itemId || "").trim())
    : undefined;
  const selectedJobFgState = useMemo(
    () => (selectedJob ? resolvePhpPlateFgLink(selectedJob, fgProductions, selectedJob.jobSource) : undefined),
    [fgProductions, selectedJob]
  );

  const closeModal = () => {
    setSelectedJobKey("");
    setCompletionTime("");
    setOutputQty("");
  };

  const openModal = (job: JobRow) => {
    setSelectedJobKey(`${job.jobSource}:${job.id}`);
    setCompletionTime(String(job.jobCompletionTimeOutput || ""));
    setOutputQty(job.productionOutputQty === undefined || job.productionOutputQty === null ? "0" : String(job.productionOutputQty));
  };

  const saveProduction = async () => {
    if (!selectedJob) return;
    if (!completionTime.trim()) {
      window.alert("Job completion time is required.");
      return;
    }
    const nextOutput = Number(outputQty || 0);
    if (!Number.isFinite(nextOutput) || nextOutput < 0) {
      window.alert("Output must be zero or more.");
      return;
    }
    if (selectedJobFgState?.requiresFgGate && selectedJobFgState.isBlocked) {
      window.alert("Fill FG value in main Production Master first. PHP/Plate output is blocked for Corrugation jobs until FG is filled.");
      return;
    }
    const timestamp = new Date().toISOString();
    const updateJobs = (prev: Production[]) =>
      prev.map((job) =>
        job.id === selectedJob.id
          ? { ...job, jobCompletionTimeOutput: completionTime, productionOutputQty: nextOutput, updatedBy: "System User", updateTimestamp: timestamp }
          : job
      );
    if (selectedJob.jobSource === "PHP") {
      await setPhpJobs(updateJobs);
    } else {
      await setPlateJobs(updateJobs);
    }
    window.alert("Production saved successfully.");
    closeModal();
  };

  const pageTitle = source === "ALL" ? "Pending Production - PHP / Plate" : `Pending Production - ${getOrderItemSourceLabel(source)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{pageTitle}</h2>
        {source === "ALL" ? (
          <div className="w-full md:w-52">
            <Select options={SOURCE_OPTIONS} value={sourceFilter} onChange={(value) => setSourceFilter(value as WorkflowSource)} placeholder="Select source..." />
          </div>
        ) : null}
      </div>
      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search job no, sequence, item..." />
      <div className="bg-white border border-black rounded shadow-sm overflow-auto">
        <table className="min-w-[1560px] w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Source</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Sequence</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Shift</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Scheduled Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Methodology</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">FG Value</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-black font-medium">No jobs pending production.</td></tr>
            ) : paginatedItems.map((job) => {
              const item = (itemsBySource[job.jobSource] || []).find((entry) => entry.id === String(job.itemId || "").trim());
              const fgState = resolvePhpPlateFgLink(job, fgProductions, job.jobSource);
              return (
                <tr key={`${job.jobSource}:${job.id}`} className="border-t border-black">
                  <td className="px-3 py-2 text-sm font-bold">{job.jobSource}</td>
                  <td className="px-3 py-2 text-sm font-semibold">{formatCell(job.transactionNo)}</td>
                  <td className="px-3 py-2 text-sm">{formatCell(job.sequence)}</td>
                  <td className="px-3 py-2 text-sm">{formatCell(job.shift)}</td>
                  <td className="px-3 py-2 text-sm">{formatCell(item?.name || job.itemId)}</td>
                  <td className="px-3 py-2 text-sm">{formatCell(job.scheduledDate)}</td>
                  <td className="px-3 py-2 text-sm">{formatCell(job.methodology)}</td>
                  <td className={`px-3 py-2 text-sm text-right ${getFgCellClasses(fgState.isBlocked, fgState.requiresFgGate)}`}>{formatNumber(fgState.fgValue)}</td>
                  <td className="px-3 py-2 text-center text-sm"><button type="button" onClick={() => openModal(job)} className="rounded border border-black px-2 py-1 font-bold uppercase hover:bg-slate-50">Production</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded border-2 border-black bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-black pb-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-black">Production</h3>
              <button type="button" onClick={closeModal} className="rounded border border-black px-3 py-1 text-xs font-bold uppercase text-black hover:bg-slate-50">Close</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Source</div>
                <div className="mt-1 rounded border border-black bg-slate-100 px-3 py-2 text-sm font-bold text-black">{selectedJob.jobSource}</div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Job No</div>
                <div className="mt-1 rounded border border-black bg-slate-100 px-3 py-2 text-sm font-bold text-black">{selectedJob.transactionNo}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-black uppercase text-slate-500">Item</div>
                <div className="mt-1 rounded border border-black bg-slate-100 px-3 py-2 text-sm font-bold text-black">{selectedItem?.name || selectedJob.itemId}</div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Methodology</div>
                <div className="mt-1 rounded border border-black bg-slate-100 px-3 py-2 text-sm font-bold text-black">{formatCell(selectedJob.methodology)}</div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">FG Value</div>
                <div className={`mt-1 rounded border border-black px-3 py-2 text-sm text-right ${getFgCellClasses(!!selectedJobFgState?.isBlocked, !!selectedJobFgState?.requiresFgGate)}`}>{formatNumber(selectedJobFgState?.fgValue ?? 0)}</div>
              </div>
              <div>
                <label className="text-xs font-black uppercase text-slate-500">Job Completion Time</label>
                <input type="time" value={completionTime} onChange={(e) => setCompletionTime(e.target.value)} className="mt-1 w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
              </div>
              <div>
                <label className="text-xs font-black uppercase text-slate-500">Output</label>
                <input type="number" min={0} step="any" value={outputQty} disabled={!!selectedJobFgState?.requiresFgGate && !!selectedJobFgState?.isBlocked} onChange={(e) => setOutputQty(e.target.value)} className="mt-1 w-full border-2 border-black rounded p-2 text-black disabled:bg-red-50 disabled:text-red-700 disabled:cursor-not-allowed focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
              </div>
            </div>
            {selectedJobFgState?.requiresFgGate && selectedJobFgState.isBlocked ? (
              <div className="mt-4 rounded border border-red-400 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                FG value is still 0 in main Production Master. Fill FG first, then PHP/Plate output will unlock.
              </div>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={!!selectedJobFgState?.requiresFgGate && !!selectedJobFgState?.isBlocked} onClick={() => void saveProduction()} className="rounded border border-black bg-emerald-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Save</button>
              <button type="button" onClick={closeModal} className="rounded border border-black bg-white px-4 py-2 text-sm font-bold uppercase text-black hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
      <ClientPagination page={page} pageSize={pageSize} totalItems={totalItems} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
