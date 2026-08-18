import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { BoardLineQcCheck, Production } from "../types";

type FieldType = "text" | "number" | "textarea" | "datetime-local";

type FieldConfig = {
  key: keyof BoardLineQcCheck;
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
      { key: "bqcNo", label: "BQC No", readOnly: true },
      { key: "jobNo", label: "Job No.", required: true },
      { key: "partyName", label: "Party Name", required: true, readOnly: true },
      { key: "itemName", label: "Item Name", required: true, wide: true, readOnly: true },
      { key: "checkNo", label: "Check No.", required: true, readOnly: true },
      { key: "standard", label: "Standard", readOnly: true },
      { key: "qcPerson", label: "QC Person", required: true, readOnly: true },
      { key: "erp", label: "ERP", readOnly: true },
    ],
  },
  {
    title: "Specification",
    fields: [
      { key: "flapHeightFlapOperatorSide", label: "Flap - Height - Flap (Operator Side)", required: true },
      { key: "flapHeightFlapDriveSide", label: "Flap - Height - Flap (Drive Side)", required: true },
      { key: "cuttingSizeRequired", label: "Cutting Size (Req.)", type: "number", readOnly: true },
      { key: "cuttingSizeMm", label: "Cutting Size (mm)", type: "number", required: true },
      { key: "boardGsm", label: "B.GSM", type: "number", required: true },
      { key: "typeOfFlute", label: "Type of Flute", required: true },
      { key: "boardThickness", label: "Board Thickness", type: "number", required: true },
      { key: "moisture", label: "Moisture", type: "number", required: true },
      { key: "sheetWeightGrams", label: "Sheet Weight (Grams)", type: "number", required: true },
    ],
  },
  {
    title: "Size Details",
    fields: [
      { key: "heightOd", label: "HEIGHT (OD)", type: "number", readOnly: true },
      { key: "flap", label: "FLAP", type: "number", readOnly: true },
      { key: "ply", label: "PLY", type: "number", readOnly: true },
      { key: "width", label: "WIDTH", type: "number", readOnly: true },
      { key: "length", label: "LENGTH", type: "number", readOnly: true },
      { key: "part", label: "PART", readOnly: true },
      { key: "flapMinDs", label: "Flap MIN (ds)", type: "number", readOnly: true },
      { key: "flapMaxDs", label: "Flap Max (ds)", type: "number", readOnly: true },
    ],
  },
  {
    title: "System Auto-Correction",
    fields: [
      { key: "systemAutoCorrection1", label: "System Auto-Correction:", readOnly: true },
      { key: "systemAutoCorrection2", label: "System Auto-Correction :", readOnly: true },
      { key: "systemAutoCorrection3", label: "System Auto-Correction:-", readOnly: true },
      { key: "systemAutoCorrection4", label: "System Auto-Correction:--", readOnly: true },
      { key: "systemAutoCorrection5", label: "System Auto-Correction -", readOnly: true },
    ],
  },
  {
    title: "Achieved Values",
    fields: [
      { key: "flapAchievedOs", label: "Flap (Achieved) OS", type: "number", readOnly: true },
      { key: "heightAchievedOs", label: "Height (Achieved) OS", type: "number", readOnly: true },
      { key: "flapLAchievedOs", label: "Flap L (Achieved) OS", type: "number", readOnly: true },
      { key: "flapAchievedDs", label: "Flap (Achieved) DS", type: "number", readOnly: true },
      { key: "heightAchievedDs", label: "Height (Achieved) DS", type: "number", readOnly: true },
      { key: "flapLAchievedDs", label: "Flap L (Achieved) DS", type: "number", readOnly: true },
    ],
  },
  {
    title: "Remarks And References",
    fields: [
      { key: "previousCustomerComplaintWarning", label: "WARNING - (Previous Customer Complained)", type: "textarea", wide: true },
      { key: "boardlineRemarks", label: "BOARDLINE REMARKS", type: "textarea", wide: true },
      { key: "photo", label: "PHOTO", type: "textarea", wide: true },
      { key: "printingArtwork", label: "PRINTING ARTWORK", type: "textarea", wide: true, readOnly: true },
      { key: "planQty", label: "Plan Qty", type: "number", readOnly: true },
      { key: "samplingPlanQty", label: "Sampling Plan Qty", type: "number", readOnly: true },
      { key: "samplingCheckNo", label: "Check No", readOnly: true },
    ],
  },
];

