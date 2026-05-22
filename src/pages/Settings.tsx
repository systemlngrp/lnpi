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
      "Uses TYPE wise reel logic. ROTARY TRAY uses Length (OD) + Height (OD), RSC uses FLAP + Height (OD) + FLAP, die cut sheet uses Open Width, and other types use Width (OD) or Height (OD) with UPS in place of No. of Outs.",
  },
];

export function SettingsPage() {
  const [settings, setSettings, loading] = useData<Setting>("settings", []);
  const [saving, setSaving] = useState(false);

  const currentSetting = settings[0];
  const selectedFormula = currentSetting?.reelAsPerCalculation || REEL_FORMULA_OPTIONS[0].value;
  const selectedOption = useMemo(
    () => REEL_FORMULA_OPTIONS.find((option) => option.value === selectedFormula) || REEL_FORMULA_OPTIONS[0],
    [selectedFormula]
  );

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const nextRow: Setting = {
        id: currentSetting?.id || crypto.randomUUID(),
        reelAsPerCalculation: value,
        updatedBy: "System User",
        updateTimestamp: timestamp,
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
            value={selectedFormula}
            onChange={(e) => void handleChange(e.target.value)}
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
            {selectedOption.description}
          </div>
          <div className="text-xs font-bold text-slate-500">
            {saving ? "Saving setting..." : "This selection is used by Production Form for new reel calculations."}
          </div>
        </div>
      </div>
    </div>
  );
}
