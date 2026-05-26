export function exportsAllowed() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash || "";
  const pathname = window.location.pathname || "";
  return (
    hash === "#/delivery-book" ||
    hash.startsWith("#/delivery-book?") ||
    pathname === "/delivery-book" ||
    pathname.startsWith("/delivery-book?")
  );
}
