export type HuntMode = "day" | "swing" | "leap";

export type PlaybookPlay = {
  rank: number;
  ticker: string;
  direction: string;
  conviction: string;
  play_type: "stock" | "index" | "etf";
  thesis: string;
  key_signal: string;
  entry_range: string;
  target: string;
  stop: string;
  options_play: string;
  score: number;
  flow_streak_days?: number;
  iv_rank?: number;
};

export type NightHawkEdition = {
  available: boolean;
  edition_for: string | null;
  published_at: string | null;
  recap_headline: string | null;
  recap_summary: string | null;
  plays: PlaybookPlay[];
};

export type AgentFilterValues = Record<string, string | number | boolean>;

export type HuntRequest = {
  mode: HuntMode;
  filters: AgentFilterValues;
};

export type HuntPlay = {
  ticker: string;
  direction: string;
  thesis: string;
  contract: string;
  entry: string;
  target: string;
  stop: string;
  score: number;
};

export type HuntResponse = {
  status: "queued" | "complete" | "error";
  mode: HuntMode;
  scanned_at: string;
  message: string;
  plays: HuntPlay[];
};
