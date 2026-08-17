import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { BoardLineQcCheck } from "../types";

type FieldType = "text" | "number" | "textarea" | "datetime-local";

type FieldConfig = {
  key: keyof BoardLineQcCheck;
  label: string;
  type?: FieldType;
  required?: boolean;
  wide?: boolean;
};

type FieldSection = {
  title: string;
  fields: FieldConfig[];
};

const numberFields = new Set<keyof BoardLineQcCheck>([
  "cuttingSizeRequired",
  "cuttingSizeMm",
  "boardGsm",
  "boardThickness",
  "moisture",
  "sheetWeightGrams",
  "heightOd",
  "flap",
  "ply",
  "width",
  "length",
  "flapMinDs",
  "flapMaxDs",
  "flapAchievedOs",
  "heightAchievedOs",
  "flapLAchievedOs",
  "flapAchievedDs",
  "heightAchievedDs",
  "flapLAchievedDs",
  "planQty",
  "samplingPlanQty",
]);

const sections: FieldSection[] = [
  {
    title: "Job Details",
    fields: [
      { key: "timestamp", label: "Timestamp", type: "datetime-local", required: true },
      { key: "jobNo", label: "Job No.", required: true },
      { key: "partyName", label: "Party Name", required: true },
      { key: "itemName", label: "Item Name", required: true, wide: true },
      { key: "checkNo", label: "Check No.", required: true },
      { key: "standard", label: "Standard" },
      { key: "qcPerson", label: "QC Person", required: true },
      { key: "whatsapp", label: "Whatsapp" },
      { key: "erp", label: "ERP" },
    ],
  },
  {
    title: "Specification",
    fields: [
      { key: "flapHeightFlapOperatorSide", label: "Flap - Height - Flap (Operator Side)" },
      { key: "flapHeightFlapDriveSide", label: "Flap - Height - Flap (Drive Side)" },
      { key: "cuttingSizeRequired", label: "Cutting Size (Req.)", type: "number" },
      { key: "cuttingSizeMm", label: "Cutting Size (mm)", type: "number" },
      { key: "column19", label: "Column 19" },
      { key: "boardGsm", label: "B.GSM", type: "number" },
      { key: "typeOfFlute", label: "Type of Flute" },
      { key: "boardThickness", label: "Board Thickness", type: "number" },
      { key: "moisture", label: "Moisture", type: "number" },
      { key: "sheetWeightGrams", label: "Sheet Weight (Grams)", type: "number" },
      { key: "column20", label: "Column 20" },
    ],
  },
  {
    title: "Size Details",
    fields: [
      { key: "heightOd", label: "HEIGHT (OD)", type: "number" },
      { key: "flap", label: "FLAP", type: "number" },
      { key: "ply", label: "PLY", type: "number" },
      { key: "width", label: "WIDTH", type: "number" },
      { key: "length", label: "LENGTH", type: "number" },
      { key: "part", label: "PART" },
      { key: "flapMinDs", label: "Flap MIN (ds)", type: "number" },
      { key: "flapMaxDs", label: "Flap Max (ds)", type: "number" },
    ],
  },
  {
    title: "System Auto-Correction",
    fields: [
      { key: "systemAutoCorrection1", label: "System Auto-Correction:" },
      { key: "systemAutoCorrection2", label: "System Auto-Correction :" },
      { key: "systemAutoCorrection3", label: "System Auto-Correction:-" },
      { key: "systemAutoCorrection4", label: "System Auto-Correction:--" },
      { key: "systemAutoCorrection5", label: "System Auto-Correction -" },
    ],
  },
  {
    title: "Achieved Values",
    fields: [
      { key: "flapAchievedOs", label: "Flap (Achieved) OS", type: "number" },
      { key: "heightAchievedOs", label: "Height (Achieved) OS", type: "number" },
      { key: "flapLAchievedOs", label: "Flap L (Achieved) OS", type: "number" },
      { key: "flapAchievedDs", label: "Flap (Achieved) DS", type: "number" },
      { key: "heightAchievedDs", label: "Height (Achieved) DS", type: "number" },
      { key: "flapLAchievedDs", label: "Flap L (Achieved) DS", type: "number" },
    ],
  },
  {
    title: "Remarks And References",
    fields: [
      { key: "previousCustomerComplaintWarning", label: "WARNING - (Previous Customer Complained)", type: "textarea", wide: true },
      { key: "boardlineRemarks", label: "BOARDLINE REMARKS", type: "textarea", wide: true },
      { key: "photo", label: "PHOTO", type: "textarea", wide: true },
      { key: "printingArtwork", label: "PRINTING ARTWORK", type: "textarea", wide: true },
      { key: "planQty", label: "Plan Qty", type: "number" },
      { key: "samplingPlanQty", label: "Sampling Plan Qty", type: "number" },
    ],
  },
];

const allFields = sections.flatMap((section) => section.fields);

