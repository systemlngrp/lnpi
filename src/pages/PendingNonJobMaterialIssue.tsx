import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { MaterialIssue, Production } from "../types";
import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";

function normalizeDate(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function PendingNonJobMaterialIssue() {
  const navigate = useNavigate();
  const [productions] = useData<Production>("productions", []);
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [markingDate, setMarkingDate] = useState<string | null>(null);
  const [notApplicableDate, setNotApplicableDate] = useState<string | null>(null);
  const [notApplicableRemarks, setNotApplicableRemarks] = useState("");
  const [notApplicableError, setNotApplicableError] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  const firstJobDate = useMemo(() => {
    const dates = productions
      .map((p) => normalizeDate(p.date))
      .filter(Boolean)
      .sort();
    return dates[0] || "";
  }, [productions]);

  const pendingDates = useMemo(() => {
    if (!firstJobDate) return [];

    const issuesByDate = new Set(
      materialIssues
        .filter((i) => isWithoutJobIssue(i.issueType))
        .map((i) => normalizeDate(i.date))
        .filter(Boolean)
    );

    const dates: string[] = [];
    let cursor = firstJobDate;
    while (cursor <= today) {
      if (!issuesByDate.has(cursor)) dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }, [firstJobDate, materialIssues, today]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return pendingDates;
    return pendingDates.filter((d) => d.toLowerCase().includes(q));
  }, [pendingDates, searchTerm]);

  const openForm = (date: string) => {
    const params = new URLSearchParams({
      date,
      issueType: "Without Job",
      lockDate: "1",
      lockIssueType: "1",
    });
    navigate(`/material-movement/issue?${params.toString()}`);
  };
  const openNotApplicableModal = (date: string) => {
    setNotApplicableDate(date);
    setNotApplicableRemarks("");
    setNotApplicableError("");
  };

  const closeNotApplicableModal = () => {
    if (markingDate) return;
    setNotApplicableDate(null);
    setNotApplicableRemarks("");
    setNotApplicableError("");
  };

  const markNotApplicable = async () => {
    if (!notApplicableDate) return;
    const reason = notApplicableRemarks.trim();
    if (!reason) {
      setNotApplicableError("Remarks are mandatory for Not Applicable.");
      return;
    }

    const timestamp = new Date().toISOString();
    const issue: MaterialIssue = {
      id: crypto.randomUUID(),
      issueNo: "",
      date: notApplicableDate,
      issueType: "Without Job",
      remarks: reason,
      notApplicable: "Yes",
      tallyPostingStatus: "Not Applicable",
      tallyTimestamp: timestamp,
      tallyLastAttemptAt: timestamp,
      tallyPostedBy: "System User",
      tallyPostingRemark: reason,
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };

    setMarkingDate(notApplicableDate);
    try {
      await setMaterialIssues([issue, ...materialIssues]);
      setNotApplicableDate(null);
      setNotApplicableRemarks("");
      setNotApplicableError("");
    } catch (error) {
      console.error("Failed to mark Not Applicable:", error);
      setNotApplicableError("Failed to mark date as Not Applicable.");
    } finally {
      setMarkingDate(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Non-Job Material Issue</h2>
          <div className="text-xs text-slate-600">
            Shows dates missing a "Without Job" material issue entry (from first Job Date to today).
          </div>
        </div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search date..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {!firstJobDate ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-slate-600 font-medium">
                    Tracking has not started (no Job Date found in the system).
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No pending dates. All dates from {formatDate(firstJobDate)} to {formatDate(today)} have a Without Job issue.
                  </td>
                </tr>
              ) : (
                filtered.map((date) => (
                  <tr key={date} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{formatDate(date) || date}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openNotApplicableModal(date)}
                        disabled={markingDate === date}
                        className="mr-2 bg-white text-black px-4 py-1.5 rounded border border-black text-xs font-bold hover:bg-slate-100 transition disabled:opacity-50"
                      >
                        {markingDate === date ? "Saving..." : "Not Applicable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openForm(date)}
                        className="bg-indigo-600 text-white px-4 py-1.5 rounded border border-black text-xs font-bold hover:bg-indigo-700 transition"
                      >
                        Create Issue
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {notApplicableDate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded border-2 border-black bg-white p-5 shadow-2xl">
            <div className="mb-4 border-b border-black pb-3">
              <h3 className="text-lg font-black uppercase tracking-tight text-black">Not Applicable Remarks</h3>
              <p className="mt-1 text-sm font-bold text-slate-600">{formatDate(notApplicableDate) || notApplicableDate}</p>
            </div>

            <label className="mb-2 block text-xs font-black uppercase text-black">Remarks *</label>
            <textarea
              value={notApplicableRemarks}
              onChange={(e) => {
                setNotApplicableRemarks(e.target.value);
                if (notApplicableError) setNotApplicableError("");
              }}
              rows={4}
              autoFocus
              disabled={!!markingDate}
              className="w-full resize-none rounded border-2 border-black p-3 text-sm font-semibold text-black focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100"
              placeholder="Enter mandatory remarks..."
            />
            {notApplicableError ? <div className="mt-2 text-xs font-bold text-red-600">{notApplicableError}</div> : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeNotApplicableModal}
                disabled={!!markingDate}
                className="rounded border border-black bg-white px-4 py-2 text-sm font-bold uppercase text-black hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void markNotApplicable()}
                disabled={!!markingDate}
                className="rounded border border-black bg-indigo-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {markingDate ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}    </div>
  );
}

