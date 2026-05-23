import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Setting } from "../types";

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Settings</h2>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl space-y-5">
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
      </div>
    </div>
  );
}
