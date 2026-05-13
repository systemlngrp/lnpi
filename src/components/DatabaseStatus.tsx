import React, { useState, useEffect } from "react";
import { Database, AlertCircle, CheckCircle2, Loader2, Settings } from "lucide-react";
import { cn } from "../lib/utils";

export function DatabaseStatus() {
  const [status, setStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/db-status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setStatus({ connected: false, error: "Server connection failed" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    // Re-check every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 border border-slate-300 rounded text-xs text-slate-600">
        <Loader2 className="animate-spin" size={14} />
        <span>Checking DB...</span>
      </div>
    );
  }

  if (status?.connected) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-500 rounded text-xs text-emerald-700">
        <CheckCircle2 size={14} />
        <span className="font-medium">DB Connected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4 bg-amber-50 border border-amber-500 rounded shadow-md max-w-md">
      <div className="flex items-start gap-3">
        <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-amber-900 uppercase tracking-tight">Database Not Connected</h4>
          <p className="text-xs text-amber-800 leading-relaxed">
            {status?.error || "MySQL connection could not be established."}
          </p>
        </div>
      </div>
      <div className="pt-2 border-t border-amber-200 mt-1">
        <h5 className="text-[10px] font-bold text-amber-900 uppercase mb-2">How to fix:</h5>
        <ol className="text-[11px] text-amber-800 space-y-1 list-decimal list-inside">
          <li>Go to <strong>Settings (top right) &rarr; Secrets</strong></li>
          <li>Add <strong>DB_HOST, DB_USER, DB_NAME, DB_PASSWORD</strong></li>
          <li>
            For Hostinger, use the IP <code>82.112.228.35</code> if remote Access is enabled.
          </li>
          <li>Ensure "Remote MySQL" is enabled in Hostinger Panel.</li>
        </ol>
        <button 
          onClick={checkStatus}
          className="mt-3 w-full py-1.5 bg-amber-600 text-white rounded text-[10px] font-bold uppercase hover:bg-amber-700 transition"
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
