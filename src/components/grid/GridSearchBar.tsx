'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { useGridTicker } from '@/lib/grid/grid-ticker-context'

const TICKER_RE = /^[A-Z]{1,5}$/

function isValidTicker(raw: string): boolean {
  return TICKER_RE.test(raw.toUpperCase().trim())
}

/**
 * GridSearchBar — ticker filter input for the BlackOut Grid.
 *
 * - Debounced 300ms on type; Enter = immediate
 * - Validates: 1-5 uppercase letters only
 * - "/" shortcut focuses the bar (GitHub-style)
 * - Shows cyan "Filtered: TSLA" pill + × clear when active
 */
export function GridSearchBar() {
  const { ticker, setTicker, isFiltered } = useGridTicker()
  const [raw, setRaw] = useState('')
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // "/" key focuses the search bar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        document.activeElement !== inputRef.current &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sync raw input when ticker is cleared externally (e.g. pill × click)
  useEffect(() => {
    if (!ticker) setRaw('')
  }, [ticker])

  const commit = useCallback(
    (value: string) => {
      const up = value.toUpperCase().trim()
      if (!up) {
        setTicker(null)
        setInvalid(false)
        return
      }
      if (!isValidTicker(up)) {
        setInvalid(true)
        return
      }
      setInvalid(false)
      setTicker(up)
    },
    [setTicker],
  )

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
    setRaw(v)
    setInvalid(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => commit(v), 300)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      commit(raw)
    }
    if (e.key === 'Escape') {
      handleClear()
      inputRef.current?.blur()
    }
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setRaw('')
    setInvalid(false)
    setTicker(null)
    inputRef.current?.focus()
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search input */}
      <div
        className={clsx(
          'flex items-center gap-1.5 rounded border bg-[#08090f] px-2.5 py-1.5 transition-colors',
          invalid
            ? 'border-[#ff5c78]/60 ring-1 ring-[#ff5c78]/30'
            : isFiltered
            ? 'border-cyan-400/40 ring-1 ring-cyan-400/20'
            : 'border-white/10 focus-within:border-cyan-400/30 focus-within:ring-1 focus-within:ring-cyan-400/10',
        )}
      >
        {/* Search icon */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className={clsx('shrink-0', isFiltered ? 'text-cyan-400' : 'text-sky-400/60')}
          aria-hidden
        >
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={raw}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Search ticker — TSLA, AAPL…"
          maxLength={5}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="characters"
          className={clsx(
            'w-36 bg-transparent font-mono text-[12px] tracking-wide outline-none placeholder:text-sky-400/30',
            isFiltered ? 'text-cyan-400' : 'text-white',
          )}
          aria-label="Filter all panels by ticker"
        />

        {/* Clear button */}
        {(raw || isFiltered) && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 text-sky-400/50 hover:text-white transition-colors leading-none"
            aria-label="Clear ticker filter"
          >
            ×
          </button>
        )}

        {/* "/" hint when empty */}
        {!raw && !isFiltered && (
          <kbd className="hidden sm:inline shrink-0 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-sky-400/40 leading-none">
            /
          </kbd>
        )}
      </div>

      {/* Active filter pill */}
      {isFiltered && ticker && (
        <div className="flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-1">
          <span className="font-mono text-[11px] font-bold text-cyan-400 tracking-wide">
            Filtered: {ticker}
          </span>
          <button
            type="button"
            onClick={handleClear}
            className="text-cyan-400/60 hover:text-cyan-400 transition-colors leading-none ml-0.5"
            aria-label={`Clear ${ticker} filter`}
          >
            ×
          </button>
        </div>
      )}

      {invalid && (
        <span className="font-mono text-[10px] text-[#ff5c78]">
          Invalid ticker — 1–5 letters
        </span>
      )}
    </div>
  )
}
