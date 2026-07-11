"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import {
  VECTOR_DEFAULT_TICKER,
  isVectorTickerAllowed,
  normalizeVectorTicker,
} from "@/features/vector/lib/vector-ticker";

const PRESETS = vectorUniverseTickers();

type Props = {
  ticker: string;
};

/**
 * Ticker search — type ANY optionable symbol (not just the preset universe) and
 * load its dealer-positioning chart. The presets remain as quick-pick suggestions;
 * anything well-formed you type is loadable (the providers return honest-empty
 * structure for a symbol with no options, and the chart says so rather than
 * erroring). Replaces the old fixed <select> that hid every symbol off the ~21 list.
 */
export function VectorTickerSelect({ ticker }: Props) {
  const router = useRouter();
  const active = normalizeVectorTicker(ticker);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = query.trim().toUpperCase();

  // Preset matches first; then, if what's typed is a valid symbol not already a
  // preset, offer it as an explicit "load this" row so any stock is reachable.
  const options = useMemo(() => {
    const matches = typed
      ? PRESETS.filter((t) => t.startsWith(typed))
      : PRESETS;
    const extra =
      typed && isVectorTickerAllowed(typed) && !PRESETS.includes(typed) ? [typed] : [];
    return [...extra, ...matches].slice(0, 12);
  }, [typed]);

  const go = (raw: string) => {
    if (!isVectorTickerAllowed(raw)) return;
    const next = normalizeVectorTicker(raw);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(next === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(next)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(options[highlight] ?? typed);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      className="vector-ticker-search"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls="vector-ticker-listbox"
    >
      <span className="vector-ticker-search-icon" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={8}
        value={open ? query : active}
        placeholder={active}
        aria-label="Search any stock symbol"
        data-testid="vector-ticker-search"
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className="vector-ticker-search-input"
      />
      {open && options.length > 0 && (
        <ul id="vector-ticker-listbox" className="vector-ticker-search-menu" role="listbox">
          {options.map((opt, i) => {
            const isExtra = opt === typed && !PRESETS.includes(opt);
            return (
              <li key={opt} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={clsx("vector-ticker-search-opt", i === highlight && "is-active")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(opt);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="vector-ticker-search-opt-sym">{opt}</span>
                  {isExtra ? <span className="vector-ticker-search-opt-hint">Load symbol</span> : null}
                  {opt === active ? <span className="vector-ticker-search-opt-hint">Current</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