const allFields = sections.flatMap((section) => section.fields);
const formSections: FieldSection[] = [
  {
    title: "Job Details",
    fields: [
      { key: "jobNo", label: "Job No.", required: true },
      { key: "checkNo", label: "Check No.", required: true, readOnly: true },
      { key: "qcPerson", label: "QC Person", required: true, readOnly: true },
    ],
  },
  {
    title: "Specification",
    fields: [
      { key: "flapHeightFlapOperatorSide", label: "Flap - Height - Flap (Operator Side)", required: true },
      { key: "flapHeightFlapDriveSide", label: "Flap - Height - Flap (Drive Side)", required: true },
      { key: "cuttingSizeMm", label: "Cutting Size (mm)", type: "number", required: true },
      { key: "boardGsm", label: "B.GSM", type: "number", required: true },
      { key: "typeOfFlute", label: "Type of Flute", required: true },
      { key: "boardThickness", label: "Board Thickness", type: "number", required: true },
      { key: "moisture", label: "Moisture", type: "number", required: true },
      { key: "sheetWeightGrams", label: "Sheet Weight (Grams)", type: "number", required: true },
    ],
  },
  {
    title: "Remarks And References",
    fields: [{ key: "boardlineRemarks", label: "BOARDLINE REMARKS", type: "textarea", wide: true }],
  },
];


const FLUTE_OPTIONS = ["A", "C", "B", "E", "B+A", "B+C", "B+B"].map((value) => ({ value, label: value }));

function hasFormValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}


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
    bqcNo: "",
  };
}

function currentUserDisplayName(user: { name?: string; email?: string; userId?: string } | null | undefined) {
  return String(user?.name || user?.email || user?.userId || "System User").trim();
}

