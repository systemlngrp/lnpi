import { SampleRequest } from "../types";

export function sortSampleRequestsDesc<T extends SampleRequest>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const timeA = new Date(a.updateTimestamp || a.cancelTimestamp || a.timestamp || a.date || 0).getTime();
    const timeB = new Date(b.updateTimestamp || b.cancelTimestamp || b.timestamp || b.date || 0).getTime();
    return timeB - timeA;
  });
}

export function getSampleRequestStatus(row: SampleRequest) {
  if (row.cancelTimestamp) return "Cancelled";
  if (row.jobCardNo) return "Produced";
  return "Pending";
}
