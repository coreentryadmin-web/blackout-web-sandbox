import type { LottoPhase } from "@/lib/spx-lotto-store";
import type { SpxPlayDirection } from "@/lib/spx-signals";

export type LottoNoneReason =
  | "off_hours"
  | "no_qualify"
  | "expired"
  | "stopped"
  | "invalidated_no_reversal"
  | "max_picks"
  | "closed_for_today";

export type LottoCopyLine = {
  kicker: string;
  headline: string;
  thesis: string;
  footnote?: string;
};

export function lottoPhaseKicker(phase: LottoPhase, isReversal = false): string {
  switch (phase) {
    case "SCAN":
      return "Scanning";
    case "WATCH":
      return isReversal ? "Thesis flipped" : "Setup armed";
    case "BUY":
      return "Entry live";
    case "HOLD":
      return "Position open";
    case "SELL":
      return "Target reached";
    case "INVALID":
      return "Stopped out";
    default:
      return "0DTE standby";
  }
}

export function lottoNoneCopy(reason: LottoNoneReason): LottoCopyLine {
  switch (reason) {
    case "off_hours":
      return {
        kicker: "0DTE standby",
        headline: "Pre-market scan resumes at the open.",
        thesis: "The 0DTE window opens 7:00 AM ET — catalysts, gap and flow get scored then.",
      };
    case "no_qualify":
      return {
        kicker: "No setup",
        headline: "No 0DTE setup cleared the filter today.",
        thesis: "Catalyst thin or direction split — the desk waits rather than force a play.",
      };
    case "expired":
      return {
        kicker: "Window closed",
        headline: "10:30 ET — the 0DTE entry window is closed.",
        thesis: "Far-OTM premium decays fast past the open. No entry surfaced inside the window.",
      };
    case "stopped":
      return {
        kicker: "Stopped out",
        headline: "Stopped — −8pt from entry.",
        thesis: "0DTE premium decays fast against you. Defined risk, small size — that's the point.",
      };
    case "invalidated_no_reversal":
      return {
        kicker: "Invalidated",
        headline: "Thesis invalidated at the open — no reversal setup.",
        thesis: "Price ran ≥8pt against the anchor before fill. Reversal scan surfaced nothing.",
      };
    case "max_picks":
      return {
        kicker: "Daily limit",
        headline: "0DTE setups capped for the day.",
        thesis: "Primary and reversal both used. The main desk stays live for the rest of the session.",
      };
    case "closed_for_today":
      return {
        kicker: "Session closed",
        headline: "0DTE session closed for today.",
        thesis: "Last setup settled. The scan re-arms at the next pre-market open.",
      };
  }
}

export function lottoWatchHeadline(
  direction: SpxPlayDirection,
  strike: number,
  targetPts: number,
  isReversal: boolean
): string {
  const side = direction === "long" ? "CALL" : "PUT";
  const setup = isReversal ? "Reversal" : "Breakout";
  return `${side} ${setup} · ${strike} strike · ±${targetPts}pt range`;
}

export function lottoWatchThesis(catalystSummary: string, isReversal: boolean): string {
  if (isReversal) {
    return `Plot twist: ${catalystSummary} — second ticket, same rules, new anchor.`;
  }
  return `Morning thesis locked: ${catalystSummary}`;
}

export function lottoWatchStatusMessage(
  isReversal: boolean,
  ticketBlocked: boolean,
  blockReason?: string | null
): string {
  if (ticketBlocked) {
    return `${blockReason ?? "Chain estimate only"} · defined risk, small size — treat it as a probe, not a core position`;
  }
  if (isReversal) {
    return "Reversal armed — waiting for the open to confirm the flip.";
  }
  return "Setup armed — waiting for the bell and an 8pt confirm at cash open.";
}

export function lottoBuyStatusMessage(): string {
  return "Open confirmed — entry live. Tracked separately from main desk plays.";
}

export function lottoHoldStatusMessage(): string {
  return "Position open — far OTM, max theta. High decay, defined risk.";
}

export function lottoWinStatusMessage(targetPts: number): string {
  return `Target reached — +${targetPts}pt from entry. Manage your own exit.`;
}

export function lottoPanelLoadingCopy(): LottoCopyLine {
  return {
    kicker: "Acquiring",
    headline: "Scoring catalysts, flow, and the overnight gap…",
    thesis: "Stand by — the scan surfaces a setup or stands down.",
    footnote: "Scanning pre-market intel",
  };
}

export function lottoPanelOffHoursCopy(): LottoCopyLine {
  return lottoNoneCopy("off_hours");
}

export function lottoPanelEmptyCopy(engineHeadline?: string | null): LottoCopyLine {
  const base = lottoNoneCopy("no_qualify");
  if (!engineHeadline || engineHeadline === "No lottos today") return base;
  return {
    ...base,
    thesis: engineHeadline,
  };
}
