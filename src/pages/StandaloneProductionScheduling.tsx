import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { ClientPagination } from "../components/ClientPagination";
import { TableControls } from "../components/TableControls";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";
import { generateTransactionNo, getProductionJobPrefix } from "../lib/serial";
import { getProductionMatchingFields } from "../lib/productionMatching";
import { OrderItemSource, Production } from "../types";
import { Select } from "../components/Select";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

type WorkflowSource = Extract<OrderItemSource, "PHP" | "PLATE"> | "ALL";
type JobRow = Production & { jobSource: Extract<OrderItemSource, "PHP" | "PLATE"> };

type StandaloneProductionSchedulingProps = {
  source: WorkflowSource;
};

const SHIFT_OPTIONS = [
  { value: "Day", label: "Day" },
  { value: "Night", label: "Night" },
];

const METHODOLOGY_OPTIONS = [
  { value: "CORRUGATION", label: "CORRUGATION" },
  { value: "SCRAP", label: "SCRAP" },
];

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
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "-";
}

function toOptionalNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && String(value ?? "").trim() !== "" ? numberValue : undefined;
}

function toOptionalString(value: unknown) {
  const stringValue = String(value || "").trim();
  return stringValue || undefined;
}

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalNumber(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function firstOptionalString(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalString(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

export function StandaloneProductionScheduling({ source }: StandaloneProductionSchedulingProps) {
  const [productions, setProductions] = useData<Production>("productions", []);
  const [phpJobs, setPhpJobs] = useData<Production>(getJobMasterEntityName("PHP"), []);
  const [plateJobs, setPlateJobs] = useData<Production>(getJobMasterEntityName("PLATE"), []);
  const { itemsBySource } = useOrderItemCatalog();
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<WorkflowSource>(source === "ALL" ? "ALL" : source);
  const [selectedJobKey, setSelectedJobKey] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [shift, setShift] = useState("");
  const [methodology, setMethodology] = useState("");
  const [plannedQty, setPlannedQty] = useState("");

  const jobs = useMemo<JobRow[]>(() => {
    const merged = [
      ...phpJobs.map((job) => ({ ...job, jobSource: "PHP" as const })),
      ...plateJobs.map((job) => ({ ...job, jobSource: "PLATE" as const })),
    ];
    return source === "ALL" ? merged : merged.filter((job) => job.jobSource === source);
  }, [phpJobs, plateJobs, source]);

  const activeSourceFilter = source === "ALL" ? sourceFilter : source;

  const filteredJobs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return jobs
      .filter((job) => job.status !== "Cancelled")
      .filter((job) => activeSourceFilter === "ALL" || job.jobSource === activeSourceFilter)
      .filter((job) => !String(job.scheduledDate || "").trim() || !String(job.shift || "").trim() || !String(job.methodology || "").trim() || !(Number(job.plannedQty || 0) > 0))
      .filter((job) => {
        const item = (itemsBySource[job.jobSource] || []).find((entry) => entry.id === String(job.itemId || "").trim());
        if (!query) return true;
        const haystack = [
          job.jobSource,
          job.transactionNo,
          job.erpCode,
          job.masterErp,
          job.companyName,
          job.shift,
          job.scheduledDate,
          job.methodology,
          item?.name,
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime());
  }, [activeSourceFilter, itemsBySource, jobs, searchTerm]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(filteredJobs, 25);

  const selectedJob = jobs.find((job) => `${job.jobSource}:${job.id}` === selectedJobKey);
  const selectedItem = selectedJob
    ? (itemsBySource[selectedJob.jobSource] || []).find((entry) => entry.id === String(selectedJob.itemId || "").trim())
    : undefined;

  const openScheduler = (job: JobRow) => {
    setSelectedJobKey(`${job.jobSource}:${job.id}`);
    setScheduleDate(String(job.scheduledDate || ""));
    setShift(String(job.shift || ""));
    setMethodology(String(job.methodology || ""));
    setPlannedQty(job.plannedQty === undefined || job.plannedQty === null ? "" : String(job.plannedQty || ""));
  };

  const resetScheduler = () => {
    setSelectedJobKey("");
    setScheduleDate("");
    setShift("");
    setMethodology("");
    setPlannedQty("");
  };

  const handleSave = async () => {
    if (!selectedJob) return;
    if (!scheduleDate || !shift || !methodology) {
      window.alert("Schedule Date, Shift, and Methodology are required.");
      return;
    }

    const nextPlannedQty = Number(plannedQty);
    if (!Number.isFinite(nextPlannedQty) || nextPlannedQty <= 0) {
      window.alert("Planned Qty must be greater than zero.");
      return;
    }

    const timestamp = new Date().toISOString();
    const updateJobs = (prev: Production[]) =>
      prev.map((job) =>
        job.id === selectedJob.id
          ? {
              ...job,
              scheduledDate: scheduleDate,
              shift,
              methodology,
              plannedQty: nextPlannedQty,
              updatedBy: "System User",
              updateTimestamp: timestamp,
            }
          : job
      );

    if (selectedJob.jobSource === "PHP") {
      await setPhpJobs(updateJobs);
    } else {
      await setPlateJobs(updateJobs);
    }

    let fgCreationMessage = "";
    if (String(methodology || "").trim().toUpperCase() === "CORRUGATION") {
      const sourceItem = selectedItem;
      const linkField = selectedJob.jobSource === "PHP" ? "phpScheduledJobId" : "plateScheduledJobId";
      const existingLinkedProduction = productions.find((production) => String((production as any)[linkField] || "").trim() === selectedJob.id);
      if (existingLinkedProduction) {
        fgCreationMessage = ` Linked production job ${existingLinkedProduction.transactionNo} already exists.`;
      } else if (!sourceItem) {
        fgCreationMessage = ` Production job skipped: ${selectedJob.jobSource} item not found in item master.`;
      } else {
        const sourceRaw = sourceItem.raw || {};
        const fgTxnNo = generateTransactionNo(getProductionJobPrefix("FG"), productions, scheduleDate);
        const fgEntry: Production = {
          id: crypto.randomUUID(),
          transactionNo: fgTxnNo,
          date: scheduleDate,
          scheduleId: selectedJob.scheduleId,
          planningId: selectedJob.planningId || selectedJob.scheduleId,
          scheduledDate: selectedJob.scheduledDate || scheduleDate,
          itemId: sourceItem.id,
          itemSource: "FG",
          qty: nextPlannedQty,
          plannedQty: nextPlannedQty,
          uom: sourceItem.uom || String(sourceRaw.uom || ""),
          remarks: String(selectedJob.remarks || ""),
          status: "Pending Consumption",
          updatedBy: "System User",
          updateTimestamp: timestamp,
          companyName: firstOptionalString(selectedJob.companyName, sourceItem.companyName, sourceRaw.companyName, sourceRaw.customerName),
          erpCode: firstOptionalString(selectedJob.erpCode, sourceItem.erp, sourceRaw.erpItemCode),
          phpScheduledJobId: selectedJob.jobSource === "PHP" ? selectedJob.id : undefined,
          plateScheduledJobId: selectedJob.jobSource === "PLATE" ? selectedJob.id : undefined,
        };
        const normalizedEntry: Production = {
          ...fgEntry,
          ...getProductionMatchingFields(fgEntry, sourceItem),
        };
        await setProductions((prev) => [normalizedEntry, ...prev]);
        fgCreationMessage = ` Production job ${fgTxnNo} created from ${selectedJob.jobSource} item master.`;
      }
    }

    window.alert(`Job schedule saved successfully.${fgCreationMessage}`);
    resetScheduler();
  };

  const pageTitle = source === "ALL" ? "PHP / Plate Job Scheduling" : `${getOrderItemSourceLabel(source)} Job Scheduling`;

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

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search job no, ERP, item..." />

      <div className="bg-white border border-black rounded shadow-sm overflow-auto">
        <table className="min-w-[1500px] w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Source</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Master ERP</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">ERP</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Required Qty</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Planned Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Scheduled Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Shift</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Methodology</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-black font-medium">No jobs available for scheduling.</td>
              </tr>
            ) : (
              paginatedItems.map((job) => {
                const item = (itemsBySource[job.jobSource] || []).find((entry) => entry.id === String(job.itemId || "").trim());
                const isSelected = selectedJobKey === `${job.jobSource}:${job.id}`;
                return (
                  <tr key={`${job.jobSource}:${job.id}`} className={isSelected ? "border-t border-black bg-indigo-50" : "border-t border-black"}>
                    <td className="px-3 py-2 text-sm font-bold">{job.jobSource}</td>
                    <td className="px-3 py-2 text-sm font-semibold">{formatCell(job.transactionNo)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(item?.name || job.itemId)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(job.masterErp)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(job.erpCode)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(job.requiredQty || job.qty)}</td>
                    <td className="px-3 py-2 text-sm text-right">{formatNumber(job.plannedQty)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(job.scheduledDate)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(job.shift)}</td>
                    <td className="px-3 py-2 text-sm">{formatCell(job.methodology)}</td>
                    <td className="px-3 py-2 text-center text-sm">
                      <button
                        type="button"
                        onClick={() => openScheduler(job)}
                        className="rounded border border-black px-2 py-1 font-bold uppercase hover:bg-slate-50"
                      >
                        Schedule
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded border-2 border-black bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-black pb-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-black">Scheduling Form</h3>
              <button
                type="button"
                onClick={resetScheduler}
                className="rounded border border-black px-3 py-1 text-xs font-bold uppercase text-black hover:bg-slate-50"
              >
                Close
              </button>
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
                <div className="text-xs font-black uppercase text-slate-500">Required Qty</div>
                <div className="mt-1 rounded border border-black bg-slate-100 px-3 py-2 text-sm font-bold text-black">{formatNumber(selectedJob.requiredQty || selectedJob.qty)}</div>
              </div>
              <div>
                <label className="text-xs font-black uppercase text-slate-500">Schedule Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="mt-1 w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase text-slate-500">Shift</label>
                <div className="mt-1">
                  <Select options={SHIFT_OPTIONS} value={shift} onChange={setShift} placeholder="Select shift..." />
                </div>
              </div>
              <div>
                <label className="text-xs font-black uppercase text-slate-500">Planned Qty</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                  className="mt-1 w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-black uppercase text-slate-500">Methodology</label>
                <div className="mt-1">
                  <Select options={METHODOLOGY_OPTIONS} value={methodology} onChange={setMethodology} placeholder="Select methodology..." />
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                className="rounded border border-black bg-emerald-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-emerald-700"
              >
                Save Schedule
              </button>
              <button
                type="button"
                onClick={resetScheduler}
                className="rounded border border-black bg-white px-4 py-2 text-sm font-bold uppercase text-black hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ClientPagination page={page} pageSize={pageSize} totalItems={totalItems} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