function nextQcNo<T extends Record<string, unknown>>(rows: T[], key: keyof T, prefix: string) {
  const highest = rows.reduce((max, row) => {
    const match = String(row[key] || "").match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(6, "0")}`;
}

function nextJobCheckNo(rows: BoardLineQcCheck[], jobNo: string) {
  const selectedJobNo = jobNo.trim();
  if (!selectedJobNo) return "";
  const highest = rows.reduce((max, row) => {
    if (String(row.jobNo || "").trim() !== selectedJobNo) return max;
    const parsed = Number(String(row.checkNo || "").trim());
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(highest + 1);
}

function hasAnyWarning(values: Array<unknown>) {
  return values.some((value) => String(value ?? "").trim() !== "");
}

function uniqueOptions(values: Array<unknown>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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

function toOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return "";
}

function toFiniteNumber(value: unknown): number | "" {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function parseFlapHeightFlap(value: unknown): [number | "", number | "", number | ""] {
  const parts = String(value || "")
    .split("-")
    .map((part) => toFiniteNumber(part.trim()));
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
}

function blankIfMissing(...values: unknown[]) {
  return values.some((value) => value === "" || value === null || value === undefined);
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

function calculateBoardLineForm(form: Partial<BoardLineQcCheck>): Partial<BoardLineQcCheck> {
  const heightOd = toFiniteNumber(form.heightOd);
  const ply = toFiniteNumber(form.ply);
  const width = toFiniteNumber(form.width);
  const length = toFiniteNumber(form.length);
  const part = toFiniteNumber(form.part);
  const cuttingSizeMm = toFiniteNumber(form.cuttingSizeMm);
  const planQty = toFiniteNumber(form.planQty);
  const qcPerson = String(form.qcPerson || "").trim();
  const [flapAchievedOs, heightAchievedOs, flapLAchievedOs] = parseFlapHeightFlap(form.flapHeightFlapOperatorSide);
  const [flapAchievedDs, heightAchievedDs, flapLAchievedDs] = parseFlapHeightFlap(form.flapHeightFlapDriveSide);
  const flap = isNumber(ply) && isNumber(width) ? (ply === 3 ? width / 2 : width / 2 + 1) : "";
  const flapMinDs = flap === "" ? "" : flap - 1;
  const flapMaxDs = flap === "" ? "" : flap + 1;
  const cuttingSizeRequired =
    isNumber(part) && isNumber(width) && isNumber(length) ? (part === 1 ? (length + width) * 2 + 30 : length + width + 30) : "";
  const standard = blankIfMissing(heightOd, flap) ? "" : `${flap} - ${heightOd} - ${flap}`;
  const samplingPlanQty = isNumber(planQty) ? (planQty / 2 < 2 ? 2 : planQty / 2000 > 4 ? 4 : 3) : "";
  const samplingCheckNo = String(form.checkNo || "").trim() && samplingPlanQty !== "" ? `${String(form.checkNo).trim()} / ${samplingPlanQty}` : "";
  const hasOsFlapInputs = isNumber(flapAchievedOs) && isNumber(flapMinDs) && isNumber(flapMaxDs) && qcPerson !== "";
  const hasOsHeightInputs = isNumber(heightAchievedOs) && isNumber(heightOd) && qcPerson !== "";
  const hasDsFlapInputs = isNumber(flapAchievedDs) && isNumber(flapMinDs) && isNumber(flapMaxDs) && qcPerson !== "";
  const hasDsHeightInputs = isNumber(heightAchievedDs) && isNumber(heightOd) && qcPerson !== "";
  const hasCuttingSizeInputs = isNumber(cuttingSizeMm) && isNumber(cuttingSizeRequired) && qcPerson !== "";

  return {
    ...form,
    standard,
    cuttingSizeRequired,
    flap,
    flapMinDs,
    flapMaxDs,
    flapAchievedOs,
    heightAchievedOs,
    flapLAchievedOs,
    flapAchievedDs,
    heightAchievedDs,
    flapLAchievedDs,
    samplingPlanQty,
    samplingCheckNo,
    systemAutoCorrection1:
      !hasOsFlapInputs || (flapAchievedOs >= flapMinDs && flapAchievedOs <= flapMaxDs)
        ? ""
        : `${qcPerson} - Wrong FLAP Size Achieved on Operator Side`,
    systemAutoCorrection2:
      !hasOsHeightInputs || (heightAchievedOs >= heightOd - 2 && heightAchievedOs <= heightOd + 2)
        ? ""
        : `${qcPerson} - Wrong HEIGHT Achieved on Operator Side`,
    systemAutoCorrection3:
      !hasDsFlapInputs || (flapAchievedDs >= flapMinDs && flapAchievedDs <= flapMaxDs)
        ? ""
        : `${qcPerson} - Wrong FLAP Size Achieved on Drive Side`,
    systemAutoCorrection4:
      !hasDsHeightInputs || (heightAchievedDs >= heightOd - 2 && heightAchievedDs <= heightOd + 2)
        ? ""
        : `${qcPerson} - Wrong HEIGHT Achieved on Drive Side`,
    systemAutoCorrection5:
      !hasCuttingSizeInputs || (cuttingSizeMm >= cuttingSizeRequired - 5 && cuttingSizeMm <= cuttingSizeRequired + 5)
        ? ""
        : `${qcPerson} - Wrong Cutting Size. Please Check`,
  };
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function buildFlapHeightValue(flap: number | "", height: number | "") {
  if (flap === "" || height === "") return "";
  return `${flap}-${height}-${flap}`;
}

function buildPayload(form: Partial<BoardLineQcCheck>, updatedBy: string): BoardLineQcCheck {
  const calculatedForm = calculateBoardLineForm(form);
  const timestampInput = String(form.timestamp || "").trim();
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

export function BoardLineQcForm() {
  const [checks, setChecks] = useData<BoardLineQcCheck>("boardline_qc_checks", []);
  const [productions] = useData<Production>("productions", []);
  const { findItemAcrossSources } = useOrderItemCatalog();
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<BoardLineQcCheck>>(createInitialForm);
  const [selectedProductionId, setSelectedProductionId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const qcPersonName = currentUserDisplayName(user);
  const nextBqcNo = useMemo(() => nextQcNo(checks, "bqcNo", "BQC"), [checks]);

  useEffect(() => {
    setForm((prev) => calculateBoardLineForm({ ...prev, qcPerson: qcPersonName, bqcNo: nextBqcNo }));
  }, [qcPersonName, nextBqcNo]);

  useEffect(() => {
    setForm((prev) => {
      const jobNo = String(prev.jobNo || "").trim();
      if (!jobNo) return prev;
      const checkNo = nextJobCheckNo(checks, jobNo);
      if (String(prev.checkNo || "") === checkNo) return prev;
      return calculateBoardLineForm({ ...prev, checkNo });
    });
  }, [checks]);

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
          String(b.date || b.updateTimestamp || b.transactionNo || "").localeCompare(
            String(a.date || a.updateTimestamp || a.transactionNo || "")
          )
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

  const setField = (key: keyof BoardLineQcCheck, value: string | number | "") => {
    setForm((prev) => calculateBoardLineForm({ ...prev, [key]: value }));
  };

  const handleJobSelect = (productionId: string) => {
    setSelectedProductionId(productionId);
    const production = productionById.get(productionId);
    if (!production) {
      setForm((prev) => ({ ...prev, jobNo: "", checkNo: "" }));
      return;
    }

    const item = findItemAcrossSources(
      String(production.itemId || production.npdId || ""),
      production.itemSource,
      production.erpCode || production.masterErp
    );
    const rawItem = item?.raw || {};
    const jobNo = String(production.transactionNo || production.jobCardNo || "").trim();
    const partyName = firstText(production.companyName, item?.companyName, rawItem.customerName, rawItem.customer);
    const itemName = firstText((production as any).itemName, item?.name, rawItem.itemName, rawItem.name);
    const erp = firstText(production.erpCode, production.masterErp, item?.erp, rawItem.erp, rawItem.erpCode);
    const ply = toOptionalNumber(production.ply, rawItem.ply, rawItem.noOfPly);
    const heightId = toOptionalNumber(rawItem.heightId, rawItem.hId, rawItem.height);
    const widthId = toOptionalNumber(rawItem.breadthId, rawItem.widthId, rawItem.wId, rawItem.width, rawItem.breadth);
    const lengthId = toOptionalNumber(rawItem.lengthId, rawItem.lId, rawItem.length);
    const height = isNumber(heightId) && isNumber(ply) ? heightId + ply : toOptionalNumber(production.height, rawItem.hOd, rawItem.heightOd);
    const width = isNumber(widthId) && isNumber(ply) ? widthId + ply : toOptionalNumber(production.breadth, rawItem.wOd, rawItem.widthOd);
    const length = isNumber(lengthId) && isNumber(ply) ? lengthId + ply : toOptionalNumber(production.length, rawItem.lOd, rawItem.lengthOd);
    const part = firstText(rawItem.part, rawItem.noOfParts, production.noOfParts);
    const boardGsm = toOptionalNumber(production.boardGsmReq, production.gsm, rawItem.boardGsmReq, rawItem.gsm, rawItem.calculatedBGsm, rawItem.standardBGsm);

    setForm((prev) =>
      calculateBoardLineForm({
        ...prev,
        jobNo,
        checkNo: nextJobCheckNo(checks, jobNo),
        partyName,
        itemName,
        erp,
        heightOd: height,
        width,
        length,
        ply,
        part,
        typeOfFlute: firstText(production.flute, production.fluteType, rawItem.flute),
        boardGsm,
        sheetWeightGrams: toOptionalNumber(production.sheetWeight, rawItem.sheetWeightGrams, rawItem.calculatedWeightPerBox),
        planQty: toOptionalNumber(production.plannedQty, production.qty, rawItem.planQty, rawItem.orderQuantity),
        printingArtwork: firstText(rawItem.artwork, rawItem.artworkUpload, prev.printingArtwork),
      })
    );
  };

  const requiredInputFields: Array<keyof BoardLineQcCheck> = [
    "flapHeightFlapOperatorSide",
    "flapHeightFlapDriveSide",
    "cuttingSizeMm",
    "boardGsm",
    "typeOfFlute",
    "boardThickness",
    "moisture",
    "sheetWeightGrams",
  ];

  const canSubmit = Boolean(
    hasFormValue(form.timestamp) &&
      hasFormValue(form.jobNo) &&
      hasFormValue(form.partyName) &&
      hasFormValue(form.itemName) &&
      hasFormValue(form.checkNo) &&
      FLUTE_OPTIONS.some((option) => option.value === String(form.typeOfFlute || "")) &&
      requiredInputFields.every((key) => hasFormValue(form[key])) &&
      qcPersonName
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const updatedBy = qcPersonName;
      const payload = buildPayload({ ...form, qcPerson: qcPersonName, bqcNo: nextBqcNo }, updatedBy);
      await setChecks((prev) => [...prev, payload]);
      setSelectedProductionId("");
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
        {formSections.map((section) => (
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
                ) : field.key === "typeOfFlute" ? (
                  <div key={String(field.key)} className={`flex flex-col space-y-1 ${field.wide ? "md:col-span-2 xl:col-span-3" : ""}`}>
                    <label className="font-bold text-black text-sm">
                      {field.label} {field.required ? <span className="text-red-600">*</span> : null}
                    </label>
                    <Select
                      options={FLUTE_OPTIONS}
                      value={String(form[field.key] || "")}
                      onChange={(value) => setField(field.key, value)}
                      required={field.required}
                      placeholder="Choose"
                    />
                  </div>
                ) : (
                  <FieldInput key={String(field.key)} field={field} value={field.key === "bqcNo" ? nextBqcNo : form[field.key]} onChange={setField} />
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
            {isSubmitting ? <Spinner size={24} className="text-white" /> : "Save QC Check"}
          </button>
        </div>
      </form>
    </div>
  );
}

const masterColumns: FieldConfig[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "bqcNo", label: "BQC No" },
  { key: "jobNo", label: "Job No." },
  { key: "partyName", label: "Party Name" },
  { key: "itemName", label: "Item Name" },
  { key: "checkNo", label: "Check No." },
  { key: "standard", label: "Standard" },
  { key: "qcPerson", label: "QC Person" },
  { key: "erp", label: "ERP", readOnly: true },
  { key: "boardlineRemarks", label: "Remarks" },
  ...allFields.filter(
    (field) =>
      ![
        "timestamp",
        "bqcNo",
        "jobNo",
        "partyName",
        "itemName",
        "checkNo",
        "standard",
        "qcPerson",
        "erp",
        "boardlineRemarks",
        "whatsapp",
        "column19",
        "column20",
      ].includes(String(field.key))
  ),
];
const compactMasterColumnKeys = new Set<keyof BoardLineQcCheck>([
  "timestamp",
  "bqcNo",
  "jobNo",
  "checkNo",
  "qcPerson",
  "erp",
]);

const wideMasterColumnKeys = new Set<keyof BoardLineQcCheck>([
  "partyName",
  "itemName",
  "standard",
  "boardlineRemarks",
  "systemAutoCorrection1",
  "systemAutoCorrection2",
  "systemAutoCorrection3",
  "systemAutoCorrection4",
  "systemAutoCorrection5",
  "previousCustomerComplaintWarning",
  "photo",
  "printingArtwork",
]);

function masterHeaderClass(key: keyof BoardLineQcCheck) {
  const base = "border border-black px-3 py-2 text-left text-xs font-bold uppercase text-black align-top";
  if (compactMasterColumnKeys.has(key)) return `${base} min-w-[96px] whitespace-nowrap`;
  if (wideMasterColumnKeys.has(key)) return `${base} min-w-[220px] max-w-[360px] whitespace-normal break-words leading-snug`;
  return `${base} min-w-[120px] whitespace-nowrap`;
}

function masterCellClass(key: keyof BoardLineQcCheck) {
  const base = "border border-black px-3 py-2 text-sm text-black align-top";
  if (compactMasterColumnKeys.has(key)) return `${base} min-w-[96px] whitespace-nowrap`;
  if (wideMasterColumnKeys.has(key)) return `${base} min-w-[220px] max-w-[360px] whitespace-normal break-words leading-snug`;
  return `${base} min-w-[120px] whitespace-nowrap`;
}

export function BoardLineQcMaster() {
  const [checks, , loading] = useData<BoardLineQcCheck>("boardline_qc_checks", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [qcPersonFilter, setQcPersonFilter] = useState("");
  const [warningFilter, setWarningFilter] = useState("All");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, jobFilter, partyFilter, qcPersonFilter, warningFilter, pageSize]);

  const filterOptions = useMemo(
    () => ({
      jobs: uniqueOptions(checks.map((row) => row.jobNo)),
      parties: uniqueOptions(checks.map((row) => row.partyName)),
      qcPeople: uniqueOptions(checks.map((row) => row.qcPerson)),
    }),
    [checks]
  );

  const rows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return [...checks]
      .sort((a, b) => {
        const timeA = new Date(a.timestamp || "").getTime() || 0;
        const timeB = new Date(b.timestamp || "").getTime() || 0;
        return timeB - timeA;
      })
      .filter((row) => {
        const warning = hasAnyWarning([
          row.systemAutoCorrection1,
          row.systemAutoCorrection2,
          row.systemAutoCorrection3,
          row.systemAutoCorrection4,
          row.systemAutoCorrection5,
        ]);
        if (jobFilter && String(row.jobNo) !== jobFilter) return false;
        if (partyFilter && String(row.partyName) !== partyFilter) return false;
        if (qcPersonFilter && String(row.qcPerson) !== qcPersonFilter) return false;
        if (warningFilter === "With Warning" && !warning) return false;
        if (warningFilter === "No Warning" && warning) return false;
        if (!search) return true;
        return [
          row.bqcNo,
          row.jobNo,
          row.partyName,
          row.itemName,
          row.checkNo,
          row.samplingCheckNo,
          row.erp,
          row.qcPerson,
          row.boardlineRemarks,
          row.systemAutoCorrection1,
          row.systemAutoCorrection2,
          row.systemAutoCorrection3,
          row.systemAutoCorrection4,
          row.systemAutoCorrection5,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      });
  }, [checks, jobFilter, partyFilter, qcPersonFilter, searchTerm, warningFilter]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-6 text-black">
      <div className="space-y-4 border-b border-black pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Board Line QC Master</h2>
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              placeholder="Search BQC, job, party, item, ERP..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded border border-black py-2 pl-10 pr-4 text-sm text-black focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <select value={jobFilter} onChange={(event) => setJobFilter(event.target.value)} className="rounded border border-black p-2 text-sm">
            <option value="">All Job No.</option>
            {filterOptions.jobs.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={partyFilter} onChange={(event) => setPartyFilter(event.target.value)} className="rounded border border-black p-2 text-sm">
            <option value="">All Party Name</option>
            {filterOptions.parties.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={qcPersonFilter} onChange={(event) => setQcPersonFilter(event.target.value)} className="rounded border border-black p-2 text-sm">
            <option value="">All QC Person</option>
            {filterOptions.qcPeople.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={warningFilter} onChange={(event) => setWarningFilter(event.target.value)} className="rounded border border-black p-2 text-sm">
            <option>All</option>
            <option>With Warning</option>
            <option>No Warning</option>
          </select>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded border border-black p-2 text-sm">
            {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} / page</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse divide-y divide-black border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
                {masterColumns.map((column) => (
                  <th key={String(column.key)} className={masterHeaderClass(column.key)}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {loading ? (
                <tr><td colSpan={masterColumns.length} className="px-6 py-8 text-center text-black">Loading QC checks...</td></tr>
              ) : pagedRows.length === 0 ? (
                <tr><td colSpan={masterColumns.length} className="px-6 py-8 text-center font-medium italic text-black">No Board Line QC checks found.</td></tr>
              ) : (
                pagedRows.map((row) => (
                  <tr key={row.id} className="divide-x divide-black transition-colors hover:bg-slate-50">
                    {masterColumns.map((column) => (
                      <td key={String(column.key)} className={masterCellClass(column.key)}>
                        {column.key === "timestamp" ? formatTimestamp(row.timestamp) : displayValue(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-black p-3 text-sm md:flex-row md:items-center md:justify-between">
          <span>Showing {rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, rows.length)} of {rows.length}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} className="rounded border border-black px-3 py-1 font-bold disabled:opacity-50">Previous</button>
            <span>Page {currentPage} / {totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage >= totalPages} className="rounded border border-black px-3 py-1 font-bold disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
