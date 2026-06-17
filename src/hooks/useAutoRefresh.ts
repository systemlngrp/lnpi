import { useEffect, useRef, useState } from "react";

export const APP_AUTO_REFRESH_EVENT = "app-auto-refresh";
export const APP_AUTO_REFRESH_PAUSE_EVENT = "app-auto-refresh-pause";

const IDLE_REFRESH_MS = 60_000;
const MIN_REFRESH_GAP_MS = 10_000;

export type AutoRefreshReason = "idle" | "focus" | "visibility";

export type AutoRefreshStatus = {
  at: number | null;
  reason: AutoRefreshReason | null;
};

const INITIAL_STATUS: AutoRefreshStatus = {
  at: null,
  reason: null,
};

let latestAutoRefreshStatus: AutoRefreshStatus = INITIAL_STATUS;
const autoRefreshPauseTokens = new Set<string>();

function emitPauseStatus() {
  window.dispatchEvent(
    new CustomEvent(APP_AUTO_REFRESH_PAUSE_EVENT, {
      detail: { paused: autoRefreshPauseTokens.size > 0 },
    })
  );
}

function isAutoRefreshPaused() {
  return autoRefreshPauseTokens.size > 0;
}

function dispatchAutoRefresh(reason: AutoRefreshReason, lastRefreshAtRef: { current: number }) {
  if (isAutoRefreshPaused()) {
    return;
  }
  const now = Date.now();
  if (now - lastRefreshAtRef.current < MIN_REFRESH_GAP_MS) {
    return;
  }
  lastRefreshAtRef.current = now;
  latestAutoRefreshStatus = {
    at: now,
    reason,
  };
  window.dispatchEvent(
    new CustomEvent(APP_AUTO_REFRESH_EVENT, {
      detail: latestAutoRefreshStatus,
    })
  );
}

export function useAppAutoRefresh(enabled = true) {
  const idleTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const clearIdleTimer = () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const scheduleIdleRefresh = () => {
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(function triggerIdleRefresh() {
        dispatchAutoRefresh("idle", lastRefreshAtRef);
        idleTimerRef.current = window.setTimeout(triggerIdleRefresh, IDLE_REFRESH_MS);
      }, IDLE_REFRESH_MS);
    };

    const handleActivity = () => {
      scheduleIdleRefresh();
    };

    const handleFocus = () => {
      dispatchAutoRefresh("focus", lastRefreshAtRef);
      scheduleIdleRefresh();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        dispatchAutoRefresh("visibility", lastRefreshAtRef);
        scheduleIdleRefresh();
      }
    };

    scheduleIdleRefresh();

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearIdleTimer();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled]);
}

export function useAutoRefreshEffect(callback: () => void, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const handleRefresh = () => {
      callbackRef.current();
    };

    window.addEventListener(APP_AUTO_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(APP_AUTO_REFRESH_EVENT, handleRefresh);
    };
  }, [enabled]);
}

export function useAutoRefreshStatus(enabled = true) {
  const [status, setStatus] = useState<AutoRefreshStatus>(latestAutoRefreshStatus);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<AutoRefreshStatus>).detail;
      if (detail?.at) {
        setStatus(detail);
      } else {
        setStatus(latestAutoRefreshStatus);
      }
    };

    window.addEventListener(APP_AUTO_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(APP_AUTO_REFRESH_EVENT, handleRefresh);
    };
  }, [enabled]);

  return status;
}

export function useAutoRefreshPause(paused: boolean) {
  const tokenRef = useRef(`auto-refresh-pause-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (paused) {
      autoRefreshPauseTokens.add(tokenRef.current);
      emitPauseStatus();
    } else if (autoRefreshPauseTokens.delete(tokenRef.current)) {
      emitPauseStatus();
    }

    return () => {
      if (autoRefreshPauseTokens.delete(tokenRef.current)) {
        emitPauseStatus();
      }
    };
  }, [paused]);
}

export function useIsAutoRefreshPaused(enabled = true) {
  const [paused, setPaused] = useState(isAutoRefreshPaused());

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const handlePauseChange = (event: Event) => {
      const detail = (event as CustomEvent<{ paused?: boolean }>).detail;
      setPaused(Boolean(detail?.paused));
    };

    window.addEventListener(APP_AUTO_REFRESH_PAUSE_EVENT, handlePauseChange);
    return () => {
      window.removeEventListener(APP_AUTO_REFRESH_PAUSE_EVENT, handlePauseChange);
    };
  }, [enabled]);

  return paused;
}
