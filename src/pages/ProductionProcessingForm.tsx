import React, { useEffect, useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Machine, User, ProductionProcessing } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { useNavigate, useSearchParams } from "react-router-dom";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";
import { MandatoryLabel, MandatoryLegend } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";
import { useAuth } from "../auth/AuthContext";

export function ProductionProcessingForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialProductionId = searchParams.get("productionId") || "";
  const initialMachineId = searchParams.get("machineId") || "";
  const lockMachine = searchParams.get("lockMachine") === "1";
  const lockJob = searchParams.get("lockJob") === "1";
  
  const [productions] = useData<Production>("productions", []);
  const [machines] = useData<Machine>("machines", []);
  const [users] = useData<User>("users", []);
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [productionId, setProductionId] = useState(initialProductionId);
  const [machineId, setMachineId] = useState(initialMachineId);
  const [shift, setShift] = useState<"" | "Day" | "Night">("");
  const [qty, setQty] = useState<string>("");
  const [operatorId, setOperatorId] = useState(user?.role === "Operator" ? user.id : "");

  const assignedMachineIdsForUser = useMemo(
    () =>
      user?.role === "Operator"
        ? new Set(
            machines
              .filter((machine) => (Array.isArray(machine.assignedOperatorIds) ? machine.assignedOperatorIds : []).includes(user.id))
              .map((machine) => machine.id)
          )
        : null,
    [machines, user]
  );

  const jobOptions = useMemo(() => {
    return productions
      .filter(p => p.status !== "Cancelled")
      .map(p => ({
        value: p.id,
        label: `Job: ${String(p.jobCardNo || "").trim() || p.transactionNo} (Qty: ${p.qty})`
      }));
  }, [productions]);

  const machineOptions = useMemo(() => {
    const visibleMachines =
      user?.role === "Operator" && assignedMachineIdsForUser
        ? machines.filter((machine) => assignedMachineIdsForUser.has(machine.id))
        : machines;

    return [...visibleMachines]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => ({ value: m.id, label: normalizeMachineName(m.name) }));
  }, [assignedMachineIdsForUser, machines, user]);

  const operatorOptions = useMemo(() => {
    if (user?.role === "Operator") {
      return [{ value: user.id, label: user.name }];
    }

    const selectedMachine = machines.find((machine) => machine.id === machineId);
    const assignedIds = Array.isArray(selectedMachine?.assignedOperatorIds) ? selectedMachine.assignedOperatorIds : [];
    const candidateUsers =
      assignedIds.length > 0
        ? users.filter((machineUser) => assignedIds.includes(machineUser.id))
        : users.filter((machineUser) => machineUser.status !== "Inactive" && machineUser.role === "Operator");

    return candidateUsers
      .map((machineUser) => ({ value: machineUser.id, label: machineUser.name }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [machineId, machines, user, users]);

  useEffect(() => {
    if (user?.role === "Operator") {
      setOperatorId(user.id);
      if (machineId && assignedMachineIdsForUser && !assignedMachineIdsForUser.has(machineId)) {
        setMachineId("");
      }
      return;
    }

    if (operatorId && !operatorOptions.some((option) => option.value === operatorId)) {
      setOperatorId("");
    }
  }, [assignedMachineIdsForUser, machineId, operatorId, operatorOptions, user]);

  const isCorrugationLiner = (machineName: string) =>
    String(machineName || "").trim().toLowerCase() === "corrugation liner";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const missing: string[] = [];
    if (isMandatoryField("production_processing_form", "date") && !date) missing.push("Date");
    if (isMandatoryField("production_processing_form", "productionId") && !productionId) missing.push("Job No");
    if (isMandatoryField("production_processing_form", "machineId") && !machineId) missing.push("Machine");
    if (isMandatoryField("production_processing_form", "shift") && !shift) missing.push("Shift");
    if (isMandatoryField("production_processing_form", "qty") && !qty) missing.push("Quantity");
    if (isMandatoryField("production_processing_form", "operatorId") && !operatorId) missing.push("Operator Name");

    if (missing.length) {
      alert(`Please fill mandatory fields: ${missing.join(", ")}`);
      return;
    }

    const selectedProduction = productions.find(p => p.id === productionId);
    const selectedMachine = machines.find(m => m.id === machineId);
    const selectedOperator = users.find(u => u.id === operatorId);

    if (!selectedProduction || !selectedMachine) return;
    if (user?.role === "Operator" && assignedMachineIdsForUser && !assignedMachineIdsForUser.has(selectedMachine.id)) {
      alert("You are not assigned to this machine.");
      return;
    }
    const operatorName = user?.role === "Operator" ? user.name : selectedOperator?.name;
    if (!operatorName) return;
    const qtyNumber = Number(qty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      alert("Please enter a quantity greater than 0.");
      return;
    }

    const plannedQty = Number(selectedProduction.qty || 0);
    const normalizedMachineName = normalizeMachineName(selectedMachine.name);
    const machineColumn = PROCESSING_MACHINE_COLUMNS.find((column) =>
      (column.machineNames as readonly string[]).includes(normalizedMachineName)
    );

    if (!machineColumn) {
      alert("Selected machine is not mapped for processing. Please contact admin.");
      return;
    }

    if (!isCorrugationLiner(normalizedMachineName) && plannedQty > 0) {
      const alreadyProcessedQty = processing
        .filter((entry) => entry.productionId === productionId && normalizeMachineName(entry.machineName) === normalizedMachineName)
        .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      const nextTotal = alreadyProcessedQty + qtyNumber;
      if (nextTotal > plannedQty) {
        alert(
          `Cannot report more than planned qty.\nJob: ${selectedProduction.jobCardNo || selectedProduction.transactionNo}\nStep/Machine: ${machineColumn.label}\nPlan Qty: ${plannedQty}\nAlready reported: ${alreadyProcessedQty}\nNow: ${qtyNumber}\nExceeds by: ${nextTotal - plannedQty}`
        );
        return;
      }
    }

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
        operatorId,
        operatorName,
        date,
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString()
      };

      setProcessing((prev) => [...prev, newEntry]);
      setIsSubmitting(false);
      navigate("/production-processing/master");
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
                onChange={(e) => setShift(e.target.value as "" | "Day" | "Night")}
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
                required 
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
              />
            </div>

            <div className="flex flex-col space-y-1">
              <MandatoryLabel label="Operator Name" required className="font-bold text-black text-sm" />
              <Select 
                value={operatorId} 
                onChange={setOperatorId} 
                options={operatorOptions} 
                placeholder="Select Operator..." 
                required
                disabled={user?.role === "Operator"} 
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
              onClick={() => navigate("/production-processing/master")} 
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
