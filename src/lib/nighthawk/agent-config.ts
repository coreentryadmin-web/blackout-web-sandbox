import type { HuntMode } from "./types";

export type AgentFilterField = {
  id: string;
  label: string;
  type: "select" | "number" | "text" | "toggle";
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue: string | number | boolean;
  hint?: string;
};

export type AgentModeConfig = {
  mode: HuntMode;
  title: string;
  tagline: string;
  accent: "cyan" | "bear" | "purple";
  powerLabel: string;
  description: string;
  filters: AgentFilterField[];
};

export const AGENT_MODES: AgentModeConfig[] = [
  {
    mode: "day",
    title: "Day Trade",
    tagline: "0–1 DTE · intraday structure",
    accent: "cyan",
    powerLabel: "Power Up Day Hawk",
    description:
      "Hunts same-session setups using 0DTE flow, gamma, VWAP structure, and opening-range levels.",
    filters: [
      {
        id: "direction",
        label: "Bias",
        type: "select",
        defaultValue: "any",
        options: [
          { value: "any", label: "Any direction" },
          { value: "bull", label: "Bullish only" },
          { value: "bear", label: "Bearish only" },
        ],
      },
      {
        id: "max_dte",
        label: "Max DTE",
        type: "select",
        defaultValue: "1",
        options: [
          { value: "0", label: "0DTE only" },
          { value: "1", label: "0–1 DTE" },
        ],
      },
      {
        id: "min_premium",
        label: "Min flow premium ($)",
        type: "select",
        defaultValue: "250000",
        options: [
          { value: "100000", label: "$100K+" },
          { value: "250000", label: "$250K+" },
          { value: "500000", label: "$500K+" },
        ],
      },
      {
        id: "watchlist",
        label: "Watchlist (optional)",
        type: "text",
        placeholder: "NVDA, TSLA, SPY …",
        defaultValue: "",
        hint: "Comma-separated tickers. Leave blank to scan full universe.",
      },
      {
        id: "spx_context",
        label: "Require SPX alignment",
        type: "toggle",
        defaultValue: true,
        hint: "Only surface plays that align with current SPX flow / GEX context.",
      },
    ],
  },
  {
    mode: "swing",
    title: "Swing",
    tagline: "2–10 DTE · multi-day hold",
    accent: "bear",
    powerLabel: "Power Up Swing Hawk",
    description:
      "Finds 2–10 DTE swings with flow streak, technical alignment, and affordable entry premiums.",
    filters: [
      {
        id: "direction",
        label: "Bias",
        type: "select",
        defaultValue: "any",
        options: [
          { value: "any", label: "Any direction" },
          { value: "bull", label: "Bullish only" },
          { value: "bear", label: "Bearish only" },
        ],
      },
      {
        id: "dte_min",
        label: "Min DTE",
        type: "select",
        defaultValue: "2",
        options: [
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "5", label: "5" },
        ],
      },
      {
        id: "dte_max",
        label: "Max DTE",
        type: "select",
        defaultValue: "10",
        options: [
          { value: "5", label: "5" },
          { value: "7", label: "7" },
          { value: "10", label: "10" },
        ],
      },
      {
        id: "min_score",
        label: "Min score",
        type: "select",
        defaultValue: "50",
        options: [
          { value: "45", label: "45+" },
          { value: "50", label: "50+" },
          { value: "55", label: "55+" },
        ],
      },
      {
        id: "min_streak",
        label: "Min flow streak (days)",
        type: "select",
        defaultValue: "2",
        options: [
          { value: "2", label: "2+" },
          { value: "3", label: "3+" },
        ],
      },
      {
        id: "max_iv_rank",
        label: "Max IV rank",
        type: "select",
        defaultValue: "82",
        options: [
          { value: "70", label: "≤ 70" },
          { value: "82", label: "≤ 82" },
          { value: "90", label: "≤ 90" },
        ],
      },
      {
        id: "max_entry_premium",
        label: "Max entry premium / contract",
        type: "select",
        defaultValue: "10",
        options: [
          { value: "5", label: "$5" },
          { value: "10", label: "$10" },
          { value: "15", label: "$15" },
        ],
      },
    ],
  },
  {
    mode: "leap",
    title: "Leap",
    tagline: "30+ DTE · institutional runway",
    accent: "purple",
    powerLabel: "Power Up Leap Hawk",
    description:
      "Surfaces LEAP accumulation with catalyst runway, OI build, and macro/sector tailwinds.",
    filters: [
      {
        id: "direction",
        label: "Bias",
        type: "select",
        defaultValue: "bull",
        options: [
          { value: "bull", label: "Bullish LEAPs" },
          { value: "bear", label: "Bearish LEAPs" },
          { value: "any", label: "Any direction" },
        ],
      },
      {
        id: "min_dte",
        label: "Min DTE",
        type: "select",
        defaultValue: "30",
        options: [
          { value: "30", label: "30+" },
          { value: "60", label: "60+" },
          { value: "90", label: "90+" },
        ],
      },
      {
        id: "min_premium",
        label: "Min LEAP premium ($)",
        type: "select",
        defaultValue: "500000",
        options: [
          { value: "250000", label: "$250K+" },
          { value: "500000", label: "$500K+" },
          { value: "1000000", label: "$1M+" },
        ],
      },
      {
        id: "require_catalyst",
        label: "Require catalyst",
        type: "toggle",
        defaultValue: true,
        hint: "Earnings, FDA, macro event, or analyst revision within horizon.",
      },
      {
        id: "sector",
        label: "Sector focus (optional)",
        type: "text",
        placeholder: "Technology, Energy …",
        defaultValue: "",
      },
      {
        id: "watchlist",
        label: "Watchlist (optional)",
        type: "text",
        placeholder: "AAPL, MSFT, NVDA …",
        defaultValue: "",
      },
    ],
  },
];

export function getAgentConfig(mode: HuntMode): AgentModeConfig {
  const config = AGENT_MODES.find((m) => m.mode === mode);
  if (!config) throw new Error(`Unknown hunt mode: ${mode}`);
  return config;
}

export function defaultFiltersForMode(mode: HuntMode): Record<string, string | number | boolean> {
  const config = getAgentConfig(mode);
  return Object.fromEntries(config.filters.map((f) => [f.id, f.defaultValue]));
}
