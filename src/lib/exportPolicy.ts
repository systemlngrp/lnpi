export function exportsAllowed() {
  if (typeof window === "undefined") return false;
  return false;
}
