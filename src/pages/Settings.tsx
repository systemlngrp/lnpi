import { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Item, Machine, Setting } from "../types";
import { PRODUCTION_FORM_COLUMN_OPTIONS, parseProductionFormVisibleColumns } from "../lib/productionFormColumns";
import { Spinner } from "../components/Spinner";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { getFinancialYear } from "../lib/serial";

const REEL_FORMULA_OPTIONS = [
  {
    value: "breadth-height-based",
    label: "Breadth/Height Based Formula",
    description:
      "If Breadth is blank or 0, use Height x UPS. Otherwise use ((Breadth + Height) x UPS) + ((ID to OD x UPS) + 16).",
  },
  {
    value: "type-based",
    label: "TYPE Based Formula",
    description:
      "If TYPE = ROTARY TRAY: ((Length (OD) + Height (OD)) x UPS + 20) / 25.4. If TYPE = 2 PLY LINER, U/C PLATE, HORIZONTAL PLATE, or TRAY: ((Width (OD) x UPS) + 20) / 25.4. If TYPE = DIE CUT SHEET: ((Open Width x UPS) + 20) / 25.4. If TYPE = RSC: ((FLAP + Height (OD) + FLAP) x UPS + 20) / 25.4. For any other non-blank TYPE: ((Height (OD) x UPS) + 20) / 25.4.",
  },
];

const FLAP_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "If W (OD) is blank, keep FLAP blank. If PLY = 3, FLAP = half of Width (OD). Otherwise FLAP = half of Width (OD) + 1.",
  },
  {
    value: "type-based",
    label: "TYPE Based Logic",
    description:
      "If TYPE is VERTICAL PLATE, HORIZONTAL PLATE, or DIE CUT SHEET, keep FLAP blank. Otherwise calculate FLAP from Width (OD) based on Ply: for 3 Ply use half of Width (OD), for 5 Ply use half of Width (OD) + 1, for 7 Ply use half of Width (OD) + 2, and for 9 Ply use half of Width (OD) + 3.",
  },
];

const CUTTING_SIZE_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "If Breadth is blank or 0, use Length. If Number of Parts = 1, use ((Length + Breadth) x 2) + (ID to OD 17 x Number of Parts). If Number of Parts = 2, use Length + Breadth + ID to OD 17.",
  },
  {
    value: "type-based",
    label: "TYPE Based Logic",
    description:
      "If TYPE is 2 PLY ROLL, keep Cutting Size blank. If TYPE is DIE CUT SHEET, use ((Open Length x No. of ups in Cutting (For Plates)) + 20) / 25.4. If TYPE is RSC and PART is 1, use ((2 x (Length (OD) + Width (OD))) + 50) / 25.4. If TYPE is RSC and PART is 2, use ((Length (OD) + Width (OD)) + 50) / 25.4. In other filled cases, use ((Length (OD) x No. of ups in Cutting (For Plates)) + 20) / 25.4.",
  },
];

const GSM_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3.",
  },
  {
    value: "ply-based",
    label: "Ply Based Logic",
    description:
      "For 3 Ply: add Top, F1, B1, F2, and B2, then add 50% of F1 and 36% of F2. For 5 Ply: add Top, F1, B1, F2, and B2, then add 36% of F1 and 36% of F2. For 2 Ply: use the same 5 Ply weighting. For 7 Ply: add Top, F1, B1, F2, B2, F3, and B3, then add 36% each of F1, F2, and F3.",
  },
];

const DEFAULT_ITEM_TYPES = [
  "2 PLY LINER",
  "2 PLY ROLL",
  "DIE CUT SHEET",
  "HORIZONTAL PLATE",
  "PARTITION",
  "Paper",
  "ROTARY TRAY",
  "RSC",
  "U/C PLATE",
  "VERTICAL PLATE",
];