function toLocalDatetimeInput(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function createInitialForm(): Partial<BoardLineQcCheck> {
  return {
    timestamp: toLocalDatetimeInput(new Date()),
    jobNo: "",
    partyName: "",
    itemName: "",
    checkNo: "",
    qcPerson: "",
  };
}

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function buildPayload(form: Partial<BoardLineQcCheck>, updatedBy: string): BoardLineQcCheck {
  const timestampInput = String(form.timestamp || "").trim();
  const timestamp = timestampInput ? new Date(timestampInput).toISOString() : new Date().toISOString();
  const payload: Record<string, unknown> = {
    id: crypto.randomUUID(),
    timestamp,
    jobNo: String(form.jobNo || "").trim(),
    partyName: String(form.partyName || "").trim(),
    itemName: String(form.itemName || "").trim(),
    checkNo: String(form.checkNo || "").trim(),
    qcPerson: String(form.qcPerson || "").trim(),
    updatedBy,
    updateTimestamp: new Date().toISOString(),
  };

  allFields.forEach((field) => {
    if (["timestamp", "jobNo", "partyName", "itemName", "checkNo", "qcPerson"].includes(String(field.key))) return;
    const raw = form[field.key];
    if (raw === undefined || raw === null || raw === "") return;
    if (numberFields.has(field.key)) {
      const value = Number(raw);
      if (Number.isFinite(value)) payload[field.key] = value;
      return;
    }
    payload[field.key] = String(raw).trim();
  });

  return payload as unknown as BoardLineQcCheck;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (key: keyof BoardLineQcCheck, value: string | number | "") => void;
}) {
  const commonClass =
    "border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full";
  const stringValue = value === undefined || value === null ? "" : String(value);

  return (
    <div className={`flex flex-col space-y-1 ${field.wide ? "md:col-span-2 xl:col-span-3" : ""}`}>
      <label className="font-bold text-black text-sm">
        {field.label} {field.required ? <span className="text-red-600">*</span> : null}
      </label>
      {field.type === "textarea" ? (
        <textarea
          value={stringValue}
          onChange={(event) => onChange(field.key, event.target.value)}
          required={field.required}
          rows={3}
          className={`${commonClass} min-h-[88px] resize-y`}
        />
      ) : (
        <input
          type={field.type || "text"}
          value={stringValue}
          onChange={(event) => onChange(field.key, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
          required={field.required}
          step={field.type === "number" ? "any" : undefined}
          className={commonClass}
        />
      )}
    </div>
  );
}

export function BoardLineQcForm() {
  const [, setChecks] = useData<BoardLineQcCheck>("boardline_qc_checks", []);
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<BoardLineQcCheck>>(createInitialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = (key: keyof BoardLineQcCheck, value: string | number | "") => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit = Boolean(
    String(form.timestamp || "").trim() &&
      String(form.jobNo || "").trim() &&
      String(form.partyName || "").trim() &&
      String(form.itemName || "").trim() &&
      String(form.checkNo || "").trim() &&
      String(form.qcPerson || "").trim()
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const updatedBy = user?.name || user?.email || user?.userId || "System User";
      const payload = buildPayload(form, updatedBy);
      await setChecks((prev) => [...prev, payload]);
      setForm(createInitialForm());
      alert("Board Line QC check saved successfully.");
    } catch (error) {
      console.error("Failed to save Board Line QC check:", error);
      alert((error as Error).message || "Failed to save Board Line QC check.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">
        Board Line QC Form
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h3 className="text-sm font-black uppercase tracking-wide text-black border-b border-black pb-1">
              {section.title}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {section.fields.map((field) => (
                <FieldInput key={String(field.key)} field={field} value={form[field.key]} onChange={setField} />
              ))}
            </div>
          </section>
        ))}

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className="flex min-w-[180px] items-center justify-center rounded bg-indigo-600 px-6 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={24} className="text-white" /> : "Save QC Check"}
          </button>
        </div>
      </form>
    </div>
  );
}

const masterColumns: FieldConfig[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "jobNo", label: "Job No." },
  { key: "partyName", label: "Party Name" },
  { key: "itemName", label: "Item Name" },
  { key: "checkNo", label: "Check No." },
  { key: "standard", label: "Standard" },
  { key: "qcPerson", label: "QC Person" },
  { key: "erp", label: "ERP" },
  { key: "boardlineRemarks", label: "Remarks" },
  ...allFields.filter(
    (field) =>
      !["timestamp", "jobNo", "partyName", "itemName", "checkNo", "standard", "qcPerson", "erp", "boardlineRemarks"].includes(String(field.key))
  ),
];

export function BoardLineQcMaster() {
  const [checks, , loading] = useData<BoardLineQcCheck>("boardline_qc_checks", []);
  const [searchTerm, setSearchTerm] = useState("");

  const rows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const sorted = [...checks].sort((a, b) => {
      const timeA = new Date(a.timestamp || "").getTime() || 0;
      const timeB = new Date(b.timestamp || "").getTime() || 0;
      return timeB - timeA;
    });

    if (!search) return sorted;
    return sorted.filter((row) =>
      [row.jobNo, row.partyName, row.itemName, row.checkNo, row.erp, row.qcPerson, row.boardlineRemarks]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [checks, searchTerm]);

  return (
    <div className="space-y-6 text-black">
      <div className="flex flex-col gap-4 border-b border-black pb-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Board Line QC Master</h2>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="text"
            placeholder="Search job, party, item, ERP..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded border border-black py-2 pl-10 pr-4 text-sm text-black focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse divide-y divide-black border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
                {masterColumns.map((column) => (
                  <th key={String(column.key)} className="whitespace-nowrap border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {loading ? (
                <tr>
                  <td colSpan={masterColumns.length} className="px-6 py-8 text-center text-black">
                    Loading QC checks...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={masterColumns.length} className="px-6 py-8 text-center font-medium italic text-black">
                    No Board Line QC checks found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="divide-x divide-black transition-colors hover:bg-slate-50">
                    {masterColumns.map((column) => (
                      <td key={String(column.key)} className="max-w-[320px] whitespace-nowrap border border-black px-4 py-3 text-sm text-black">
                        {column.key === "timestamp" ? formatTimestamp(row.timestamp) : displayValue(row[column.key])}
                      </td>
                    ))}
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
