import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Production, Machine, ProductionProcessing } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { useNavigate, useSearchParams } from "react-router-dom";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { MandatoryLabel, MandatoryLegend } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";
import { useAuth } from "../auth/AuthContext";

type ShiftValue = "" | "Day" | "Night";

function getAuditUser(user: { id?: string; name?: string } | null | undefined) {
  return {
    id: user?.id || "system",
    name: user?.name || "System User",
  };
}

function getProcessingBackUrl(machineId: string) {
  return machineId ? `/production/pending-machine-processing?machineId=${encodeURIComponent(machineId)}` : "/production/pending-machine-processing";
}

function LockedReportForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const productionId = searchParams.get("productionId") || "";
  const machineId = searchParams.get("machineId") || "";
  const jobNo = searchParams.get("jobNo") || productionId;
  const machineName = searchParams.get("machineName") || machineId;
  const itemName = searchParams.get("itemName") || "";
  const erp = searchParams.get("erp") || "";
  const initialQty = searchParams.get("qty") || "";
  const initialShift = searchParams.get("shift") || "";
  const returnTo = searchParams.get("returnTo") || "";

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [shift, setShift] = useState<ShiftValue>((initialShift as ShiftValue) || "");
  const [qty, setQty] = useState(initialQty);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missing: string[] = [];
    if (isMandatoryField("production_processing_form", "date") && !date) missing.push("Date");
    if (isMandatoryField("production_processing_form", "shift") && !shift) missing.push("Shift");
    if (isMandatoryField("production_processing_form", "qty") && !qty) missing.push("Quantity");
    if (!productionId) missing.push("Job No");
    if (!machineId) missing.push("Machine");

    if (missing.length) {
      alert(`Please fill mandatory fields: ${missing.join(", ")}`);
      return;
    }

    const qtyNumber = Number(qty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      alert("Please enter a quantity greater than 0.");
      return;
    }

    const auditUser = getAuditUser(user);
    const newEntry: ProductionProcessing = {
      id: crypto.randomUUID(),
      productionId,
      jobNo,
      machineId,
      machineName: normalizeMachineName(machineName),
      shift: shift as "Day" | "Night",
      qty: qtyNumber,
      operatorId: auditUser.id,
      operatorName: auditUser.name,
      date,
      updatedBy: auditUser.name,
      updateTimestamp: new Date().toISOString(),
      itemName: itemName || undefined,
      erp: erp || undefined,
    };

    setIsSubmitting(true);
    try {
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/production-processing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(newEntry),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to submit report");
      }

      window.dispatchEvent(new CustomEvent("sync-data-production_processing"));
      navigate(returnTo || getProcessingBackUrl(machineId));
    } catch (error) {
      console.error("Failed to submit processing report:", error);
      alert((error as Error).message || "Failed to submit report. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Reporting Form</h2>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-black">
        <form onSubmit={handleSubmit} className="space-y-6">
          <MandatoryLegend />
          <div className="space-y-4">
            <h4 className="font-black text-xs uppercase text-indigo-600 border-b border-indigo-100 pb-1">Reporting Details</h4>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Date" required className="font-bold text-black text-sm" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Job No" required className="font-bold text-black text-sm" />
              <div className="border-2 border-black rounded bg-slate-100 p-2 text-sm font-bold text-black">{jobNo || "-"}</div>
              {erp || itemName ? (
                <div className="text-[11px] font-bold text-slate-600">
                  {[erp, itemName].filter(Boolean).join(" | ")}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Machine" required className="font-bold text-black text-sm" />
              <div className="border-2 border-black rounded bg-slate-100 p-2 text-sm font-bold text-black">{normalizeMachineName(machineName) || "-"}</div>
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Shift" required className="font-bold text-black text-sm" />
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as ShiftValue)}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 font-medium"
                required
              >
                <option value="" disabled>
                  Select shift...
                </option>
                <option value="Day">Day</option>
                <option value="Night">Night</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Quantity" required className="font-bold text-black text-sm" />
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Enter processed quantity"
                min="0"
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div className="flex space-x-3 pt-4 border-t border-black">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all min-w-[120px]"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Report"}
            </button>
            <button
              type="button"
              onClick={() => navigate(returnTo || getProcessingBackUrl(machineId))}
              className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FullReportForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialProductionId = searchParams.get("productionId") || "";
  const initialMachineId = searchParams.get("machineId") || "";
  const initialQty = searchParams.get("qty") || "";
  const initialShift = searchParams.get("shift") || "";
  const lockMachine = searchParams.get("lockMachine") === "1";
  const lockJob = searchParams.get("lockJob") === "1";
  
  const [productions] = useData<Production>("productions", []);
  const [machines] = useData<Machine>("machines", []);
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [productionId, setProductionId] = useState(initialProductionId);
  const [machineId, setMachineId] = useState(initialMachineId);
  const [shift, setShift] = useState<ShiftValue>((initialShift as ShiftValue) || "");
  const [qty, setQty] = useState<string>(initialQty);

  const jobOptions = useMemo(() => {
    return productions
      .filter(p => p.status !== "Cancelled")
      .map(p => ({
        value: p.id,
        label: `Job: ${String(p.jobCardNo || "").trim() || p.transactionNo} (Qty: ${p.qty})`
      }));
  }, [productions]);

  const machineOptions = useMemo(() => {
    return [...machines]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => ({ value: m.id, label: normalizeMachineName(m.name) }));
  }, [machines]);

  const selectedProduction = useMemo(
    () => productions.find((production) => production.id === productionId),
    [productions, productionId]
  );

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === machineId),
    [machineId, machines]
  );

  const qtyContext = useMemo(() => {
    if (!selectedProduction || !selectedMachine) {
      return null;
    }

    const plannedQty = Number(selectedProduction.qty || 0);
    const normalizedMachineName = normalizeMachineName(selectedMachine.name);
    const alreadyProcessedQty = processing
      .filter(
        (entry) =>
          entry.productionId === selectedProduction.id &&
          normalizeMachineName(entry.machineName) === normalizedMachineName
      )
      .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
    const pendingQty = Math.max(0, plannedQty - alreadyProcessedQty);

    return {
      plannedQty,
      normalizedMachineName,
      alreadyProcessedQty,
      pendingQty,
    };
  }, [processing, selectedMachine, selectedProduction]);

  useEffect(() => {
    if (initialQty) return;
    if (!qtyContext || qty) return;
    if (qtyContext.pendingQty <= 0) return;
    setQty(String(qtyContext.pendingQty));
  }, [initialQty, qty, qtyContext]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const missing: string[] = [];
    if (isMandatoryField("production_processing_form", "date") && !date) missing.push("Date");
    if (isMandatoryField("production_processing_form", "productionId") && !productionId) missing.push("Job No");
    if (isMandatoryField("production_processing_form", "machineId") && !machineId) missing.push("Machine");
    if (isMandatoryField("production_processing_form", "shift") && !shift) missing.push("Shift");
    if (isMandatoryField("production_processing_form", "qty") && !qty) missing.push("Quantity");

    if (missing.length) {
      alert(`Please fill mandatory fields: ${missing.join(", ")}`);
      return;
    }

    if (!selectedProduction || !selectedMachine) return;

    const qtyNumber = Number(qty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      alert("Please enter a quantity greater than 0.");
      return;
    }

    const normalizedMachineName = qtyContext?.normalizedMachineName ?? normalizeMachineName(selectedMachine.name);
    const auditUser = getAuditUser(user);

    setIsSubmitting(true);
    setTimeout(() => {
      const newEntry: ProductionProcessing = {
        id: crypto.randomUUID(),
        productionId,
        jobNo: selectedProduction.jobCardNo || selectedProduction.transactionNo,
        machineId,
        machineName: normalizedMachineName,
        shift: shift as "Day" | "Night",
        qty: qtyNumber,
        operatorId: auditUser.id,
        operatorName: auditUser.name,
        date,
        updatedBy: auditUser.name,
        updateTimestamp: new Date().toISOString()
      };

      setProcessing((prev) => [...prev, newEntry]);
      setIsSubmitting(false);
      navigate(getProcessingBackUrl(initialMachineId));
    }, 500);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Reporting Form</h2>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-black">
        <form onSubmit={handleSubmit} className="space-y-6">
          <MandatoryLegend />
          <div className="space-y-4">
            <h4 className="font-black text-xs uppercase text-indigo-600 border-b border-indigo-100 pb-1">Reporting Details</h4>
            
            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Date" required className="font-bold text-black text-sm" />
              <input 
                type="date" 
                value={date} 
                onChange={(e) => setDate(e.target.value)} 
                required 
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
              />
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Job No" required className="font-bold text-black text-sm" />
              <Select 
                value={productionId} 
                onChange={setProductionId} 
                options={jobOptions} 
                placeholder="Select Job..." 
                required 
                disabled={lockJob && !!initialProductionId}
              />
              {lockJob && !!initialProductionId ? (
                <div className="text-[11px] font-bold text-slate-600">Job No is locked for this report.</div>
              ) : null}
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Machine" required className="font-bold text-black text-sm" />
              <Select 
                value={machineId} 
                onChange={setMachineId} 
                options={machineOptions} 
                placeholder="Select Machine..." 
                required 
                disabled={lockMachine && !!initialMachineId}
              />
              {lockMachine && !!initialMachineId ? (
                <div className="text-[11px] font-bold text-slate-600">Machine is locked for this report.</div>
              ) : null}
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Shift" required className="font-bold text-black text-sm" />
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as ShiftValue)}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 font-medium"
                required
              >
                <option value="" disabled>
                  Select shift...
                </option>
                <option value="Day">Day</option>
                <option value="Night">Night</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Quantity" required className="font-bold text-black text-sm" />
              <input 
                type="number" 
                value={qty} 
                onChange={(e) => setQty(e.target.value)} 
                placeholder="Enter processed quantity"
                min="0"
                required 
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
              />
              {qtyContext && selectedProduction && selectedMachine ? (
                <div className="text-[11px] font-bold text-slate-600">
                  Plan: {qtyContext.plannedQty.toLocaleString()} | Reported: {qtyContext.alreadyProcessedQty.toLocaleString()} | Pending: {qtyContext.pendingQty.toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex space-x-3 pt-4 border-t border-black">
            <button 
              type="submit" 
              disabled={isSubmitting} 
              className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all min-w-[120px]"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Report"}
            </button>
            <button 
              type="button" 
              onClick={() => navigate(getProcessingBackUrl(initialMachineId))} 
              className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProductionProcessingForm() {
  const [searchParams] = useSearchParams();
  const isLockedFastPath =
    searchParams.get("lockJob") === "1" &&
    searchParams.get("lockMachine") === "1" &&
    Boolean(searchParams.get("productionId")) &&
    Boolean(searchParams.get("machineId"));

  return isLockedFastPath ? <LockedReportForm /> : <FullReportForm />;
}