"use client";

import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";

// Compact starred-ticker rail. Click a chip to filter the tape; click × to unstar.
// Palette: gold / sky-300 / cyan-400 / white only (no grey).
export function WatchlistBar({
  watchlist,
  activeTicker,
  onSelect,
  onRemove,
  onClear,
}: {
  watchlist: string[];
  /** currently-applied tickerFilter, for highlighting the active chip */
  activeTicker?: string;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onClear: () => void;
}) {
  if (watchlist.length === 0) return null;
  return (
    <div className="helix-pro-watchlist">
      <span className="helix-pro-command-label">Watchlist</span>
      <AnimatePresence initial={false}>
        {watchlist.map((t) => {
          const active = activeTicker && activeTicker.toUpperCase() === t;
          return (
            <motion.div
              key={t}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className={clsx(
                "helix-pro-watchlist-chip",
                active ? "helix-pro-watchlist-chip--active" : "helix-pro-watchlist-chip--idle"
              )}
            >
              <button type="button" onClick={() => onSelect(t)} className="tracking-widest">
                {t}
              </button>
              <button
                type="button"
                onClick={() => onRemove(t)}
                title={`Remove ${t} from watchlist`}
                className="text-cyan-400 hover:text-white leading-none"
              >
                ×
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <button
        type="button"
        onClick={onClear}
        className="font-mono text-[10px] text-cyan-400 hover:text-white underline-offset-2 hover:underline ml-1"
      >
        clear
      </button>
    </div>
  );
}
