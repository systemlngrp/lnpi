import React, { useMemo, useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, Machine, ProductionProcessing, Setting } from "../types";
import { Hammer, Search, ChevronRight, ChevronDown, ClipboardList, ArrowLeft } from "lucide-react";
import { parseMandatoryMachinesByType, getRequiredMachinesForType } from "../lib/mandatoryMachines";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNpdItems } from "../hooks/useNpdItems";

interface PendingMachineJob {
  production: Production;
  item?: Item;
  companyName: string;
  erpCode: string;
  itemName: string;
  requiredQty: number;
  reportedQty: number;
  pendingQty: number;
}

interface MachineGroup {
  machineId: string;
  machineName: string;
  jobs: PendingMachineJob[];
}

export function MachinePendingProcessing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterMachineId = searchParams.get("machineId") || "";

  const [productions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [machines] = useData<Machine>("machines", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (filterMachineId) {
      setExpandedMachines(new Set([filterMachineId]));
    }
  }, [filterMachineId]);

  const mandatoryMachinesMapping = useMemo(() => parseMandatoryMachinesByType(settings[0]), [settings]);

  const machineGroups = useMemo(() => {
    const groups: Map<string, MachineGroup> = new Map();

    // Initialize groups for relevant machines
    machines.forEach(m => {
      if (filterMachineId && m.id !== filterMachineId) return;
      groups.set(m.id, { machineId: m.id, machineName: m.name, jobs: [] });
    });

    // Filter productions that are active and not completed
    const activeProductions = productions.filter(p => 
      p.status !== "Completed" && 
      p.status !== "Cancelled" && 
      !p.cancelTimestamp &&
      !p.tallyTimestamp
    );

    activeProductions.forEach(p => {
      const item = npdItems.find(i => i.id === p.itemId);
      const requiredMachines = getRequiredMachinesForType(mandatoryMachinesMapping, item?.typeName);
      
      requiredMachines.forEach(machineName => {
        const machine = machines.find(m => m.name.trim().toLowerCase() === machineName.trim().toLowerCase());
        if (!machine) return;
        if (filterMachineId && machine.id !== filterMachineId) return;

        const reportedForThisMachine = processing
          .filter(pr => pr.productionId === p.id && pr.machineId === machine.id)
          .reduce((sum, pr) => sum + Number(pr.qty || 0), 0);
        
        const pending = Math.max(0, Number(p.qty || 0) - reportedForThisMachine);

        if (pending > 0) {
          const group = groups.get(machine.id);
          if (group) {
            group.jobs.push({
              production: p,
              item,
              companyName: item?.customer || "",
              erpCode: String(item?.erp || ""),
              itemName: item?.name || "",
              requiredQty: Number(p.qty || 0),
              reportedQty: reportedForThisMachine,
              pendingQty: pending
            });
          }
        }
      });
    });

    return Array.from(groups.values())
      .filter(g => g.jobs.length > 0)
      .map(g => ({
        ...g,
        jobs: g.jobs.filter(j => {
          const search = searchTerm.toLowerCase();
          const blob = `${j.production.transactionNo} ${j.itemName} ${j.companyName} ${j.erpCode}`.toLowerCase();
          return blob.includes(search);
        }).sort((a, b) => b.production.transactionNo.localeCompare(a.production.transactionNo, undefined, { numeric: true, sensitivity: "base" }))
      }))
      .filter(g => g.jobs.length > 0)
      .sort((a, b) => a.machineName.localeCompare(b.machineName));
  }, [productions, npdItems, machines, processing, mandatoryMachinesMapping, searchTerm, filterMachineId]);

  const toggleMachine = (id: string) => {
    const next = new Set(expandedMachines);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedMachines(next);
  };

  const selectedMachineName = useMemo(() => {
    if (!filterMachineId) return "";
    return machines.find(m => m.id === filterMachineId)?.name || "";
  }, [filterMachineId, machines]);

  useEffect(() => {
    if (filterMachineId) return;
    setExpandedMachines(new Set(machineGroups.map((group) => group.machineId)));
  }, [filterMachineId, machineGroups]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          {filterMachineId && (
            <button 
              onClick={() => navigate("/production/pending-machine-processing")}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors border border-black"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">
            {filterMachineId ? `${selectedMachineName} - Pending Jobs` : "Pending Processing"}
          </h2>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search job, item, company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="space-y-4">
        {machineGroups.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center text-slate-500 font-medium italic">
            No pending processing jobs found {filterMachineId ? `for ${selectedMachineName}` : ""}.
          </div>
        ) : (
          machineGroups.map((group) => (
            <div key={group.machineId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
              {!filterMachineId && (
                <button
                  onClick={() => toggleMachine(group.machineId)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors border-b border-black"
                >
                  <div className="flex items-center gap-3">
                    <Hammer size={20} className="text-indigo-600" />
                    <span className="font-bold text-lg uppercase tracking-tight">{group.machineName}</span>
                    <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full font-black">
                      {group.jobs.length} JOBS
                    </span>
                  </div>
                  {expandedMachines.has(group.machineId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
              )}

              {(filterMachineId || expandedMachines.has(group.machineId)) && (
                <div className="p-4">
                  <div className="overflow-x-auto border border-black">
                    <table className="min-w-full divide-y divide-black border-collapse">
                      <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <tr className="divide-x divide-black">
                          <th className="px-3 py-2 text-left">Job No</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">ERP</th>
                          <th className="px-3 py-2 text-left">Company</th>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Plan Qty</th>
                          <th className="px-3 py-2 text-right">Reported</th>
                          <th className="px-3 py-2 text-right text-indigo-700">Pending</th>
                          <th className="px-3 py-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black text-[11px] font-bold">
                        {group.jobs.map((job, idx) => (
                          <tr key={`${job.production.id}-${idx}`} className="divide-x divide-black hover:bg-slate-50">
                            <td className="px-3 py-2 whitespace-nowrap">{job.production.transactionNo}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(job.production.date)}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{job.erpCode || "-"}</td>
                            <td className="px-3 py-2 max-w-[220px] truncate" title={job.companyName}>{job.companyName || "-"}</td>
                            <td className="px-3 py-2 max-w-[280px] truncate text-slate-600" title={job.itemName}>{job.itemName || "-"}</td>
                            <td className="px-3 py-2 text-right">{job.requiredQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{job.reportedQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-indigo-700 bg-indigo-50/30 font-black">{job.pendingQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => navigate(`/production-processing/form?productionId=${job.production.id}&machineId=${group.machineId}&lockMachine=1&lockJob=1`)}
                                className="inline-flex items-center gap-1 bg-indigo-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase hover:bg-indigo-700 transition shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none"
                              >
                                <ClipboardList size={12} />
                                Report
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
