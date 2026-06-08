export function exportsAllowed() {
  if (typeof window === "undefined") return false;
  // Enable export functionality for both Excel and PDF downloads.
  return true;
}
