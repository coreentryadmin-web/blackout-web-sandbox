/** Shape returned by GET /api/track-record — do not change without API coordination. */
export interface SpxStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
}

export interface NhStats {
  total: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgWinnerPct: number | null;
  avgLoserPct: number | null;
  profitFactor: number | null;
}

export interface TrackRecordPayload {
  spxSlayer: SpxStats;
  nightHawk: NhStats;
  methodology: string;
  liveData?: boolean;
  available?: boolean;
}

export type TrackRecordLoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; data: TrackRecordPayload; fetchedAt: Date };
