import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { PrintingQcCheck, Production } from "../types";

type FieldType = "text" | "number" | "textarea" | "datetime-local";

type FieldConfig = {
  key: keyof PrintingQcCheck;
  label: string;
  type?: FieldType;
  required?: boolean;
  wide?: boolean;
  readOnly?: boolean;
};

type FieldSection = {
  title: string;
  fields: FieldConfig[];
};

const numberFields = new Set<keyof PrintingQcCheck>([
  "lengthId",
  "widthId",
  "heightId",
  "boardThicknessBefore",
  "boardThickness",
  "csStandard",
  "csAchieved",
  "bsStandard",
  "bsAchieved",
  "boxWeightGrams",
  "lengthSpec",
  "widthSpec",
  "heightSpec",
  "qcMasterCsSpec",
  "npdSheetCsSpec",
  "qcMasterBsSpec",
  "npdSheetBsSpec",
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
      { key: "erp", label: "ERP", readOnly: true },
      { key: "checkNo", label: "Check No.", required: true },
      { key: "qcPerson", label: "QC Person", required: true },
      { key: "whatsapp", label: "Whatsapp" },
    ],
  },
  {
    title: "Box Size",
    fields: [
      { key: "standardBoxSize", label: "Standard Box Size (L x W x H)", readOnly: true },
      { key: "boxSizeAchieved", label: "Box Size Achieved (L x W x H)" },
      { key: "lengthId", label: "LENGTH (ID)", type: "number" },
      { key: "widthId", label: "WIDTH (ID)", type: "number" },
      { key: "heightId", label: "HEIGHT (ID)", type: "number" },
      { key: "lengthSpec", label: "LENGTH (spec)", type: "number", readOnly: true },
      { key: "widthSpec", label: "WIDTH (spec)", type: "number", readOnly: true },
      { key: "heightSpec", label: "HEIGHT (spec)", type: "number", readOnly: true },
    ],
  },
  {
    title: "Strength And Weight",
    fields: [
      { key: "boardThicknessBefore", label: "Board Thickness (Before)", type: "number" },
      { key: "boardThickness", label: "Board Thickness", type: "number" },
      { key: "csStandard", label: "CS (Standard)", type: "number" },
      { key: "csAchieved", label: "CS Achieved", type: "number" },
      { key: "bsStandard", label: "BS (Standard)", type: "number" },
      { key: "bsAchieved", label: "BS Achieved", type: "number" },
      { key: "boxWeightGrams", label: "Box weight (Grams)", type: "number" },
      { key: "operatorName", label: "Operator Name" },
      { key: "qcMasterCsSpec", label: "QC Master CS (spec)", type: "number" },
      { key: "npdSheetCsSpec", label: "NPD Sheet CS (spec)", type: "number" },
      { key: "qcMasterBsSpec", label: "QC Master BS (spec)", type: "number" },
      { key: "npdSheetBsSpec", label: "NPD Sheet BS (spec)", type: "number" },
    ],
  },
  {
    title: "Printing",
    fields: [
      { key: "printingColor1Standard", label: "Printing Color 1 (Standard)", readOnly: true },
      { key: "colour1Actual", label: "Colour 1 (Actual)" },
      { key: "printingColour2Standard", label: "Printing Colour 2 (Standard)", readOnly: true },
      { key: "colour2Actual", label: "Colour 2 (Actual)" },
      { key: "standardArtwork", label: "STANDARD ARTWORK", type: "textarea", wide: true, readOnly: true },
      { key: "lotNoPrinted", label: "LOT No. Printed" },
    ],
  },
  {
    title: "System Auto-Correction",
    fields: [
      { key: "systemAutoCorrection1", label: "System Auto-Correction:", readOnly: true },
      { key: "systemAutoCorrection2", label: "System Auto-Correction:-", readOnly: true },
      { key: "systemAutoCorrection3", label: "System Auto-Correction:--", readOnly: true },
    ],
  },
  {
    title: "Remarks And References",
    fields: [
      { key: "previousCustomerComplaintWarning", label: "WARNING - (Previous Customer Complained)", type: "textarea", wide: true },
      { key: "photo", label: "PHOTO", type: "textarea", wide: true },
      { key: "column40", label: "Column 40" },
      { key: "column41", label: "Column 41" },
      { key: "column42", label: "Column 42" },
      { key: "column43", label: "Column 43" },
      { key: "planQty", label: "Plan Qty", type: "number", readOnly: true },
      { key: "samplingPlanQty", label: "Sampling Plan Qty", type: "number", readOnly: true },
      { key: "samplingCheckNo", label: "Check No", readOnly: true },
    ],
  },
];