const MONTH_OPTIONS = [
  "All",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function SettingsPage() {
  const [settings, setSettings, loading] = useData<Setting>("settings", []);
  const [machines] = useData<Machine>("machines", []);
  const [items] = useData<Item>("items", []);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [organizationDraft, setOrganizationDraft] = useState({
    organizationName: "",
    organizationAddress: "",
    organizationGstDetails: "",
    organizationLogo: "",
  });

  const currentSetting = settings[0];

  const typeNames = useMemo(() => {
    const fromItems = items.map((item) => String(item.typeName || "").trim()).filter(Boolean);
    const fromSetting = Object.keys(parseMandatoryMachinesByType(currentSetting));
    return Array.from(new Set([...DEFAULT_ITEM_TYPES, ...fromItems, ...fromSetting]))
      .map((t) => t.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [currentSetting, items]);

  const machineNames = useMemo(() => {
    return Array.from(new Set(machines.map((m) => normalizeMachineName(m.name)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [machines]);

  const [mandatoryDraft, setMandatoryDraft] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setMandatoryDraft(parseMandatoryMachinesByType(currentSetting));
  }, [currentSetting?.mandatoryMachinesByType]);

  const fyOptions = useMemo(() => {
    const now = new Date();
    const baseStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const toFy = (startYear: number) => `${String(startYear % 100).padStart(2, "0")}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    return Array.from({ length: 8 }, (_, i) => toFy(baseStartYear - 5 + i));
  }, []);

  const realizationTargets = useMemo(() => {
    const raw = currentSetting?.realizationPerKgTargets;
    if (!raw) return [] as { fy: string; month: string; value: number }[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((row) => row && (typeof row.fy === "string" || typeof row.year === "string"))
        .map((row) => ({
          fy: String((row.fy ?? row.year) || "").trim(),
          month: String(row.month || "All").trim() || "All",
          value: Number(row.value || 0),
        }))
        .filter((row) => row.fy.length > 0)
        .sort((a, b) => a.fy.localeCompare(b.fy, undefined, { sensitivity: "base" }) || a.month.localeCompare(b.month));
    } catch {
      return [];
    }
  }, [currentSetting?.realizationPerKgTargets]);

  const [realizationDraft, setRealizationDraft] = useState<{ fy: string; month: string; value: number | "" }[]>([]);

  useEffect(() => {
    setRealizationDraft(
      realizationTargets.map((row) => ({
        fy: row.fy,
        month: MONTH_OPTIONS.includes(row.month) ? row.month : "All",
        value: Number(row.value || 0),
      }))
    );
  }, [realizationTargets]);
  const selectedReelFormula = currentSetting?.reelAsPerCalculation || REEL_FORMULA_OPTIONS[0].value;
  const selectedReelOption = useMemo(
    () => REEL_FORMULA_OPTIONS.find((option) => option.value === selectedReelFormula) || REEL_FORMULA_OPTIONS[0],
    [selectedReelFormula]
  );
  const selectedFlapFormula = currentSetting?.flapAsPerCalculation || FLAP_FORMULA_OPTIONS[0].value;
  const selectedFlapOption = useMemo(
    () => FLAP_FORMULA_OPTIONS.find((option) => option.value === selectedFlapFormula) || FLAP_FORMULA_OPTIONS[0],
    [selectedFlapFormula]
  );
  const selectedCuttingFormula = currentSetting?.cuttingSizeAsPerCalculation || CUTTING_SIZE_FORMULA_OPTIONS[0].value;
  const selectedCuttingOption = useMemo(
    () => CUTTING_SIZE_FORMULA_OPTIONS.find((option) => option.value === selectedCuttingFormula) || CUTTING_SIZE_FORMULA_OPTIONS[0],
    [selectedCuttingFormula]
  );
  const selectedGsmFormula = currentSetting?.gsmAsPerCalculation || GSM_FORMULA_OPTIONS[0].value;
  const selectedGsmOption = useMemo(
    () => GSM_FORMULA_OPTIONS.find((option) => option.value === selectedGsmFormula) || GSM_FORMULA_OPTIONS[0],
    [selectedGsmFormula]
  );
  const selectedProductionFormColumns = useMemo(
    () => parseProductionFormVisibleColumns(currentSetting?.productionFormVisibleColumns),
    [currentSetting?.productionFormVisibleColumns]
  );
  const organizationLogoUrl = useMemo(() => {
    if (!organizationDraft.organizationLogo) return "";
    const encoded = organizationDraft.organizationLogo.split("/").map(encodeURIComponent).join("/");
    if (typeof window === "undefined") return `/uploads/${encoded}`;
    return new URL(`/uploads/${encoded}`, window.location.origin).toString();
  }, [organizationDraft.organizationLogo]);
  const organizationValues = useMemo(
    () => ({
      organizationName: currentSetting?.organizationName || "",
      organizationAddress: currentSetting?.organizationAddress || "",
      organizationGstDetails: currentSetting?.organizationGstDetails || "",
      organizationLogo: currentSetting?.organizationLogo || "",
    }),
    [
      currentSetting?.organizationAddress,
      currentSetting?.organizationGstDetails,
      currentSetting?.organizationLogo,
      currentSetting?.organizationName,
    ]
  );

  useEffect(() => {
    setOrganizationDraft(organizationValues);
  }, [organizationValues]);

  const hasOrganizationContent = useMemo(
    () =>
      Boolean(
        organizationDraft.organizationName.trim() ||
        organizationDraft.organizationAddress.trim() ||
        organizationDraft.organizationGstDetails.trim() ||
        organizationDraft.organizationLogo
      ),
    [organizationDraft]
  );

  const hasOrganizationChanges = useMemo(
    () =>
      organizationDraft.organizationName !== organizationValues.organizationName ||
      organizationDraft.organizationAddress !== organizationValues.organizationAddress ||
      organizationDraft.organizationGstDetails !== organizationValues.organizationGstDetails ||
      organizationDraft.organizationLogo !== organizationValues.organizationLogo,
    [organizationDraft, organizationValues]
  );

  const handleChange = async (patch: Partial<Setting>) => {
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const nextRow: Setting = {
        id: currentSetting?.id || crypto.randomUUID(),
        reelAsPerCalculation: currentSetting?.reelAsPerCalculation || REEL_FORMULA_OPTIONS[0].value,
        flapAsPerCalculation: currentSetting?.flapAsPerCalculation || FLAP_FORMULA_OPTIONS[0].value,
        cuttingSizeAsPerCalculation: currentSetting?.cuttingSizeAsPerCalculation || CUTTING_SIZE_FORMULA_OPTIONS[0].value,
        gsmAsPerCalculation: currentSetting?.gsmAsPerCalculation || GSM_FORMULA_OPTIONS[0].value,
        productionFormVisibleColumns: currentSetting?.productionFormVisibleColumns || JSON.stringify(PRODUCTION_FORM_COLUMN_OPTIONS),
        realizationPerKgTargets: currentSetting?.realizationPerKgTargets || JSON.stringify([]),
        mandatoryMachinesByType: currentSetting?.mandatoryMachinesByType || JSON.stringify({}),
        organizationName: currentSetting?.organizationName || "",
        organizationAddress: currentSetting?.organizationAddress || "",
        organizationGstDetails: currentSetting?.organizationGstDetails || "",
        organizationLogo: currentSetting?.organizationLogo || "",
        updatedBy: "System User",
        updateTimestamp: timestamp,
        ...patch,
      };

      await setSettings(currentSetting ? [nextRow, ...settings.slice(1)] : [nextRow]);
    } catch (error) {
      console.error("Failed to save setting:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File size exceeds 10MB. Please upload a smaller logo.");
      return;
    }

    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const token = window.localStorage.getItem("authToken");
        const response = await fetch("/api/upload-artwork", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ base64, filename: file.name }),
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const result = await response.json();
        setOrganizationDraft((prev) => ({ ...prev, organizationLogo: result.filename }));
      } catch (error) {
        console.error("Failed to upload organization logo:", error);
        alert("Failed to upload logo.");
      } finally {
        setUploadingLogo(false);
        event.target.value = "";
      }
    };

    reader.readAsDataURL(file);
  };

  const handleOrganizationSave = async () => {
    if (!hasOrganizationContent || !hasOrganizationChanges) return;
    await handleChange({
      organizationName: organizationDraft.organizationName,
      organizationAddress: organizationDraft.organizationAddress,
      organizationGstDetails: organizationDraft.organizationGstDetails,
      organizationLogo: organizationDraft.organizationLogo,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Settings</h2>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl space-y-5">
        <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Realization Setup (Year wise)</h3>
            <p className="text-sm text-black leading-6">
              Store year-wise target values for Realization/KG (used for reporting/benchmarking).
            </p>
          </div>

          <div className="overflow-x-auto border border-black rounded">
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">FY</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Month</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Target Real/KG</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-black">
                {realizationDraft.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-sm text-slate-500 text-center">
                      No realization targets configured.
                    </td>
                  </tr>
                ) : (
                  realizationDraft.map((row, idx) => (
                    <tr key={`${row.fy}-${row.month}-${idx}`} className="divide-x divide-black">
                      <td className="px-4 py-2 border border-black">
                        <select
                          value={row.fy}
                          onChange={(e) =>
                            setRealizationDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, fy: e.target.value } : r)))
                          }
                          disabled={loading || saving}
                          className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                        >
                          {fyOptions.map((fy) => (
                            <option key={fy} value={fy}>
                              {fy}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 border border-black">
                        <select
                          value={row.month}
                          onChange={(e) =>
                            setRealizationDraft((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, month: e.target.value } : r))
                            )
                          }
                          disabled={loading || saving}
                          className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                        >
                          {MONTH_OPTIONS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 border border-black text-right">
                        <input
                          type="number"
                          value={row.value}
                          onChange={(e) =>
                            setRealizationDraft((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, value: e.target.value === "" ? "" : Number(e.target.value) } : r
                              )
                            )
                          }
                          disabled={loading || saving}
                          className="w-32 border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none text-right"
                          step={0.01}
                          min={0}
                        />
                      </td>
                      <td className="px-4 py-2 border border-black text-right">
                        <button
                          type="button"
                          onClick={() => setRealizationDraft((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={loading || saving}
                          className="px-3 py-1 border-2 border-black rounded bg-white text-black text-xs font-bold hover:bg-slate-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setRealizationDraft((prev) => [
                  ...prev,
                  { fy: getFinancialYear(new Date().toISOString()), month: "All", value: "" },
                ])
              }
              disabled={loading || saving}
              className="bg-white text-black border-2 border-black px-4 py-2 rounded font-bold hover:bg-slate-50 transition shadow-sm"
            >
              Add FY/Month
            </button>
            <button
              type="button"
              onClick={() => {
                const cleaned = realizationDraft
                  .map((row) => ({
                    fy: String(row.fy || "").trim(),
                    month: MONTH_OPTIONS.includes(String(row.month || "").trim()) ? String(row.month || "").trim() : "All",
                    value: Number(row.value || 0),
                  }))
                  .filter((row) => row.fy.length > 0);
                void handleChange({ realizationPerKgTargets: JSON.stringify(cleaned) });
              }}
              disabled={loading || saving}
              className="bg-emerald-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
            >
              {saving ? <Spinner size={18} className="text-white" /> : "Save Realization Setup"}
            </button>
          </div>
        </div>

        <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Mandatory Machines By Type</h3>
            <p className="text-sm text-black leading-6">
              Select which machine entries are mandatory (Production Processing) for each item TYPE. These selections can be used to
              control pending/workflow visibility.
            </p>
          </div>

          {typeNames.length === 0 ? (
            <div className="rounded border border-black bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No TYPE values found in Items master.
            </div>
          ) : machineNames.length === 0 ? (
            <div className="rounded border border-black bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No Machines found. Add machines first in Masters → Machines.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {typeNames.map((typeName) => {
                const selected = new Set(mandatoryDraft[typeName] || []);
                return (
                  <div key={typeName} className="rounded-xl border-2 border-black bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Type</div>
                        <div className="mt-1 text-sm font-black text-black">{typeName}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMandatoryDraft((prev) => {
                            const next = { ...prev };
                            delete next[typeName];
                            return next;
                          })
                        }
                        disabled={saving || loading}
                        className="text-xs font-black uppercase tracking-wide text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded border border-black bg-slate-50 p-3">
                      {machineNames.map((machineName) => {
                        const checked = selected.has(machineName);
                        return (
                          <label key={machineName} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span className="font-semibold text-slate-800">{machineName}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setMandatoryDraft((prev) => {
                                  const current = new Set(prev[typeName] || []);
                                  if (nextChecked) current.add(machineName);
                                  else current.delete(machineName);
                                  return { ...prev, [typeName]: Array.from(current).sort((a, b) => a.localeCompare(b)) };
                                });
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Selected: {selected.size}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleChange({ mandatoryMachinesByType: JSON.stringify(mandatoryDraft) })}
              disabled={loading || saving}
              className="bg-indigo-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
            >
              {saving ? <Spinner size={18} className="text-white" /> : "Save Mandatory Machines"}
            </button>
          </div>
        </div>

        <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Organization Details</h3>
            <p className="text-sm text-black leading-6">
              These details can be used as the centered header section in generated PDFs such as indent documents.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationName" className="text-xs font-black uppercase tracking-wide text-black">
                Organization Name
              </label>
              <input
                id="organizationName"
                type="text"
                value={organizationDraft.organizationName}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationName: e.target.value }))}
                disabled={loading || saving}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationAddress" className="text-xs font-black uppercase tracking-wide text-black">
                Organization Address
              </label>
              <textarea
                id="organizationAddress"
                value={organizationDraft.organizationAddress}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationAddress: e.target.value }))}
                disabled={loading || saving}
                rows={3}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white resize-y"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationGstDetails" className="text-xs font-black uppercase tracking-wide text-black">
                Organization GST Details
              </label>
              <textarea
                id="organizationGstDetails"
                value={organizationDraft.organizationGstDetails}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationGstDetails: e.target.value }))}
                disabled={loading || saving}
                rows={2}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white resize-y"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label className="text-xs font-black uppercase tracking-wide text-black">Organization Logo</label>
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <label className="inline-flex cursor-pointer items-center justify-center rounded border border-black bg-white px-4 py-2 text-sm font-bold text-black hover:bg-slate-50 transition">
                  {uploadingLogo ? <Spinner size={16} /> : "Upload Logo"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={loading || saving || uploadingLogo}
                    className="hidden"
                  />
                </label>
                {organizationDraft.organizationLogo ? (
                  <div className="space-y-2">
                    <div className="flex min-h-[96px] min-w-[220px] items-center justify-center rounded border border-black bg-slate-50 p-3">
                      <img
                        src={organizationLogoUrl}
                        alt="Organization logo"
                        className="max-h-20 max-w-[220px] object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setOrganizationDraft((prev) => ({ ...prev, organizationLogo: "" }))}
                      disabled={loading || saving || uploadingLogo}
                      className="text-xs font-bold uppercase tracking-wide text-red-700 hover:text-red-900 disabled:opacity-50"
                    >
                      Remove Logo
                    </button>
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-black bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    No logo uploaded yet.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end md:col-span-2">
              <button
                type="button"
                onClick={() => void handleOrganizationSave()}
                disabled={loading || saving || uploadingLogo || !hasOrganizationContent || !hasOrganizationChanges}
                className="inline-flex items-center justify-center min-w-[170px] rounded bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {saving ? <Spinner size={16} className="text-white" /> : "Save Organization"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Production Formula Control</h3>
          <p className="text-sm text-black leading-6">
            Choose which formula the Production Form should use to calculate <span className="font-bold">Reel As per Calculation</span>.
          </p>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="reelAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Reel As per Calculation
          </label>
          <select
            id="reelAsPerCalculation"
            value={selectedReelFormula}
            onChange={(e) => void handleChange({ reelAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {REEL_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedReelOption.description}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="flapAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Flap
          </label>
          <select
            id="flapAsPerCalculation"
            value={selectedFlapFormula}
            onChange={(e) => void handleChange({ flapAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {FLAP_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedFlapOption.description}
          </div>
          <div className="text-xs font-bold text-slate-500">
            {saving ? "Saving setting..." : "These selections are used by Item Form and Production Form for new calculations."}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="cuttingSizeAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Cutting Size
          </label>
          <select
            id="cuttingSizeAsPerCalculation"
            value={selectedCuttingFormula}
            onChange={(e) => void handleChange({ cuttingSizeAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {CUTTING_SIZE_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedCuttingOption.description}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="gsmAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            GSM
          </label>
          <select
            id="gsmAsPerCalculation"
            value={selectedGsmFormula}
            onChange={(e) => void handleChange({ gsmAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {GSM_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedGsmOption.description}
          </div>
        </div>

        <div className="space-y-3 border-t border-dashed border-black pt-4">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wide text-black">Production Form Column Visibility</h3>
            <p className="text-sm text-black leading-6 mt-1">
              Choose which columns should stay visible in the Production Form. Unchecked columns will be hidden from the form view only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleChange({ productionFormVisibleColumns: JSON.stringify(PRODUCTION_FORM_COLUMN_OPTIONS) })}
              disabled={loading || saving}
              className="border border-black bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-slate-100 disabled:opacity-50"
            >
              Show All
            </button>
            <button
              type="button"
              onClick={() => void handleChange({ productionFormVisibleColumns: JSON.stringify([]) })}
              disabled={loading || saving}
              className="border border-black bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-slate-100 disabled:opacity-50"
            >
              Hide All
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded border border-black bg-slate-50 p-3 max-h-[420px] overflow-y-auto">
            {PRODUCTION_FORM_COLUMN_OPTIONS.map((column) => {
              const checked = selectedProductionFormColumns.includes(column);
              return (
                <label key={column} className="flex items-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-medium text-black">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const nextColumns = e.target.checked
                        ? [...selectedProductionFormColumns, column]
                        : selectedProductionFormColumns.filter((value) => value !== column);
                      void handleChange({ productionFormVisibleColumns: JSON.stringify(nextColumns) });
                    }}
                    disabled={loading || saving}
                    className="h-4 w-4 border-black"
                  />
                  <span>{column}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
