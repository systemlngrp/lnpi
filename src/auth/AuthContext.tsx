import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: string;
  userId: string;
  name: string;
  email?: string | null;
  role: "Admin" | "Employee";
  status: "Active" | "Inactive";
  menuAccess: string[];
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasAccess: (href: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

function isAllowed(user: AuthUser | null, href: string) {
  if (!user) return false;
  if (user.role === "Admin") return true;
  if (user.status !== "Active") return false;
  const list = normalizeMenuAccess(user.menuAccess);
  if (list.includes("*")) return true;
  if (!href) return false;
  return list.some((entry) => {
    if (!entry) return false;
    if (entry === href) return true;
    if (href.startsWith(entry)) return true; // user granted section access
    if (entry.startsWith(href)) return true; // user granted a specific page
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

  const refreshMe = useCallback(async () => {
    const token = window.localStorage.getItem("authToken") || "";
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await authFetch("/api/auth/me");
      if (!res.ok) throw new Error(await res.text());
      const me = (await res.json()) as AuthUser;
      setUser({ ...me, menuAccess: normalizeMenuAccess(me.menuAccess) });
    } catch {
      window.localStorage.removeItem("authToken");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
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
    setUser(data.user as AuthUser);
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