const allFields = sections.flatMap((section) => section.fields);

function toLocalDatetimeInput(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function createInitialForm(): Partial<PrintingQcCheck> {
  return {
    timestamp: toLocalDatetimeInput(new Date()),
    jobNo: "",
    partyName: "",
    itemName: "",
    checkNo: "",
    qcPerson: "",
  };
}

function toFiniteNumber(value: unknown): number | "" {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function toOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== "") return parsed;
  }
  return "";
}

function isNumber(value: number | ""): value is number {
  return typeof value === "number";
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function buildBoxSize(length: number | "", width: number | "", height: number | "") {
  if (!isNumber(length) || !isNumber(width) || !isNumber(height)) return "";
  return `${length} x ${width} x ${height}`;
}

function parseBoxSize(value: unknown): [number | "", number | "", number | ""] {
  const parts = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .split("x")
    .map((part) => toFiniteNumber(part));
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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

function calculatePrintingQcForm(form: Partial<PrintingQcCheck>): Partial<PrintingQcCheck> {
  const qcPerson = String(form.qcPerson || "").trim();
  const lengthId = toFiniteNumber(form.lengthId);
  const widthId = toFiniteNumber(form.widthId);
  const heightId = toFiniteNumber(form.heightId);
  const [lengthAchieved, widthAchieved, heightAchieved] = parseBoxSize(form.boxSizeAchieved);
  const lengthSpec = toFiniteNumber(form.lengthSpec);
  const widthSpec = toFiniteNumber(form.widthSpec);
  const heightSpec = toFiniteNumber(form.heightSpec);
  const csAchieved = toFiniteNumber(form.csAchieved);
  const bsAchieved = toFiniteNumber(form.bsAchieved);
  const csStandard = toFiniteNumber(form.csStandard);
  const bsStandard = toFiniteNumber(form.bsStandard);
  const planQty = toFiniteNumber(form.planQty);
  const samplingPlanQty = isNumber(planQty) ? (planQty / 2000 < 2 ? 2 : planQty / 2000 > 4 ? 4 : 3) : "";
  const samplingCheckNo = String(form.checkNo || "").trim() && samplingPlanQty !== "" ? `${String(form.checkNo).trim()} / ${samplingPlanQty}` : "";
  const colour1Expected = normalizeText(form.printingColor1Standard);
  const colour1Actual = normalizeText(form.colour1Actual);
  const colour2Expected = normalizeText(form.printingColour2Standard);
  const colour2Actual = normalizeText(form.colour2Actual);
  const hasBoxInputs =
    qcPerson !== "" &&
    isNumber(lengthAchieved) &&
    isNumber(widthAchieved) &&
    isNumber(heightAchieved) &&
    isNumber(lengthSpec) &&
    isNumber(widthSpec) &&
    isNumber(heightSpec);
  const hasStrengthInputs = qcPerson !== "" && isNumber(csAchieved) && isNumber(bsAchieved) && isNumber(csStandard) && isNumber(bsStandard);
  const colourWarnings = [
    qcPerson !== "" && colour1Expected !== "" && colour1Actual !== "" && colour1Expected !== colour1Actual ? `${qcPerson} - Wrong Printing Colour 1` : "",
    qcPerson !== "" && colour2Expected !== "" && colour2Actual !== "" && colour2Expected !== colour2Actual ? `${qcPerson} - Wrong Printing Colour 2` : "",
  ].filter(Boolean);

  return {
    ...form,
    lengthId,
    widthId,
    heightId,
    standardBoxSize: buildBoxSize(lengthId, widthId, heightId),
    samplingPlanQty,
    samplingCheckNo,
    systemAutoCorrection1:
      !hasBoxInputs ||
      (lengthAchieved >= lengthSpec - 2 &&
        lengthAchieved <= lengthSpec + 2 &&
        widthAchieved >= widthSpec - 2 &&
        widthAchieved <= widthSpec + 2 &&
        heightAchieved >= heightSpec - 2 &&
        heightAchieved <= heightSpec + 2)
        ? ""
        : `${qcPerson} - Wrong Box Size Achieved. Please Check`,
    systemAutoCorrection2:
      !hasStrengthInputs || (csAchieved >= csStandard - 5 && csAchieved <= csStandard + 5 && bsAchieved >= bsStandard - 5 && bsAchieved <= bsStandard + 5)
        ? ""
        : `${qcPerson} - Wrong CS/BS Achieved. Please Check`,
    systemAutoCorrection3: colourWarnings.join(" | "),
  };
}

function buildPayload(form: Partial<PrintingQcCheck>, updatedBy: string): PrintingQcCheck {
  const calculatedForm = calculatePrintingQcForm(form);
  const timestampInput = String(calculatedForm.timestamp || "").trim();
  const timestamp = timestampInput ? new Date(timestampInput).toISOString() : new Date().toISOString();
  const payload: Record<string, unknown> = {
    id: crypto.randomUUID(),
    timestamp,
    jobNo: String(calculatedForm.jobNo || "").trim(),
    partyName: String(calculatedForm.partyName || "").trim(),
    itemName: String(calculatedForm.itemName || "").trim(),
    checkNo: String(calculatedForm.checkNo || "").trim(),
    qcPerson: String(calculatedForm.qcPerson || "").trim(),
    updatedBy,
    updateTimestamp: new Date().toISOString(),
  };

  allFields.forEach((field) => {
    if (["timestamp", "jobNo", "partyName", "itemName", "checkNo", "qcPerson"].includes(String(field.key))) return;
    const raw = calculatedForm[field.key];
    if (raw === undefined || raw === null || raw === "") return;
    if (numberFields.has(field.key)) {
      const value = Number(raw);
      if (Number.isFinite(value)) payload[field.key] = value;
      return;
    }
    payload[field.key] = String(raw).trim();
  });

  return payload as unknown as PrintingQcCheck;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (key: keyof PrintingQcCheck, value: string | number | "") => void;
}) {
  const commonClass =
    "border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full read-only:bg-slate-100 read-only:text-slate-700";
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
          readOnly={field.readOnly}
          required={field.required}
          rows={3}
          className={`${commonClass} min-h-[88px] resize-y`}
        />
      ) : (
        <input
          type={field.type || "text"}
          value={stringValue}
          onChange={(event) => onChange(field.key, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
          readOnly={field.readOnly}
          required={field.required}
          step={field.type === "number" ? "any" : undefined}
          className={commonClass}
        />
      )}
    </div>
  );
}

