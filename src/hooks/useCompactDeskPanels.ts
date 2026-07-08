"use client";

import { useEffect, useState } from "react";

const COMPACT_QUERY = "(max-width: 767px)";

/** True on iOS native shell OR narrow mobile web — use segment switcher instead of triple stack. */
export function useCompactDeskPanels(nativeShell: boolean): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return nativeShell || narrow;
}
