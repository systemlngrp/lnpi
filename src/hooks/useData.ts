import { useState, useEffect, useCallback, useRef } from "react";
import { useAutoRefreshEffect } from "./useAutoRefresh";

type UseDataOptions = {
  cacheToLocalStorage?: boolean;
  endpointOverride?: string;
  storageKey?: string;
  syncEventKey?: string;
};

function safeGetLocalStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[useData] Failed to read localStorage key "${key}":`, error);
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    const isQuotaError = 
      error instanceof DOMException && (
        error.name === 'QuotaExceededError' || 
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || 
        (error as any).code === 22 || 
        (error as any).code === 1014
      );

    if (isQuotaError) {
      console.warn(`[useData] LocalStorage quota exceeded while writing "${key}". Clearing caches to make room...`);
      try {
        const token = window.localStorage.getItem("authToken");
        window.localStorage.clear();
        if (token) window.localStorage.setItem("authToken", token);
        // Try again after clearing
        window.localStorage.setItem(key, value);
        console.info(`[useData] Cache cleared and "${key}" successfully saved.`);
        return true;
      } catch (retryError) {
        console.warn(`[useData] Even after clearing, data for "${key}" exceeds the 5MB quota. Skipping cache.`, retryError);
      }
    } else {
      console.warn(`[useData] Failed to write localStorage key "${key}":`, error);
    }
    return false;
  }
}

export function useData<T extends { id: string }>(entity: string, initialValue: T[], options?: UseDataOptions) {
  const [data, setDataState] = useState<T[]>(initialValue);
  const dataRef = useRef<T[]>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const forbiddenUntilRef = useRef(0);

  const isItemAlias = entity === "items" && !options?.endpointOverride;
  const resolvedEntity = isItemAlias ? "npd" : entity;
  const endpoint = options?.endpointOverride || `/api/${resolvedEntity.replace(/_/g, "-")}`;
  const storageKey = `udc_${options?.storageKey || resolvedEntity}`;
  const syncEvent = options?.syncEventKey || `sync-data-${resolvedEntity}`;
  const shouldCacheToLocalStorage = options?.cacheToLocalStorage !== false;

  // Keep ref in sync
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const fetchData = useCallback(async (config?: { background?: boolean; force?: boolean }) => {
    const background = Boolean(config?.background);
    const force = Boolean(config?.force);
    const now = Date.now();

    if (isFetchingRef.current) return;
    if (now < forbiddenUntilRef.current) return;
    if (!force && now - lastFetchAtRef.current < 10_000) return;

    isFetchingRef.current = true;
    try {
      if (!background) setLoading(true);
      const token = window.localStorage.getItem("authToken") || "";
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(endpoint, { headers });
      if (response.status === 403) {
        // Sidebar counts request data from modules that a selective user may not access.
        // Treat that expected denial as an empty dataset rather than a recurring app error.
        forbiddenUntilRef.current = Date.now() + 5 * 60_000;
        lastFetchAtRef.current = Date.now();
        setDataState([]);
        dataRef.current = [];
        setError(null);
        return;
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch data");
      }
      const result = await response.json();
      const finalData = Array.isArray(result) ? result : (result && Array.isArray(result.rows) ? result.rows : []);
      setDataState(finalData);
      dataRef.current = finalData;
      forbiddenUntilRef.current = 0;
      setError(null);
      lastFetchAtRef.current = Date.now();
      if (shouldCacheToLocalStorage) {
        safeSetLocalStorage(storageKey, JSON.stringify(finalData));
      }
    } catch (err) {
      console.error(`Error fetching ${entity}:`, err);
      setError((err as Error).message);
      if (shouldCacheToLocalStorage) {
        const saved = safeGetLocalStorage(storageKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setDataState(parsed);
            dataRef.current = parsed;
          } catch (parseError) {
            console.warn(
              `[useData] Invalid cached JSON for "${storageKey}". Clearing corrupted cache entry.`,
              parseError,
            );
            try {
              window.localStorage.removeItem(storageKey);
            } catch (removeError) {
              console.warn(`[useData] Failed to clear corrupted localStorage key "${storageKey}":`, removeError);
            }
          }
        }
      }
    } finally {
      if (!background) setLoading(false);
      isFetchingRef.current = false;
    }
  }, [endpoint, entity, shouldCacheToLocalStorage, storageKey]);

  useEffect(() => {
    fetchData({ force: true });

    // Listen for sync events from other hook instances
    const handleSync = () => {
      fetchData({ background: true, force: true });
    };
    
    window.addEventListener(syncEvent, handleSync);
    return () => window.removeEventListener(syncEvent, handleSync);
  }, [fetchData, syncEvent]);

  useAutoRefreshEffect(() => {
    void fetchData({ background: true });
  });

  const updateData = useCallback(async (newData: T[] | ((prev: T[]) => T[])) => {
    const currentData = dataRef.current;
    const resolvedData = typeof newData === "function" ? newData(currentData) : newData;
    
    // Find what changed compared to the absolute LATEST data
    const added = resolvedData.filter(n => !currentData.find(o => o.id === n.id));
    const modified = resolvedData.filter(n => {
      const old = currentData.find(o => o.id === n.id);
      return old && JSON.stringify(old) !== JSON.stringify(n);
    });
    const deleted = currentData.filter(o => !resolvedData.find(n => n.id === o.id));

    console.log(`[useData:${entity}] Syncing: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted`);

    // Optimistic update
    setDataState(resolvedData);
    dataRef.current = resolvedData;
    if (shouldCacheToLocalStorage) {
      safeSetLocalStorage(storageKey, JSON.stringify(resolvedData));
    }

    // Emit sync event immediately for other local components
    window.dispatchEvent(new CustomEvent(syncEvent));

    // Send to server
    let hasError = false;
    let lastErrorMessage = "";
    const token = window.localStorage.getItem("authToken") || "";
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      for (const item of [...added, ...modified]) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(item),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData.error || response.statusText;
          hasError = true;
          lastErrorMessage = msg;
          console.error(`[useData:${entity}] Save failed for ${item.id}:`, msg);
        }
      }
      for (const item of deleted) {
        const response = await fetch(`${endpoint}/${item.id}`, { method: "DELETE", headers: { ...authHeaders } });
        if (!response.ok) {
          hasError = true;
          const errData = await response.json().catch(() => ({}));
          lastErrorMessage = errData.error || response.statusText;
        }
      }

      if (hasError) {
        throw new Error(lastErrorMessage || "Failed to sync some items with server");
      }
      
      // Re-fetch to ensure perfect sync with DB state
      await fetchData();
      // Emit sync event again after server confirmation
      window.dispatchEvent(new CustomEvent(syncEvent));
    } catch (err) {
      console.error(`[useData:${entity}] Sync error:`, err);
      fetchData(); // Re-sync with server on error
      window.dispatchEvent(new CustomEvent(syncEvent));
      throw err;
    }
  }, [endpoint, entity, fetchData, shouldCacheToLocalStorage, storageKey, syncEvent]);

  // Providing a more robust interface
  const addItem = async (item: T) => {
    try {
      setDataState(prev => [...prev, item]);
      const token = window.localStorage.getItem("authToken") || "";
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(item),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to add item");
      }
    } catch (err) {
      console.error("Error adding item:", err);
      fetchData();
      throw err;
    }
  };

  const removeItem = async (id: string) => {
    try {
      setDataState(prev => prev.filter(i => i.id !== id));
      const token = window.localStorage.getItem("authToken") || "";
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${endpoint}/${id}`, { method: "DELETE", headers: { ...authHeaders } });
      if (!response.ok) {
        throw new Error("Failed to delete item");
      }
    } catch (err) {
      console.error("Error deleting item:", err);
      fetchData();
      throw err;
    }
  };

  const saveItem = async (item: T) => {
    try {
      setDataState(prev => prev.map(i => i.id === item.id ? item : i));
      const token = window.localStorage.getItem("authToken") || "";
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(item),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save item");
      }
    } catch (err) {
      console.error("Error saving item:", err);
      fetchData();
      throw err;
    }
  };

  return [data, updateData, loading, { refresh: fetchData, addItem, removeItem, saveItem }] as const;
}
