import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useData } from "../hooks/useData";
import { Company, Order, OrderSchedule, Production, Machine, ProductionProcessing, Setting } from "../types";
import { Hammer, Search, ChevronRight, ChevronDown, ClipboardList, ArrowLeft } from "lucide-react";
import { parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { formatDate } from "../lib/serial";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getRequiredMachinesForProduction } from "../lib/productionType";
import { normalizeMachineName } from "../lib/productionMachineNames";

interface PendingMachineJob {
  production: Production;
  item?: any;
  companyName: string;
  erpCode: string;
  itemName: string;
  requiredQty: number;
  ffgQty: number;
  reportedQty: number;
  pendingQty: number;
}

interface MachineGroup {
  machineId: string;
  machineName: string;
  jobs: PendingMachineJob[];
}

export function MachinePendingProcessing({ fixedMachineName, title }: { fixedMachineName?: string; title?: string } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterMachineId = searchParams.get("machineId") || "";
  const fixedNormalizedMachineName = fixedMachineName ? normalizeMachineName(fixedMachineName) : "";

  const [productions] = useData<Production>("productions", []);
  const { findItemAcrossSources } = useOrderItemCatalog();
  const [machines] = useData<Machine>("machines", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (filterMachineId) {
      setExpandedMachines(new Set([filterMachineId]));
    }
  }, [filterMachineId]);

  useEffect(() => {
    if (!fixedNormalizedMachineName) return;
    const fixedMachine = machines.find((machine) => normalizeMachineName(machine.name) === fixedNormalizedMachineName);
    if (fixedMachine) setExpandedMachines(new Set([fixedMachine.id]));
  }, [fixedNormalizedMachineName, machines]);

  const mandatoryMachinesMapping = useMemo(() => parseMandatoryMachinesByType(settings[0]), [settings]);
  const scheduleById = useMemo(() => new Map(schedules.map((schedule) => [schedule.id, schedule])), [schedules]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.name || ""])), [companies]);

  const resolveCompanyName = useCallback((production: Production, item?: any) => {
    const productionCompany = String(production.companyName || "").trim();
    if (productionCompany) return productionCompany;

    const schedule = scheduleById.get(String(production.scheduleId || ""));
    const order = schedule ? orderById.get(String(schedule.orderId || "")) : undefined;
    const orderCompany = order ? String(companyNameById.get(String(order.companyId || "")) || "").trim() : "";
    if (orderCompany) return orderCompany;

    return String(item?.companyName || item?.raw?.customer || item?.raw?.customerName || "").trim();
  }, [scheduleById, orderById, companyNameById]);

  const machineGroups = useMemo(() => {
    const groups: Map<string, MachineGroup> = new Map();

    // Initialize groups for relevant machines
    machines.forEach(m => {
      if (fixedNormalizedMachineName && normalizeMachineName(m.name) !== fixedNormalizedMachineName) return;
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
      const item = findItemAcrossSources(String(p.itemId || "").trim(), p.itemSource, p.erpCode);
      const requiredMachines = Array.from(
        new Set(
          getRequiredMachinesForProduction(p, item, mandatoryMachinesMapping, machines)
            .map((machineName) => normalizeMachineName(machineName))
            .filter(Boolean)
        )
      );
      
      requiredMachines.forEach(machineName => {
        const normalizedRequiredMachine = normalizeMachineName(machineName);
        if (fixedNormalizedMachineName && normalizedRequiredMachine !== fixedNormalizedMachineName) return;
        const machine = machines.find(m => normalizeMachineName(m.name) === normalizedRequiredMachine);
        if (!machine) return;
        if (filterMachineId && machine.id !== filterMachineId) return;

        const reportedForThisMachine = processing
          .filter(pr => pr.productionId === p.id && pr.machineId === machine.id)
          .reduce((sum, pr) => sum + Number(pr.qty || 0), 0);
        
        const pending = Math.max(0, Number(p.qty || 0) - reportedForThisMachine);

        if (reportedForThisMachine <= 0 && pending > 0) {
          const group = groups.get(machine.id);
          if (group) {
            group.jobs.push({
              production: p,
              item,
              companyName: resolveCompanyName(p, item),
              erpCode: String(item?.erp || p.erpCode || ""),
              itemName: item?.name || "",
              requiredQty: Number(p.qty || 0),
              ffgQty: Number(p.prodFromFFG || 0),
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
          if (companyFilter && j.companyName !== companyFilter) return false;
          const itemKey = j.item?.id || `${j.itemName}::${j.erpCode}`;
          if (itemFilter && itemKey !== itemFilter) return false;
          const search = searchTerm.toLowerCase();
          const blob = `${j.production.transactionNo} ${j.itemName} ${j.companyName} ${j.erpCode}`.toLowerCase();
          return blob.includes(search);
        }).sort((a, b) => b.production.transactionNo.localeCompare(a.production.transactionNo, undefined, { numeric: true, sensitivity: "base" }))
      }))
      .filter(g => g.jobs.length > 0)
      .sort((a, b) => a.machineName.localeCompare(b.machineName));
  }, [productions, findItemAcrossSources, machines, processing, mandatoryMachinesMapping, searchTerm, companyFilter, itemFilter, filterMachineId, fixedNormalizedMachineName, resolveCompanyName]);

  const companyOptions = useMemo(() => {
    const names = new Set<string>();
    machineGroups.forEach((group) => group.jobs.forEach((job) => { if (job.companyName) names.add(job.companyName); }));
    return Array.from(names).sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [machineGroups]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; searchText: string }>();
    machineGroups.forEach((group) => group.jobs.forEach((job) => {
      const key = job.item?.id || `${job.itemName}::${job.erpCode}`;
      if (!key || map.has(key)) return;
      map.set(key, { value: key, label: job.erpCode && job.itemName && !job.itemName.toLowerCase().includes(job.erpCode.toLowerCase()) ? `${job.itemName} - ${job.erpCode}` : job.itemName || job.erpCode, searchText: `${job.itemName} ${job.erpCode}` });
    }));
    return Array.from(map.values()).filter((option) => option.label).sort((a, b) => a.label.localeCompare(b.label));
  }, [machineGroups]);

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
    if (filterMachineId || fixedNormalizedMachineName) return;
    const machineIds = machineGroups.map((group) => group.machineId);
    setExpandedMachines((current) => {
      if (current.size === machineIds.length && machineIds.every((id) => current.has(id))) {
        return current;
      }
      return new Set(machineIds);
    });
  }, [filterMachineId, fixedNormalizedMachineName, machineGroups]);

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
            {title || (filterMachineId ? `${selectedMachineName} - Pending Jobs` : "Pending Processing")}
          </h2>
        </div>
        <div className="grid w-full gap-3 md:grid-cols-[minmax(240px,1.4fr)_minmax(200px,1fr)_minmax(240px,1.1fr)_auto] md:items-center md:max-w-4xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search job, item, company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
          <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
          {(searchTerm || companyFilter || itemFilter) ? (
            <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {machineGroups.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center text-slate-500 font-medium italic">
            No pending processing jobs found {fixedNormalizedMachineName ? `for ${fixedNormalizedMachineName}` : filterMachineId ? `for ${selectedMachineName}` : ""}.
          </div>
        ) : (
          machineGroups.map((group) => (
            <div key={group.machineId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
              {!filterMachineId && !fixedNormalizedMachineName && (
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

              {(filterMachineId || fixedNormalizedMachineName || expandedMachines.has(group.machineId)) && (
                <div className="p-4">
                  <div className="overflow-x-auto border border-black">
                    <table className="min-w-full divide-y divide-black border-collapse">
                      <thead className="sticky top-0 z-30 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <tr className="divide-x divide-black">
                          <th className="px-3 py-2 text-left">Job No</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">ERP</th>
                          <th className="px-3 py-2 text-left">Company</th>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Plan Qty</th>
                          <th className="px-3 py-2 text-right">FFG</th>
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
                            <td className="px-3 py-2 text-right">{job.ffgQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{job.reportedQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-indigo-700 bg-indigo-50/30 font-black">{job.pendingQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => {
                                  const now = new Date();
                                  const hour = now.getHours();
                                  const shift = (hour >= 8 && hour < 20) ? "Day" : "Night";
                                  const params = new URLSearchParams({
                                    productionId: job.production.id,
                                    machineId: group.machineId,
                                    lockMachine: "1",
                                    lockJob: "1",
                                    jobNo: String(job.production.jobCardNo || job.production.transactionNo || ""),
                                    machineName: group.machineName,
                                    qty: String(job.pendingQty),
                                    shift,
                                    erp: job.erpCode,
                                    itemName: job.itemName,
                                                                      ...(fixedNormalizedMachineName ? { returnTo: "/production/pending-printing" } : {}),
                                  });
                                  navigate(`/production-processing/form?${params.toString()}`);
                                }}
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

export function PendingPrinting() {
  return <MachinePendingProcessing fixedMachineName="Printing" title="Pending Printing" />;
}
