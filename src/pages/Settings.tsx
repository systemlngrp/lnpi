import { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Setting } from "../types";
import { PRODUCTION_FORM_COLUMN_OPTIONS, parseProductionFormVisibleColumns } from "../lib/productionFormColumns";
import { Spinner } from "../components/Spinner";

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

export function SettingsPage() {
  const [settings, setSettings, loading] = useData<Setting>("settings", []);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [organizationDraft, setOrganizationDraft] = useState({
    organizationName: "",
    organizationAddress: "",
    organizationGstDetails: "",
  });

  const currentSetting = settings[0];
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
    if (!currentSetting?.organizationLogo) return "";
    const encoded = currentSetting.organizationLogo.split("/").map(encodeURIComponent).join("/");
    if (typeof window === "undefined") return `/uploads/${encoded}`;
    return new URL(`/uploads/${encoded}`, window.location.origin).toString();
  }, [currentSetting?.organizationLogo]);
  const organizationValues = useMemo(
    () => ({
      organizationName: currentSetting?.organizationName || "",
      organizationAddress: currentSetting?.organizationAddress || "",
      organizationGstDetails: currentSetting?.organizationGstDetails || "",
    }),
    [currentSetting?.organizationAddress, currentSetting?.organizationGstDetails, currentSetting?.organizationName]
  );

  useEffect(() => {
    setOrganizationDraft(organizationValues);
  }, [organizationValues]);

  const hasOrganizationContent = useMemo(
    () =>
      Boolean(
        organizationDraft.organizationName.trim() ||
        organizationDraft.organizationAddress.trim() ||
        organizationDraft.organizationGstDetails.trim()
      ),
    [organizationDraft]
  );

  const hasOrganizationChanges = useMemo(
    () =>
      organizationDraft.organizationName !== organizationValues.organizationName ||
      organizationDraft.organizationAddress !== organizationValues.organizationAddress ||
      organizationDraft.organizationGstDetails !== organizationValues.organizationGstDetails,
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
        const response = await fetch("/api/upload-artwork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, filename: file.name }),
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const result = await response.json();
        await handleChange({ organizationLogo: result.filename });
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
                {currentSetting?.organizationLogo ? (
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
                      onClick={() => void handleChange({ organizationLogo: "" })}
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