export function PrintingQcForm() {
  const [, setChecks] = useData<PrintingQcCheck>("printing_qc_checks", []);
  const [productions] = useData<Production>("productions", []);
  const { findItemAcrossSources } = useOrderItemCatalog();
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<PrintingQcCheck>>(createInitialForm);
  const [selectedProductionId, setSelectedProductionId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const productionById = useMemo(() => {
    const map = new Map<string, Production>();
    productions.forEach((production) => {
      if (production.id) map.set(String(production.id), production);
    });
    return map;
  }, [productions]);

  const jobOptions = useMemo(
    () =>
      [...productions]
        .sort((a, b) =>
          String(b.date || b.updateTimestamp || b.transactionNo || "").localeCompare(String(a.date || a.updateTimestamp || a.transactionNo || ""))
        )
        .map((production) => {
          const item = findItemAcrossSources(
            String(production.itemId || production.npdId || ""),
            production.itemSource,
            production.erpCode || production.masterErp
          );
          const jobNo = String(production.transactionNo || production.jobCardNo || production.id || "").trim();
          const itemName = String((production as any).itemName || item?.name || production.itemId || "").trim();
          const partyName = String(production.companyName || item?.companyName || "").trim();
          const erp = String(production.erpCode || production.masterErp || item?.erp || "").trim();
          const labelParts = [jobNo, partyName, itemName, erp].filter(Boolean);
          return {
            value: String(production.id),
            label: labelParts.join(" | "),
            searchText: labelParts.join(" "),
          };
        }),
    [findItemAcrossSources, productions]
  );

  const setField = (key: keyof PrintingQcCheck, value: string | number | "") => {
    setForm((prev) => calculatePrintingQcForm({ ...prev, [key]: value }));
  };

  const handleJobSelect = (productionId: string) => {
    setSelectedProductionId(productionId);
    const production = productionById.get(productionId);
    if (!production) {
      setForm((prev) => ({ ...prev, jobNo: "" }));
      return;
    }

    const item = findItemAcrossSources(
      String(production.itemId || production.npdId || ""),
      production.itemSource,
      production.erpCode || production.masterErp
    );
    const rawItem = item?.raw || {};
    const lengthSpec = toOptionalNumber(production.length, rawItem.lOd, rawItem.length);
    const widthSpec = toOptionalNumber(production.breadth, rawItem.wOd, rawItem.width, rawItem.breadth);
    const heightSpec = toOptionalNumber(production.height, rawItem.hOd, rawItem.height);
    const csSpec = toOptionalNumber(rawItem.cs, rawItem.compressionStrength, rawItem.csStandard);
    const bsSpec = toOptionalNumber(production.brustingStrengthReq, rawItem.bs, rawItem.burstingStrength, rawItem.bsStandard);
    const jobNo = String(production.transactionNo || production.jobCardNo || "").trim();
    const partyName = firstText(production.companyName, item?.companyName, rawItem.customerName, rawItem.customer);
    const itemName = firstText((production as any).itemName, item?.name, rawItem.itemName, rawItem.name);
    const erp = firstText(production.erpCode, production.masterErp, item?.erp, rawItem.erp, rawItem.erpCode);
    const color1 = firstText(production.color1, rawItem.printingColour1, rawItem.color1);
    const color2 = firstText(production.color2, rawItem.printingColour2, rawItem.color2);

    setForm((prev) =>
      calculatePrintingQcForm({
        ...prev,
        jobNo,
        partyName,
        itemName,
        erp,
        lengthSpec,
        widthSpec,
        heightSpec,
        standardBoxSize: buildBoxSize(lengthSpec, widthSpec, heightSpec),
        csStandard: csSpec,
        bsStandard: bsSpec,
        qcMasterCsSpec: csSpec,
        npdSheetCsSpec: csSpec,
        qcMasterBsSpec: bsSpec,
        npdSheetBsSpec: bsSpec,
        boxWeightGrams: toOptionalNumber(production.weightPerPcSetReq, production.sheetWeight, rawItem.boxWeightGrams),
        printingColor1Standard: color1,
        printingColour2Standard: color2,
        standardArtwork: firstText(rawItem.artwork, rawItem.artworkUpload, rawItem.standardArtwork),
        planQty: toOptionalNumber(production.plannedQty, production.qty),
      })
    );
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
      setSelectedProductionId("");
      setForm(createInitialForm());
      alert("Printing QC check saved successfully.");
    } catch (error) {
      console.error("Failed to save Printing QC check:", error);
      alert((error as Error).message || "Failed to save Printing QC check.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">
        Printing QC Form
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h3 className="text-sm font-black uppercase tracking-wide text-black border-b border-black pb-1">
              {section.title}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {section.fields.map((field) =>
                field.key === "jobNo" ? (
                  <div key={String(field.key)} className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm">
                      {field.label} <span className="text-red-600">*</span>
                    </label>
                    <Select
                      options={jobOptions}
                      value={selectedProductionId}
                      onChange={handleJobSelect}
                      required
                      placeholder="Search and select job no..."
                      wrapLabels
                    />
                  </div>
                ) : (
                  <FieldInput key={String(field.key)} field={field} value={form[field.key]} onChange={setField} />
                )
              )}
            </div>
          </section>
        ))}

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className="flex min-w-[180px] items-center justify-center rounded bg-indigo-600 px-6 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={24} className="text-white" /> : "Save Printing QC"}
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
  { key: "erp", label: "ERP", readOnly: true },
  { key: "checkNo", label: "Check No." },
  ...allFields.filter((field) => !["timestamp", "jobNo", "partyName", "itemName", "erp", "checkNo"].includes(String(field.key))),
];

export function PrintingQcMaster() {
  const [checks, , loading] = useData<PrintingQcCheck>("printing_qc_checks", []);
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
      [
        row.jobNo,
        row.partyName,
        row.itemName,
        row.erp,
        row.checkNo,
        row.qcPerson,
        row.operatorName,
        row.lotNoPrinted,
        row.systemAutoCorrection1,
        row.systemAutoCorrection2,
        row.systemAutoCorrection3,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [checks, searchTerm]);

  return (
    <div className="space-y-6 text-black">
      <div className="flex flex-col gap-4 border-b border-black pb-4 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Printing QC Master</h2>
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
                    Loading Printing QC checks...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={masterColumns.length} className="px-6 py-8 text-center font-medium italic text-black">
                    No Printing QC checks found.
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
