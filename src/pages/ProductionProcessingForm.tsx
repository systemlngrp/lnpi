import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Machine, User, ProductionProcessing } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { useNavigate, useSearchParams } from "react-router-dom";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";

export function ProductionProcessingForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialProductionId = searchParams.get("productionId") || "";
  
  const [productions] = useData<Production>("productions", []);
  const [machines] = useData<Machine>("machines", []);
  const [users] = useData<User>("users", []);
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [productionId, setProductionId] = useState(initialProductionId);
  const [machineId, setMachineId] = useState("");
  const [qty, setQty] = useState<string>("");
  const [operatorId, setOperatorId] = useState("");

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

  const operatorOptions = useMemo(() => {
    return users.map(u => ({ value: u.id, label: u.name }));
  }, [users]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productionId || !machineId || !qty || !operatorId) {
      alert("Please fill all required fields.");
      return;
    }

    const selectedProduction = productions.find(p => p.id === productionId);
    const selectedMachine = machines.find(m => m.id === machineId);
    const selectedOperator = users.find(u => u.id === operatorId);

    if (!selectedProduction || !selectedMachine || !selectedOperator) return;
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

    if (machineColumn.key !== "liner" && plannedQty > 0) {
      const alreadyProcessedQty = processing
        .filter((entry) => entry.productionId === productionId && normalizeMachineName(entry.machineName) === normalizedMachineName)
        .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      const nextTotal = alreadyProcessedQty + qtyNumber;
      if (nextTotal > plannedQty) {
        alert(`Cannot report more than planned qty.\nPlan: ${plannedQty}\nAlready reported (${machineColumn.label}): ${alreadyProcessedQty}\nNow: ${qtyNumber}`);
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
        qty: qtyNumber,
        operatorId,
        operatorName: selectedOperator.name,
        date,
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString()
      };

      setProcessing([...processing, newEntry]);
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
          <div className="space-y-4">
            <h4 className="font-black text-xs uppercase text-indigo-600 border-b border-indigo-100 pb-1">Reporting Details</h4>
            
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Date *</label>
              <input 
                type="date" 
                value={date} 
                onChange={(e) => setDate(e.target.value)} 
                required 
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Job No *</label>
              <Select 
                value={productionId} 
                onChange={setProductionId} 
                options={jobOptions} 
                placeholder="Select Job..." 
                required 
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Machine *</label>
              <Select 
                value={machineId} 
                onChange={setMachineId} 
                options={machineOptions} 
                placeholder="Select Machine..." 
                required 
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Quantity *</label>
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
              <label className="font-bold text-black text-sm">Operator Name *</label>
              <Select 
                value={operatorId} 
                onChange={setOperatorId} 
                options={operatorOptions} 
                placeholder="Select Operator..." 
                required 
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
