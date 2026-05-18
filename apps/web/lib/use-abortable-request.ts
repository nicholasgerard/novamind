"use client";

import { useCallback, useEffect, useRef } from "react";

export interface AbortableRequestControls {
  abortCurrent: () => void;
  clearCurrent: (controller: AbortController) => boolean;
  startRequest: () => AbortController;
}

/**
 * Owns the AbortController lifecycle for UI requests where only the newest
 * run should be allowed to update state. Cleanup aborts in-flight work when
 * the component unmounts.
 */
export function useAbortableRequest(): AbortableRequestControls {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, []);

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearCurrent = useCallback((controller: AbortController): boolean => {
    if (abortRef.current !== controller) return false;
    abortRef.current = null;
    return true;
  }, []);

  const startRequest = useCallback((): AbortController => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  return { abortCurrent, clearCurrent, startRequest };
}
