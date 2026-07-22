import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: string;
  userId: string;
  name: string;
  email?: string | null;
  role: "Admin" | "Employee" | "Operator" | "TruckDriver";
  status: "Active" | "Inactive";
  menuAccess: string[];
  truckId?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  hasAccess: (href: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TRUCK_DRIVER_ALLOWED_PATHS = ["/truck/status-update"];

function normalizeMenuAccess(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const list = raw.map((v) => String(v)).filter(Boolean);
    if (list.includes("/masters/settings") && !list.includes("/masters/machines")) {
      list.push("/masters/machines");
    }
    return list;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const list = parsed.map((v) => String(v)).filter(Boolean);
        if (list.includes("/masters/settings") && !list.includes("/masters/machines")) {
          list.push("/masters/machines");
        }
        return list;
      }
    } catch {
      // ignore
    }
  }
  return [];
}

function normalizeRole(raw: unknown): AuthUser["role"] {
  const role = String(raw || "Employee").trim();
  if (role === "Admin") return "Admin";
  if (role === "Operator") return "Operator";
  if (role === "TruckDriver") return "TruckDriver";
  return "Employee";
}

function getEffectiveMenuAccess(user: AuthUser | null) {
  if (!user) return [];
  if (user.role === "TruckDriver") return TRUCK_DRIVER_ALLOWED_PATHS;
  return normalizeMenuAccess(user.menuAccess);
}

function isAllowed(user: AuthUser | null, href: string) {
  if (!user) return false;
  if (href === "/") return true;
  if (user.role === "Admin") return true;
  if (user.status !== "Active") return false;
  if (user.role === "TruckDriver") return href === "/" || TRUCK_DRIVER_ALLOWED_PATHS.includes(href);
  const list = getEffectiveMenuAccess(user);
  if (list.includes("*")) return true;
  if (
    href === "/production-processing/form" &&
    ["/production/pending-machine-processing", "/production/pending-printing", "/production-processing/master"].some((path) => list.includes(path))
  ) {
    return true;
  }
  if (href === "/truck/logs" && list.includes("/reports/truck-status")) return true;
  if (!href) return false;
  return list.some((entry) => {
    if (!entry) return false;
    if (entry === href) return true;
    if (entry !== "/" && href.startsWith(`${entry}/`)) return true; // user granted section access
    if (href !== "/" && entry.startsWith(`${href}/`)) return true; // user granted a specific page
    if (entry.endsWith("/*") && href.startsWith(entry.slice(0, -1))) return true;
    return false;
  });
}

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = window.localStorage.getItem("authToken") || "";
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async (showLoading = true) => {
    const token = window.localStorage.getItem("authToken") || "";
    if (!token) {
      setUser(null);
      if (showLoading) setLoading(false);
      return;
    }
    try {
      if (showLoading) setLoading(true);
      const res = await authFetch("/api/auth/me");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          window.localStorage.removeItem("authToken");
          setUser(null);
        }
        return;
      }
      const me = (await res.json()) as AuthUser;
      setUser({ ...me, role: normalizeRole(me.role), menuAccess: normalizeMenuAccess(me.menuAccess) });
    } catch {
      // Keep the current user during a temporary connectivity failure.
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshMe(false);
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshMe]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) {
      let msg = "Login failed";
      try {
        const data = await res.json();
        msg = data?.error || msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const data = await res.json();
    window.localStorage.setItem("authToken", String(data.token || ""));
    const nextUser = {
      ...(data.user as AuthUser),
      role: normalizeRole(data.user?.role),
      menuAccess: normalizeMenuAccess(data.user?.menuAccess),
    };
    setUser(nextUser);
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      window.localStorage.removeItem("authToken");
      setUser(null);
    }
  }, []);

  const hasAccess = useCallback((href: string) => isAllowed(user, href), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, hasAccess }),
    [user, loading, login, logout, hasAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
