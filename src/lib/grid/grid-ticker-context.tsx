'use client'
import { createContext, useContext, useState, useCallback } from 'react'

export interface GridTickerContextValue {
  ticker: string | null   // null = market-wide mode
  setTicker: (t: string | null) => void
  isFiltered: boolean
}

export const GridTickerContext = createContext<GridTickerContextValue>({
  ticker: null,
  setTicker: () => {},
  isFiltered: false,
})

export function useGridTicker() {
  return useContext(GridTickerContext)
}

export function GridTickerProvider({ children }: { children: React.ReactNode }) {
  const [ticker, setTickerRaw] = useState<string | null>(null)
  const setTicker = useCallback(
    (t: string | null) => setTickerRaw(t ? t.toUpperCase().trim() : null),
    [],
  )
  return (
    <GridTickerContext.Provider value={{ ticker, setTicker, isFiltered: ticker !== null }}>
      {children}
    </GridTickerContext.Provider>
  )
}
