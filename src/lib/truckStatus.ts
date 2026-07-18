import type { TruckLiveStatus } from "../types";

export const TRUCK_LIVE_STATUSES: TruckLiveStatus[] = [
  "EMPTY",
  "LOADING",
  "IN-TRANSIT",
  "REPORTED TO PARTY",
  "UNLOADING",
  "RETURNING",
  "BILL PENDING",
  "NOT UNLOADED",
  "REJECTED",
];

export const TRUCK_DRIVER_UPDATE_STATUSES: TruckLiveStatus[] = [...TRUCK_LIVE_STATUSES];

export const TRUCK_STATUS_STYLES: Record<string, { label: string; tile: string; badge: string }> = {
  "NOT UNLOADED": { label: "NOT UNLOADED", tile: "bg-cyan-300 text-red-600", badge: "bg-cyan-200 text-red-700 border-cyan-600" },
  "BILL PENDING": { label: "BILL PENDING", tile: "bg-red-600 text-white", badge: "bg-red-600 text-white border-red-800" },
  EMPTY: { label: "EMPTY", tile: "bg-lime-500 text-black", badge: "bg-lime-500 text-black border-lime-700" },
  RETURNING: { label: "RETURNING", tile: "bg-green-700 text-white", badge: "bg-green-700 text-white border-green-900" },
  "IN-TRANSIT": { label: "IN-TRANSIT", tile: "bg-violet-700 text-white", badge: "bg-violet-700 text-white border-violet-900" },
  LOADING: { label: "LOADING", tile: "bg-yellow-300 text-black", badge: "bg-yellow-300 text-black border-yellow-600" },
  REJECTED: { label: "REJECTED", tile: "bg-red-600 text-white", badge: "bg-red-600 text-white border-red-800" },
  UNLOADING: { label: "UNLOADING", tile: "bg-black text-white", badge: "bg-black text-white border-black" },
  "REPORTED TO PARTY": { label: "REPORTED TO PARTY", tile: "bg-cyan-300 text-black", badge: "bg-cyan-300 text-black border-cyan-700" },
};

export function normalizeTruckStatus(value?: string | null): TruckLiveStatus | "" {
  const status = String(value || "").trim().toUpperCase();
  return TRUCK_LIVE_STATUSES.includes(status as TruckLiveStatus) ? status as TruckLiveStatus : "";
}

export function formatTruckDuration(iso?: string | null, nowMs = Date.now()) {
  const started = iso ? new Date(iso).getTime() : 0;
  if (!started || Number.isNaN(started)) return "-";
  const totalSeconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTruckDateTime(iso?: string | null) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}