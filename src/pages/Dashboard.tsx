import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronRight, Info } from "lucide-react";
import { useData } from "../hooks/useData";
import { Consumption, Item, MaterialIn, Production } from "../types";
import { formatNumber } from "../lib/utils";

type Range = {
  from: string;
  to: string;
};

export function Dashboard() {
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [items] = useData<Item>("items", []);

  const today = getLocalDateInputValue(new Date());
  const [dateRange, setDateRange] = useState<Range>({ from: today, to: today });

  const parseAppDate = (dateStr?: string | null) => {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split("/").map(Number);
      return new Date(year, month - 1, day);
    }

    const datePartMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (datePartMatch) {
      const [, year, month, day] = datePartMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split("/").map(Number);
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const normalizeDateValue = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const getSafeRange = () => {
    const from = parseAppDate(dateRange.from);
    const to = parseAppDate(dateRange.to);
    if (!from || !to) return null;

    const fromTime = normalizeDateValue(from);
    const toTime = normalizeDateValue(to);
    return fromTime <= toTime
      ? { fromTime, toTime }
      : { fromTime: toTime, toTime: fromTime };
  };

  const safeRange = getSafeRange();

  const isWithinSelectedRange = (dateStr?: string) => {
    const parsed = parseAppDate(dateStr);
    if (!parsed || !safeRange) return false;

    const target = normalizeDateValue(parsed);
    return target >= safeRange.fromTime && target <= safeRange.toTime;
  };

  const filteredMaterialIn = materialIn.filter((entry) => isWithinSelectedRange(entry.date));
  const filteredProductions = productions.filter((entry) => isWithinSelectedRange(entry.date));
  const filteredConsumptions = consumptions.filter((entry) => isWithinSelectedRange(entry.date));

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  const materialInCount = filteredMaterialIn.length;
  const productionCount = filteredProductions.length;
  const consumptionCount = filteredConsumptions.length;

  const pendingPH =
    filteredMaterialIn.filter((entry) => isPendingPH(entry.status)).length +
    filteredProductions.filter((entry) => isPendingPH(entry.status)).length +
    filteredConsumptions.filter((entry) => isPendingPH(entry.status)).length;

  const pendingAccounts = filteredMaterialIn.filter((entry) => entry.status === "Pending Accounts").length;
  const pendingMD = filteredMaterialIn.filter((entry) => entry.status === "Pending MD").length;

  const tallyMatIn = filteredMaterialIn.filter((entry) => entry.status === "Pending Tally").length;
  const tallyProd = filteredProductions.filter((entry) => entry.status === "Pending Tally").length;
  const tallyCons = filteredConsumptions.filter((entry) => entry.status === "Pending Tally").length;

  const hourlyTotals = filteredProductions.reduce<Record<string, number>>((acc, entry) => {
    const timestamp = parseTimestamp(entry.updateTimestamp || entry.date);
    if (!timestamp) return acc;

    const hourLabel = `${String(timestamp.getHours()).padStart(2, "0")}:00`;
    acc[hourLabel] = (acc[hourLabel] || 0) + Number(entry.qty || 0);
    return acc;
  }, {});

  const hasHourlyData = Object.keys(hourlyTotals).length > 0;
  const hourlyData = (hasHourlyData
    ? Object.keys(hourlyTotals)
        .sort((a, b) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)))
        .map((hour) => ({ hour, units: hourlyTotals[hour] || 0 }))
    : []
  );

  const getTopItems = (data: Array<Production | Consumption | MaterialIn>, type: "prod" | "cons" | "pur") => {
    const stats: Record<string, number> = {};

    data.forEach((entry) => {
      const targetId = type === "pur" ? (entry as MaterialIn).lines?.[0]?.itemId : (entry as Production | Consumption).itemId;
      if (!targetId) return;

      const itemName = items.find((item) => item.id === targetId)?.name || "Unknown Item";
      const amount = type === "pur" ? Number((entry as MaterialIn).totalAmount || 0) : Number((entry as Production | Consumption).qty || 0);
      stats[itemName] = (stats[itemName] || 0) + amount;
    });

    const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const max = entries[0]?.[1] || 1;
    return entries.map(([name, value]) => ({
      name,
      percentage: Math.round((value / max) * 100),
    }));
  };

  const topProduced = getTopItems(filteredProductions, "prod");
  const topConsumed = getTopItems(filteredConsumptions, "cons");
  const topPurchased = getTopItems(filteredMaterialIn, "pur");

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf5_0%,#eef6ff_45%,#f6f0ff_100%)] text-black font-sans p-4 md:p-8 space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 border-b-4 border-black pb-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-black uppercase italic">LNPI ERP</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DateInput label="From" value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
          <DateInput label="To" value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard title="Material In" value={formatNumber(materialInCount)} accent="from-[#ffd54f] to-[#ffb300]" />
        <KpiCard title="Production" value={formatNumber(productionCount)} accent="from-[#4dd0e1] to-[#0288d1]" />
        <KpiCard title="Consumption" value={formatNumber(consumptionCount)} accent="from-[#ff8a80] to-[#e53935]" />
        <KpiCard title="Pending Approvals" value={formatNumber(pendingPH + pendingAccounts + pendingMD)} accent="from-[#c5e1a5] to-[#7cb342]" />
      </div>

      <section className="space-y-5">
        <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <h2 className="text-2xl font-black tracking-tight text-black uppercase">Pending Approvals</h2>
          <Link
            to="/plant-head"
            className="flex items-center gap-2 px-5 py-2 bg-black text-white text-[11px] font-black uppercase rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all"
          >
            View All Tasks <ChevronRight size={14} strokeWidth={4} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <WorkflowCard label="PH Approval" count={pendingPH} tone="bg-[#fff3cd]" />
          <WorkflowCard label="Accounts Approval" count={pendingAccounts} tone="bg-[#d9f2ff]" />
          <WorkflowCard label="MD Approval" count={pendingMD} tone="bg-[#f3e5f5]" />
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <h2 className="text-2xl font-black tracking-tight text-black uppercase">Tally Integration</h2>
          <Link
            to="/material-in/pending-tally"
            className="flex items-center gap-2 px-5 py-2 bg-white text-black text-[11px] font-black uppercase rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all"
          >
            Manage Entries
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TallyCard label="Material In" count={tallyMatIn} tone="bg-[#ffe0b2]" />
          <TallyCard label="Production" count={tallyProd} tone="bg-[#d1f2eb]" />
          <TallyCard label="Consumption" count={tallyCons} tone="bg-[#f8bbd0]" />
        </div>
      </section>

      <section className="bg-white/90 p-8 rounded-none border-2 border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] space-y-8">
        <h2 className="text-3xl font-black tracking-tighter text-black uppercase leading-none italic">Hourly Output</h2>
        <div className="h-[400px] w-full">
          {hasHourlyData ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={0}>
              <BarChart data={hourlyData} margin={{ top: 30, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#000000" strokeOpacity={0.15} />
                <XAxis
                  dataKey="hour"
                  axisLine={{ stroke: "#000000", strokeWidth: 3 }}
                  tickLine={{ stroke: "#000000", strokeWidth: 3 }}
                  fontSize={11}
                  fontWeight={900}
                  tick={{ fill: "#000000" }}
                  dy={12}
                />
                <YAxis
                  axisLine={{ stroke: "#000000", strokeWidth: 3 }}
                  tickLine={{ stroke: "#000000", strokeWidth: 3 }}
                  fontSize={11}
                  fontWeight={900}
                  tick={{ fill: "#000000" }}
                />
                <Tooltip
                  cursor={{ fill: "#000000", fillOpacity: 0.08 }}
                  contentStyle={{
                    borderRadius: "0px",
                    border: "3px solid #000000",
                    boxShadow: "6px 6px 0px 0px rgba(0,0,0,1)",
                    fontSize: "12px",
                    fontWeight: "900",
                    padding: "16px",
                    textTransform: "uppercase",
                  }}
                />
                <Bar dataKey="units" fill="#2563eb" radius={[0, 0, 0, 0]} barSize={window.innerWidth > 1024 ? 60 : 32}>
                  <LabelList dataKey="units" position="top" style={{ fill: "#000000", fontSize: "13px", fontWeight: "900" }} offset={15} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center border-4 border-dashed border-black/10">
              <span className="text-sm font-black uppercase tracking-[0.25em] text-black/40">No production records in selected range</span>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
        <RankList title="Top Produced" items={topProduced} tone="bg-[#fff8e1]" />
        <RankList title="Top Consumed" items={topConsumed} tone="bg-[#e8f5e9]" />
        <RankList title="Top Purchased" items={topPurchased} tone="bg-[#fce4ec]" />
      </div>
    </div>
  );
}

function getLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-black uppercase tracking-tighter leading-none mb-1.5 opacity-60">{label}</span>
        <input
          type="date"
          className="text-sm font-black bg-transparent border-none p-0 focus:ring-0 leading-tight uppercase cursor-pointer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function KpiCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div className="rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden bg-white">
      <div className={`h-4 bg-gradient-to-r ${accent}`} />
      <div className="p-7">
        <p className="text-[10px] font-black text-black uppercase tracking-[0.22em] leading-none opacity-60">{title}</p>
        <p className="mt-5 text-4xl font-black text-black tracking-tighter leading-none italic">{value}</p>
      </div>
    </div>
  );
}

function WorkflowCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1`}>
      <p className="text-[11px] font-black text-black uppercase tracking-[0.25em] opacity-70">{label}</p>
      <span className="mt-4 block text-6xl font-black text-black leading-none tracking-tighter italic">{count}</span>
    </div>
  );
}

function TallyCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1`}>
      <p className="text-[11px] font-black text-black uppercase tracking-[0.22em] opacity-70">{label}</p>
      <span className="mt-4 block text-6xl font-black text-black leading-none tracking-tighter italic">{count}</span>
    </div>
  );
}

function RankList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { name: string; percentage: number }[];
  tone: string;
}) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] space-y-8 transition-all`}>
      <div className="space-y-2 border-b-4 border-black pb-6">
        <h3 className="text-xl font-black text-black uppercase tracking-tighter italic">{title}</h3>
      </div>
      <div className="space-y-8">
        {items.map((item, index) => (
          <div key={index} className="space-y-3">
            <div className="flex justify-between items-center text-xs font-black uppercase tracking-wide text-black gap-4">
              <span className="truncate leading-none">{item.name}</span>
              <span className="tabular-nums bg-black text-white px-2 py-0.5">{item.percentage}%</span>
            </div>
            <div className="w-full bg-white/70 h-3 rounded-none border-2 border-black overflow-hidden">
              <div className="h-full bg-black transition-all duration-[1.2s] ease-out" style={{ width: `${item.percentage}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-14 flex flex-col items-center justify-center border-4 border-dashed border-black/10 transition-colors">
            <Info size={32} className="text-black opacity-10 mb-4" />
            <span className="text-[11px] font-black text-black opacity-30 uppercase tracking-[0.3em]">No Data</span>
          </div>
        )}
      </div>
    </div>
  );
}
