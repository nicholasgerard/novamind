"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface SlidingTabIndicator {
  height: number;
  ready: boolean;
  width: number;
  x: number;
  y: number;
}

const emptyIndicator: SlidingTabIndicator = {
  height: 0,
  ready: false,
  width: 0,
  x: 0,
  y: 0,
};

/**
 * Measures an active tab relative to its tablist so callers can render a
 * smoothly moving background pill without duplicating ResizeObserver setup.
 */
export function useSlidingTabIndicator<Key extends string>(
  activeKey: Key | null,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<Key, HTMLButtonElement>());
  const [indicator, setIndicator] =
    useState<SlidingTabIndicator>(emptyIndicator);

  useLayoutEffect(() => {
    if (!activeKey) {
      setIndicator(emptyIndicator);
      return;
    }
    const measuredKey = activeKey;

    function updateIndicator() {
      const list = containerRef.current;
      const tab = tabRefs.current.get(measuredKey);
      if (!list || !tab) return;

      const listRect = list.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      setIndicator({
        height: tabRect.height,
        ready: true,
        width: tabRect.width,
        x: tabRect.left - listRect.left,
        y: tabRect.top - listRect.top,
      });
    }

    updateIndicator();

    const resizeObserver = new ResizeObserver(updateIndicator);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    for (const tab of tabRefs.current.values()) resizeObserver.observe(tab);
    window.addEventListener("resize", updateIndicator);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [activeKey]);

  const registerTab = useCallback(
    (key: Key) => (node: HTMLButtonElement | null) => {
      if (node) tabRefs.current.set(key, node);
      else tabRefs.current.delete(key);
    },
    [],
  );

  return { containerRef, indicator, registerTab };
}
