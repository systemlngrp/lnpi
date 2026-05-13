import { useData } from "../hooks/useData";
import { MaterialIn, Production, Consumption, Item } from "../types";
import { Link } from "react-router-dom";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LabelList
} from 'recharts';
import { 
  Package, ShoppingCart, 
  Activity, UserCheck,
  TrendingDown, ChevronRight, Info
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from "../lib/utils";
import { useState } from "react";

export function Dashboard() {
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [items] = useData<Item>("items", []);

  const [dateRange, setDateRange] = useState({ 
    from: new Date().toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  // Calculate KPIs for Today
  const today = new Date();
  const matchToday = (dateStr: string) => {
    if (!dateStr) return false;
    // Extract YYYY-MM-DD part and split
    const isoDate = dateStr.split('T')[0];
    const [y, m, d] = isoDate.split("-").map(Number);
    return y === today.getFullYear() && (m - 1) === today.getMonth() && d === today.getDate();
  };

  const matInToday = materialIn.filter(m => matchToday(m.date)).reduce((acc, m) => acc + Number(m.totalAmount || 0), 0);
  const prodToday = productions.filter(p => matchToday(p.date)).reduce((acc, p) => acc + Number(p.qty || 0), 0);
  const consToday = consumptions.filter(c => matchToday(c.date)).reduce((acc, c) => acc + Number(c.qty || 0), 0);
  
  const pendingPH = materialIn.filter(m => isPendingPH(m.status)).length + 
                    productions.filter(p => isPendingPH(p.status)).length + 
                    consumptions.filter(c => isPendingPH(c.status)).length;

  const pendingAccounts = materialIn.filter(m => m.status === "Pending Accounts").length;
  const pendingMD = materialIn.filter(m => m.status === "Pending MD").length;
  const totalPendingApprovals = pendingPH + pendingAccounts + pendingMD;

  const tallyMatIn = materialIn.filter(m => m.status === "Pending Tally").length;
  const tallyProd = productions.filter(p => p.status === "Pending Tally").length;
  const tallyCons = consumptions.filter(c => c.status === "Pending Tally").length;

  // Hourly data for visualization
  const hourlyData = [
    { hour: '8:00', units: 38 },
    { hour: '9:00', units: 48 },
    { hour: '10:00', units: 62 },
    { hour: '11:00', units: 48 },
    { hour: '12:00', units: 72 },
    { hour: '13:00', units: 48 },
    { hour: '14:00', units: 90 },
    { hour: '15:00', units: 156 },
    { hour: '16:00', units: 120 },
    { hour: '17:00', units: 185 },
    { hour: '18:00', units: 128 },
    { hour: '19:00', units: 158 },
  ];

  // Top Lists
  const getTopItems = (data: any[], type: "prod" | "cons" | "pur") => {
    const stats: Record<string, number> = {};
    data.forEach(d => {
      const targetId = type === "pur" ? d.lines?.[0]?.itemId : d.itemId;
      if (!targetId) return;
      const itemName = items.find(i => i.id === targetId)?.name || "Unknown Item";
      stats[itemName] = (stats[itemName] || 0) + Number(d.qty || d.totalAmount || 0);
    });
    const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const max = entries[0]?.[1] || 1;
    return entries.map(([name, val]) => ({ name, percentage: Math.round((val / max) * 100) }));
  };

  const topProduced = getTopItems(productions, "prod");
  const topConsumed = getTopItems(consumptions, "cons");
  const topPurchased = getTopItems(materialIn, "pur");

  return (
    <div className="min-h-screen bg-white text-black font-sans p-4 md:p-8 space-y-10">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 border-b-4 border-black pb-8">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-black antialiased uppercase italic">Dashboard</h1>
          <p className="text-xs font-black text-black opacity-100 uppercase tracking-[0.25em] mt-2 underline decoration-4 decoration-black/10 transition-all hover:decoration-black">
            Real-time operations & inventory tracking system
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DateInput label="From" value={dateRange.from} onChange={v => setDateRange(p => ({ ...p, from: v }))} />
          <DateInput label="To" value={dateRange.to} onChange={v => setDateRange(p => ({ ...p, to: v }))} />
        </div>
      </div>

      {/* Main KPIs Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiBarCard 
          title="MATERIAL IN TODAY" 
          value={matInToday >= 100000 ? `₹${(matInToday / 100000).toFixed(2)}L` : formatCurrency(matInToday)} 
        />
        <KpiBarCard 
          title="PRODUCTION TODAY" 
          value={`${formatNumber(prodToday)} Units`} 
        />
        <KpiBarCard 
          title="CONSUMPTION TODAY" 
          value={`${formatNumber(consToday)} Units`} 
        />
        <KpiBarCard 
          title="PENDING APPROVALS" 
          value={totalPendingApprovals.toString()} 
        />
      </div>

      {/* Pending Approvals Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tight text-black uppercase">Pending Approvals</h2>
            <p className="text-[11px] font-black text-black uppercase tracking-widest opacity-80">Live workflow approval status</p>
          </div>
          <Link to="/plant-head" className="flex items-center gap-2 px-6 py-2.5 bg-black text-white text-[11px] font-black uppercase rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all">
            View All Tasks <ChevronRight size={14} strokeWidth={4} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <WorkflowCard label="PH Approval" count={pendingPH} total={pendingPH + 10} />
          <WorkflowCard label="Accounts Approval" count={pendingAccounts} total={pendingAccounts + 5} />
          <WorkflowCard label="MD Approval" count={pendingMD} total={pendingMD + 3} />
        </div>
      </section>

      {/* Pending Tally Entries Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b-2 border-black pb-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tight text-black uppercase">Tally Integration</h2>
            <p className="text-[11px] font-black text-black uppercase tracking-widest opacity-60">Transactions pending ERP synchronization</p>
          </div>
          <Link to="/material-in/pending-tally" className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-black text-black text-[11px] font-black uppercase rounded-none shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all">
            Manage Entries
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TallyCard label="MATERIAL IN" count={tallyMatIn} />
          <TallyCard label="PRODUCTION" count={tallyProd} />
          <TallyCard label="CONSUMPTION" count={tallyCons} />
        </div>
      </section>

      {/* Hourly Production Report */}
      <section className="bg-white p-8 rounded-none border-2 border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] space-y-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-3xl font-black tracking-tighter text-black uppercase leading-none italic">Hourly Output</h2>
            <p className="text-[11px] font-black text-black uppercase tracking-widest opacity-60">Current day production performance metrics</p>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2">
               <div className="w-4 h-4 bg-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]"></div>
               <span className="text-xs font-black text-black uppercase tracking-tight">Units Produced</span>
             </div>
          </div>
        </div>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={0}>
            <BarChart data={hourlyData} margin={{ top: 40, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="0" vertical={false} stroke="#000000" strokeOpacity={0.15} />
              <XAxis 
                dataKey="hour" 
                axisLine={{ stroke: '#000000', strokeWidth: 3 }} 
                tickLine={{ stroke: '#000000', strokeWidth: 3 }} 
                fontSize={11} 
                fontWeight={900} 
                tick={{ fill: '#000000' }} 
                dy={12}
              />
              <YAxis 
                axisLine={{ stroke: '#000000', strokeWidth: 3 }} 
                tickLine={{ stroke: '#000000', strokeWidth: 3 }} 
                fontSize={11} 
                fontWeight={900} 
                tick={{ fill: '#000000' }} 
              />
              <Tooltip 
                cursor={{ fill: '#000000', fillOpacity: 0.08 }}
                contentStyle={{ 
                  borderRadius: '0px', 
                  border: '3px solid #000000',
                  boxShadow: '6px 6px_0px_0px_rgba(0,0,0,1)',
                  fontSize: '12px',
                  fontWeight: '900',
                  padding: '16px',
                  textTransform: 'uppercase'
                }}
              />
              <Bar 
                dataKey="units" 
                fill="#000000" 
                radius={[0, 0, 0, 0]} 
                barSize={window.innerWidth > 1024 ? 60 : 32}
              >
                <LabelList 
                  dataKey="units" 
                  position="top" 
                  style={{ fill: '#000000', fontSize: '13px', fontWeight: '900' }} 
                  offset={15}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Rank Lists Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
        <RankList title="Top Produced" items={topProduced} />
        <RankList title="Top Consumed" items={topConsumed} />
        <RankList title="Top Purchased" items={topPurchased} />
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:bg-slate-50">
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-black uppercase tracking-tighter leading-none mb-1.5 opacity-60">{label} Date</span>
        <input 
          type="date" 
          className="text-sm font-black bg-transparent border-none p-0 focus:ring-0 leading-tight uppercase cursor-pointer" 
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function KpiBarCard({ title, value, icon, progress, growth }: {
  title: string;
  value: string;
  icon?: React.ReactNode;
  progress?: number;
  growth?: string;
}) {
  return (
    <div className="bg-white p-7 rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all hover:bg-slate-50 group hover:-translate-y-1">
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-3">
          <p className="text-[10px] font-black text-black uppercase tracking-[0.2em] leading-none opacity-60 group-hover:opacity-100 transition-opacity">{title}</p>
          <p className="text-3xl font-black text-black tracking-tighter leading-tight italic">{value}</p>
        </div>
        {(icon || growth) && (
          <div className="flex flex-col items-end gap-2">
            {icon && (
              <div className="p-3 bg-black text-white rounded-none border-2 border-black shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]">
                {icon}
              </div>
            )}
            {growth && (
              <span className={cn(
                "text-[10px] font-black px-2.5 py-1 rounded-none border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
                growth.startsWith('+') ? "text-emerald-700" : "text-rose-700"
              )}>{growth}</span>
            )}
          </div>
        )}
      </div>
      {typeof progress === 'number' && (
        <div className="w-full bg-slate-50 h-3.5 rounded-none border-2 border-black overflow-hidden relative shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)]">
          <div 
            className="h-full bg-black transition-all duration-[1.5s] ease-out relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ label, count, total }: { label: string; count: number; total: number }) {
  const percentage = total > 0 ? Math.min((count / total) * 100, 100) : 0;

  return (
    <div className="bg-white p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between transition-all hover:bg-slate-50 hover:-translate-y-1">
      <div className="space-y-3">
        <p className="text-[11px] font-black text-black uppercase tracking-[0.25em] opacity-60">{label}</p>
        <div className="flex flex-col">
          <span className="text-5xl font-black text-black leading-none tracking-tighter italic">{count}</span>
          <p className="text-[11px] font-black text-black uppercase mt-2 tracking-widest opacity-80 decoration-2 underline decoration-black/10">Pending Approval</p>
        </div>
      </div>
      <div className="relative h-20 w-20">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
          <path
            className="text-slate-100 stroke-current opacity-20"
            strokeWidth="5"
            strokeDasharray="1, 2"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            className="text-black stroke-current transition-all duration-[1.2s] ease-out shadow-lg"
            strokeWidth="5"
            strokeDasharray={`${percentage}, 100`}
            strokeLinecap="square"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>
        <div className="absolute inset-0 m-auto h-5 w-5 bg-black border-2 border-white shadow-[2px_2px_4px_rgba(0,0,0,0.2)]"></div>
      </div>
    </div>
  );
}

function TallyCard({ label, count }: { label: string; count: number }) {
  const progress = Math.min(count * 8.33, 100);

  return (
    <div className="bg-white p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between transition-all hover:bg-slate-50 hover:-translate-y-1">
      <div className="flex items-start justify-between mb-10">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-black text-white rounded-none border-2 border-black shadow-[2px_2px_0px_0px_rgba(255,255,255,0.4)]">
              <Activity size={16} />
            </div>
            <span className="text-[11px] font-black text-black uppercase tracking-[0.2em] leading-none">{label}</span>
          </div>
          <p className="text-5xl font-black text-black leading-none tracking-tighter italic">{count}</p>
        </div>
        <div className="bg-black text-white text-[10px] font-black uppercase px-4 py-1.5 rounded-none shadow-[3px_3px_0px_0px_rgba(0,0,0,0.25)] border border-black">
          Unposted
        </div>
      </div>
      <div className="w-full bg-slate-50 h-4 rounded-none border-2 border-black overflow-hidden relative shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)]">
        <div 
          className="h-full bg-black transition-all duration-[1s] ease-out"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
}

function RankList({ title, items }: { title: string; items: { name: string; percentage: number }[] }) {
  return (
    <div className="bg-white p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] space-y-10 flex flex-col justify-between transition-all hover:bg-slate-50">
      <div className="space-y-2 border-b-4 border-black pb-6">
        <h3 className="text-xl font-black text-black uppercase tracking-tighter italic">{title}</h3>
        <p className="text-[11px] font-black text-black opacity-60 uppercase tracking-widest leading-none">Performance indices</p>
      </div>
      <div className="space-y-10 flex-1">
        {items.map((item, idx) => (
          <div key={idx} className="space-y-3.5">
            <div className="flex justify-between items-center text-xs font-black uppercase tracking-wide text-black">
              <span className="truncate pr-6 leading-none">{item.name}</span>
              <span className="tabular-nums bg-black text-white px-2 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)]">{item.percentage}%</span>
            </div>
            <div className="w-full bg-slate-50 h-3 rounded-none border-2 border-black overflow-hidden relative shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)]">
              <div 
                className="h-full bg-black transition-all duration-[1.2s] ease-out"
                style={{ width: `${item.percentage}%` }}
              ></div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-14 flex flex-col items-center justify-center border-4 border-dashed border-black/10 transition-colors hover:border-black/20">
            <Info size={32} className="text-black opacity-10 mb-4" />
            <span className="text-[11px] font-black text-black opacity-30 uppercase tracking-[0.3em]">No Data Stream</span>
          </div>
        )}
      </div>
      <div className="pt-6 border-t-2 border-black">
        <button className="text-[11px] font-black text-black uppercase tracking-[0.25em] underline decoration-4 underline-offset-4 decoration-black/10 hover:decoration-black transition-all">
          Explore Metrics →
        </button>
      </div>
    </div>
  );
}
