import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, OrderItemSource, Production, Setting } from "../types";
import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { generateTransactionNo, getProductionJobPrefix } from "../lib/serial";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemDisplayName, getOrderItemSourceLabel } from "../lib/orderItems";
import { getProductionMatchingFields } from "../lib/productionMatching";
import { parseProductionFormVisibleColumns } from "../lib/productionFormColumns";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

type StandaloneProductionFormProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

function createInitialFormData(initialDate: string) {
  return {
    date: initialDate,
    qty: "" as number | "",
    remarks: "",
    rate: "" as number | "",
    companyName: "",
    erpCode: "",
    uom: "",
    noOfParts: "" as number | "",
    ups: "" as number | "",
    length: "" as number | "",
    breadth: "" as number | "",
    height: "" as number | "",
    ply: "" as number | "",
    flute: "",
    gsm: "" as number | "",
    plateWeight: "" as number | "",
    jobCardNo: "",
  };
}

function ReadOnlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col space-y-1">
      <label className="text-xs font-bold uppercase tracking-wide text-black">{label}</label>
      <input
        value={value}
        readOnly
        className="border-2 border-black rounded p-2 text-black bg-slate-100 shadow-sm"
      />
    </div>
  );
}

export function StandaloneProductionForm({ source }: StandaloneProductionFormProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [fgProductions] = useData<Production>("productions", []);
  const [phpJobMaster] = useData<Production>(getJobMasterEntityName("PHP"), []);
  const [plateJobMaster] = useData<Production>(getJobMasterEntityName("PLATE"), []);
  const [productions, setProductions] = useData<Production>(getJobMasterEntityName(source), []);
  const [companies] = useData<Company>("companies", []);
  const [settings] = useData<Setting>("settings", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];
  const [selectedItemId, setSelectedItemId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [formData, setFormData] = useState(() => createInitialFormData(todayStr));
  const allJobRows = useMemo(
    () => [...fgProductions, ...phpJobMaster, ...plateJobMaster],
    [fgProductions, phpJobMaster, plateJobMaster]
  );

  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll("table tbody tr");
    rows.forEach((row) => {
      const txt = (row.textContent || "").toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? "none" : "";
    });
  }, [searchTerm]);

  const visibleColumns = useMemo(
    () => new Set(parseProductionFormVisibleColumns(settings[0]?.productionFormVisibleColumns)),
    [settings]
  );
  const showField = (label: string) => visibleColumns.size === 0 || visibleColumns.has(label);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId), [items, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setFormData((prev) => ({
      ...prev,
      companyName: selectedItem.companyName || prev.companyName,
      erpCode: String(selectedItem.erp || ""),
      rate: selectedItem.rate ?? "",
      uom: selectedItem.uom || "",
      noOfParts: Number((selectedItem.raw as any)?.noOfParts || 0) || "",
      ups: Number((selectedItem.raw as any)?.ups || 0) || "",
      length: Number((selectedItem.raw as any)?.length || 0) || "",
      breadth: Number((selectedItem.raw as any)?.breadth || 0) || "",
      height: Number((selectedItem.raw as any)?.height || 0) || "",
      ply: Number((selectedItem.raw as any)?.ply || 0) || "",
      flute: String((selectedItem.raw as any)?.flute || ""),
      gsm: Number((selectedItem.raw as any)?.gsm || 0) || "",
      plateWeight: Number((selectedItem.raw as any)?.plateWeight || 0) || "",
    }));
  }, [selectedItem]);

  const companyDisplay = useMemo(() => {
    if (formData.companyName) return formData.companyName;
    const itemCompany = selectedItem?.companyName || "";
    if (!itemCompany) return "";
    return companies.find((company) => company.name === itemCompany)?.name || itemCompany;
  }, [companies, formData.companyName, selectedItem]);

  const itemOptions = useMemo(
    () =>
      items
        .slice()
        .sort((a, b) => getOrderItemDisplayName(a).localeCompare(getOrderItemDisplayName(b)))
        .map((item) => ({
          value: item.id,
          label: `${getOrderItemDisplayName(item)}${item.erp ? ` | ${item.erp}` : ""}${item.companyName ? ` | ${item.companyName}` : ""}`,
        })),
    [items]
  );

  const recentRows = useMemo(
    () =>
      productions
        .filter((production) => (production.itemSource || "FG") === source)
        .slice()
        .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime())
        .slice(0, 10),
    [productions, source]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedItem) return;
    const qty = Number(formData.qty || 0);
    if (qty <= 0 || !formData.date) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const txnNo = generateTransactionNo(getProductionJobPrefix(source), allJobRows, formData.date);
      const newEntry: Production = {
        id: crypto.randomUUID(),
        transactionNo: txnNo,
        date: formData.date,
        itemId: selectedItem.id,
        itemSource: source,
        qty,
        uom: formData.uom || selectedItem.uom || "",
        remarks: formData.remarks,
        status: "Pending Consumption",
        updatedBy: "System User",
        updateTimestamp: timestamp,
        jobCardNo: formData.jobCardNo || undefined,
        rate: formData.rate === "" ? undefined : Number(formData.rate),
        companyName: companyDisplay || undefined,
        erpCode: formData.erpCode || undefined,
        noOfParts: formData.noOfParts === "" ? undefined : Number(formData.noOfParts),
        ups: formData.ups === "" ? undefined : Number(formData.ups),
        length: formData.length === "" ? undefined : Number(formData.length),
        breadth: formData.breadth === "" ? undefined : Number(formData.breadth),
        height: formData.height === "" ? undefined : Number(formData.height),
        ply: formData.ply === "" ? undefined : Number(formData.ply),
        flute: formData.flute || undefined,
        gsm: formData.gsm === "" ? undefined : Number(formData.gsm),
        plateWeight: formData.plateWeight === "" ? undefined : Number(formData.plateWeight),
      };
      const normalizedEntry: Production = {
        ...newEntry,
        ...getProductionMatchingFields(newEntry, selectedItem),
      };
      await setProductions((prev) => [normalizedEntry, ...prev]);
      setSelectedItemId("");
      setFormData(createInitialFormData(todayStr));
    } finally {
      setIsSubmitting(false);
    }
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Production Form</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white p-4 rounded shadow-sm border border-black w-full">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="flex flex-col space-y-1 xl:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wide text-black">Item</label>
              <Select
                id={`${source.toLowerCase()}-item`}
                value={selectedItemId}
                onChange={setSelectedItemId}
                options={itemOptions}
                placeholder={`Select ${sourceLabel.toLowerCase()}...`}
                required
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-bold uppercase tracking-wide text-black">Production Date</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                required
                className="border-2 border-black rounded p-2 text-black bg-yellow-100 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-bold uppercase tracking-wide text-black">Qty</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.qty}
                onChange={(e) => setFormData((prev) => ({ ...prev, qty: e.target.value === "" ? "" : Number(e.target.value) }))}
                required
                className="border-2 border-black rounded p-2 text-black bg-white focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
          </div>

          {selectedItem ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 bg-slate-50 border border-black p-4 rounded">
                <ReadOnlyField label="Item Name" value={selectedItem.name || "-"} />
                <ReadOnlyField label="ERP Code" value={formData.erpCode || "-"} />
                <ReadOnlyField label="Company" value={companyDisplay || "-"} />
                <ReadOnlyField label="UOM" value={formData.uom || selectedItem.uom || "-"} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wide text-black">Job Card No.</label>
                  <input
                    value={formData.jobCardNo}
                    onChange={(e) => setFormData((prev) => ({ ...prev, jobCardNo: e.target.value }))}
                    className="border-2 border-black rounded p-2 text-black bg-white focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wide text-black">Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.rate}
                    onChange={(e) => setFormData((prev) => ({ ...prev, rate: e.target.value === "" ? "" : Number(e.target.value) }))}
                    className="border-2 border-black rounded p-2 text-black bg-white focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                  />
                </div>
                {showField("No. Of Parts") && <ReadOnlyField label="No. Of Parts" value={formData.noOfParts === "" ? "-" : formData.noOfParts} />}
                {showField("UPS") && <ReadOnlyField label="UPS" value={formData.ups === "" ? "-" : formData.ups} />}
                {showField("Length") && <ReadOnlyField label="Length" value={formData.length === "" ? "-" : formData.length} />}
                {showField("Breadth") && <ReadOnlyField label="Breadth" value={formData.breadth === "" ? "-" : formData.breadth} />}
                {showField("Height") && <ReadOnlyField label="Height" value={formData.height === "" ? "-" : formData.height} />}
                {showField("Ply") && <ReadOnlyField label="Ply" value={formData.ply === "" ? "-" : formData.ply} />}
                {showField("Flute") && <ReadOnlyField label="Flute" value={formData.flute || "-"} />}
                {showField("GSM") && <ReadOnlyField label="GSM" value={formData.gsm === "" ? "-" : formData.gsm} />}
                {showField("Plate Weight") && <ReadOnlyField label="Plate Weight" value={formData.plateWeight === "" ? "-" : formData.plateWeight} />}
                <div className="flex flex-col space-y-1 md:col-span-2 xl:col-span-4">
                  <label className="text-xs font-bold uppercase tracking-wide text-black">Remarks</label>
                  <textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                    rows={3}
                    className="border-2 border-black rounded p-2 text-black bg-white focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                  />
                </div>
              </div>
            </>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!selectedItem || isSubmitting}
              className="inline-flex items-center gap-2 rounded border border-black bg-black px-4 py-2 text-sm font-bold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : "Save Production"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="border-b border-black px-4 py-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-black">Recent {sourceLabel} Production</h3>
        </div>
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">ERP</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
              </tr>
            ) : (
              recentRows.map((row) => {
                const item = items.find((entry) => entry.id === String(row.itemId || "").trim());
                return (
                  <tr key={row.id} className="border-t border-black">
                    <td className="px-3 py-2 text-sm font-semibold">{row.transactionNo}</td>
                    <td className="px-3 py-2 text-sm">{row.date}</td>
                    <td className="px-3 py-2 text-sm">{item?.name || row.itemId}</td>
                    <td className="px-3 py-2 text-sm">{row.erpCode || item?.erp || "-"}</td>
                    <td className="px-3 py-2 text-sm text-right">{Number(row.qty || 0)}</td>
                    <td className="px-3 py-2 text-sm">{row.status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
