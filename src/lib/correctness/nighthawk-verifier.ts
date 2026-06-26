import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchLatestNighthawkEdition, fetchStagedDossiers } from "@/lib/db";
import type { PlaybookPlay } from "@/lib/nighthawk/types";
import {
  parseOptionsContract,
  evaluatePlayAgainstChain,
  fetchEditionChains,
  type EditionChainData,
} from "@/lib/nighthawk/option-chain-prompt";

// ---------------------------------------------------------------------------
// NIGHT HAWK (evening plays scanner / published editions) data-correctness verifier — priority #4.
//
// Re-audits the LATEST PUBLISHED edition against the DOSSIER SNAPSHOT each play was built from. These
// are INDEPENDENT checks written here — they do NOT import the unmerged auto/nighthawk-grounding module.
//
//   L2 invariant (grounding) — every published play's ticker MUST have a staged dossier snapshot for
//      that edition (a play with no dossier was not grounded in any data); ranks are 1..N unique;
//      premium-cap flag agrees with entry_premium ≤ $20; conviction/direction are in-vocabulary.
//   L1 shadow-recompute (dossier cross-check) — the per-play numbers the edition surfaces
//      (flow_streak_days, iv_rank) must equal the dossier snapshot's own values (the play can't claim
//      a flow streak / IV rank the dossier it was built from doesn't carry). Independent re-read.
//   L4 cross-provider (chain-confirm, CAPPED + GATED) — for a small sample of plays, parse the strike+
//      side from the options_play narrative and confirm it against a freshly-fetched ATM chain: strike
//      present ⇒ OI floor met (not contradicted), and the play's entry_premium is within the chain
//      bid/ask band (premium vs chain ask). This is the only layer that touches a live provider; it is
//      capped and behind CORRECTNESS_NIGHTHAWK_CHAIN (default ON, set =0 to skip in tight runs).
//
// RATE DISCIPLINE: the edition + dossiers are DB readers (one read each). The chain-confirm layer is
// the only upstream touch — it is CAPPED to CORRECTNESS_NIGHTHAWK_SAMPLE plays (default 3), fetches ONE
// ATM chain per sampled ticker through the existing rate-limited Polygon/UW funnel (fetchEditionChains),
// and is fully gateable. NO per-play fan-out beyond the cap; editions are evaluated once per run.
//
// HONESTY: dossier cross-checks are SHADOW-RECOMPUTES against the snapshot (the play vs the data it
// was built from — proves internal grounding, not that the snapshot itself was objectively right). The
// chain-confirm is the strongest claim: a strike either IS liquid in the live chain or it isn't.
// ---------------------------------------------------------------------------

const VALID_CONVICTION = new Set(["A", "B", "C", "A+", "B+", "C+"]);
const PREMIUM_CAP = 20; // per-share

function chainConfirmEnabled(): boolean {
  return process.env.CORRECTNESS_NIGHTHAWK_CHAIN !== "0";
}
function chainSample(): number {
  const raw = Number(process.env.CORRECTNESS_NIGHTHAWK_SAMPLE);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(Math.floor(raw), 8) : 3;
}

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `NIGHTHAWK:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/** Pull a numeric snapshot field from a dossier blob, trying a few key aliases. */
function dossierNum(dossier: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (k in dossier) {
      const n = num(dossier[k]);
      if (n != null) return n;
    }
  }
  // flow_streak is nested.
  const fs = dossier.flow_streak as Record<string, unknown> | undefined;
  if (fs && keys.includes("flow_streak_days")) {
    const n = num(fs.streak_days ?? fs.days ?? fs.streak);
    if (n != null) return n;
  }
  return null;
}

/**
 * Re-audit the latest published Night Hawk edition vs its dossier snapshot. Returns a TickerScore under
 * the synthetic "NIGHTHAWK" ticker. Never throws.
 */
export async function verifyNightHawk(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "NIGHTHAWK";
  const checks: CheckResult[] = [];

  let edition = null as Awaited<ReturnType<typeof fetchLatestNighthawkEdition>>;
  try {
    edition = await fetchLatestNighthawkEdition();
  } catch {
    edition = null;
  }
  if (!edition || !Array.isArray(edition.plays) || edition.plays.length === 0) {
    const skip: CheckResult = {
      id: "NIGHTHAWK:edition:freshness:cold",
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: edition
        ? `Latest edition (${edition.edition_for}) is recap-only / has no ranked plays — nothing to chain-audit this run.`
        : "No published Night Hawk edition found — nothing to verify.",
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  const plays = edition.plays as PlaybookPlay[];
  const editionFor = edition.edition_for ?? "";

  // Staged dossier snapshots for this edition.
  let dossiers: Array<{ ticker: string; dossier: Record<string, unknown>; scored: Record<string, unknown> | null }> = [];
  try {
    dossiers = editionFor ? await fetchStagedDossiers(editionFor) : [];
  } catch {
    dossiers = [];
  }
  const dossierByTicker = new Map(dossiers.map((d) => [d.ticker.toUpperCase(), d]));

  // ── L2 INVARIANT: ranks 1..N unique ──────────────────────────────────────
  {
    const ranks = plays.map((p) => Number(p.rank)).filter((r) => Number.isFinite(r));
    const unique = new Set(ranks);
    const ok = unique.size === plays.length && Math.min(...ranks) === 1 && Math.max(...ranks) === plays.length;
    checks.push(
      mk(
        "invariant",
        "ranks",
        ok ? "consistency-only" : "flag",
        ok
          ? `Edition ${editionFor}: ${plays.length} plays ranked 1..${plays.length}, unique.`
          : `Edition ${editionFor}: ranks are not a clean 1..${plays.length} unique sequence (got ${[...unique].sort((a, b) => a - b).join(",")}).`,
        { id: "ranks-unique", expected: plays.length, actual: unique.size }
      )
    );
  }

  // ── L2 INVARIANT: every play grounded in a dossier snapshot ───────────────
  if (dossiers.length === 0) {
    checks.push(
      mk(
        "invariant",
        "grounding",
        "skipped",
        `No staged dossiers found for edition ${editionFor} (staging may be pruned post-publish) — per-play grounding cross-check not assertable this run.`,
        { id: "play-has-dossier" }
      )
    );
  } else {
    const ungrounded = plays.filter((p) => !dossierByTicker.has(String(p.ticker).toUpperCase()));
    checks.push(
      mk(
        "invariant",
        "grounding",
        ungrounded.length === 0 ? "consistency-only" : "flag",
        ungrounded.length === 0
          ? `All ${plays.length} published plays have a staged dossier snapshot (grounded).`
          : `${ungrounded.length} published play(s) have NO dossier snapshot (${ungrounded.map((p) => p.ticker).join(", ")}) — a play surfaced with no underlying data.`,
        { id: "play-has-dossier", expected: 0, actual: ungrounded.length }
      )
    );
  }

  // ── L2 INVARIANT: premium-cap flag agrees with entry_premium; vocab sane ──
  {
    let capMismatch = 0;
    let badVocab = 0;
    const capDetail: string[] = [];
    for (const p of plays) {
      if (p.entry_premium != null && Number.isFinite(p.entry_premium)) {
        const impliedOk = p.entry_premium <= PREMIUM_CAP;
        if (p.premium_cap_ok != null && p.premium_cap_ok !== impliedOk) {
          capMismatch++;
          if (capDetail.length < 4) capDetail.push(`${p.ticker} prem $${p.entry_premium} cap_ok=${p.premium_cap_ok}`);
        }
        // entry_cost_per_contract == entry_premium × 100.
        if (p.entry_cost_per_contract != null) {
          const expectCost = Math.round(p.entry_premium * 100 * 100) / 100;
          if (Math.abs(p.entry_cost_per_contract - expectCost) > 0.5) {
            capMismatch++;
            if (capDetail.length < 4) capDetail.push(`${p.ticker} cost ${p.entry_cost_per_contract}!=${expectCost}`);
          }
        }
      }
      if (p.conviction && !VALID_CONVICTION.has(String(p.conviction).toUpperCase())) badVocab++;
    }
    checks.push(
      mk(
        "invariant",
        "premium",
        capMismatch === 0 ? "consistency-only" : "flag",
        capMismatch === 0
          ? `premium_cap_ok flags + entry_cost_per_contract reconcile with entry_premium across all plays (cap $${PREMIUM_CAP}).`
          : `${capMismatch} premium inconsistency(ies): ${capDetail.join("; ")} — a cap flag or cost is wrong.`,
        { id: "premium-cap-consistent", expected: 0, actual: capMismatch }
      )
    );
    checks.push(
      mk(
        "sanity-bound",
        "conviction",
        badVocab === 0 ? "consistency-only" : "flag",
        badVocab === 0
          ? "All play convictions are in-vocabulary (A/B/C grades)."
          : `${badVocab} play(s) carry an out-of-vocabulary conviction grade.`,
        { id: "conviction-vocab", expected: 0, actual: badVocab }
      )
    );
  }

  // ── L1 SHADOW-RECOMPUTE: play numbers vs the dossier snapshot they came from ─
  if (dossiers.length > 0) {
    let mismatches = 0;
    let compared = 0;
    const detail: string[] = [];
    for (const p of plays) {
      const d = dossierByTicker.get(String(p.ticker).toUpperCase());
      if (!d) continue;
      // flow_streak_days vs dossier.flow_streak.streak_days
      if (p.flow_streak_days != null && Number.isFinite(p.flow_streak_days)) {
        const dv = dossierNum(d.dossier, "flow_streak_days");
        if (dv != null) {
          compared++;
          if (Math.abs(dv - p.flow_streak_days) > 0.5) {
            mismatches++;
            if (detail.length < 5) detail.push(`${p.ticker} flow_streak play=${p.flow_streak_days} dossier=${dv}`);
          }
        }
      }
      // iv_rank vs dossier.iv_rank (tolerate small rounding).
      if (p.iv_rank != null && Number.isFinite(p.iv_rank)) {
        const dv = dossierNum(d.dossier, "iv_rank");
        if (dv != null) {
          compared++;
          const fd = fractionalDiff(dv, p.iv_rank);
          if (fd > 0.05 && Math.abs(dv - p.iv_rank) > 2) {
            mismatches++;
            if (detail.length < 5) detail.push(`${p.ticker} iv_rank play=${p.iv_rank} dossier=${dv}`);
          }
        }
      }
    }
    checks.push(
      mk(
        "shadow-recompute",
        "play_vs_dossier",
        compared === 0 ? "skipped" : mismatches === 0 ? "consistency-only" : "flag",
        compared === 0
          ? "Dossier snapshots carry no comparable flow_streak/iv_rank fields this edition — play-vs-dossier cross-check skipped."
          : mismatches === 0
            ? `Per-play flow_streak_days + iv_rank match the dossier snapshot each play was built from (${compared} comparisons).`
            : `${mismatches} play number(s) DISAGREE with their dossier snapshot: ${detail.join("; ")} — a play claims a value its source data doesn't carry.`,
        { id: "play-vs-dossier", expected: 0, actual: mismatches }
      )
    );
  }

  // ── L4 CROSS-PROVIDER: chain-confirm a sample of strikes (capped + gated) ──
  if (!chainConfirmEnabled() || chainSample() === 0) {
    checks.push(
      mk(
        "cross-provider",
        "strike",
        "consistency-only",
        "Chain-confirm disabled (CORRECTNESS_NIGHTHAWK_CHAIN=0) — strikes are dossier-grounded but NOT live-chain confirmed this run.",
        { id: "strike-chain-confirm" }
      )
    );
  } else {
    // Sample the top-ranked plays whose options_play has a parseable strike.
    const parseable = plays
      .map((p) => ({ play: p, parsed: parseOptionsContract(p.options_play ?? "") }))
      .filter((x) => x.parsed != null)
      .sort((a, b) => Number(a.play.rank) - Number(b.play.rank))
      .slice(0, chainSample());

    if (parseable.length === 0) {
      checks.push(
        mk(
          "cross-provider",
          "strike",
          "consistency-only",
          "No play's options_play narrative carries a parseable strike — chain-confirm not applicable this run (strikes remain dossier-grounded).",
          { id: "strike-chain-confirm" }
        )
      );
    } else {
      const sampleTickers = Array.from(new Set(parseable.map((x) => x.play.ticker.toUpperCase())));
      let chains: Record<string, EditionChainData> = {};
      try {
        chains = await fetchEditionChains({ stockTickers: sampleTickers, dossiers: [] });
      } catch {
        chains = {};
      }

      let confirmed = 0;
      let contradicted = 0;
      let premiumMismatch = 0;
      let unmatched = 0;
      const contraDetail: string[] = [];
      const premDetail: string[] = [];
      for (const { play, parsed } of parseable) {
        const chain = chains[play.ticker.toUpperCase()];
        if (!chain || !chain.rows.length) {
          unmatched++;
          continue;
        }
        const verdict = evaluatePlayAgainstChain(play.options_play ?? "", chain.rows);
        if (verdict.contradicted) {
          contradicted++;
          if (contraDetail.length < 5) contraDetail.push(`${play.ticker} ${play.options_play}`);
          continue;
        }
        if (verdict.verified) {
          confirmed++;
          // Premium vs chain ask (only when we matched the exact strike+expiry row).
          if (play.entry_premium != null && parsed) {
            const row = chain.rows.find(
              (r) => Math.abs(r.strike - parsed.strike) < 1e-6 && (!parsed.expiryYmd || r.expiry === parsed.expiryYmd)
            );
            if (row) {
              const ask = parsed.side === "call" ? row.call_ask : row.put_ask;
              const bid = parsed.side === "call" ? row.call_bid : row.put_bid;
              if (ask != null && ask > 0) {
                // Play entry_premium should sit within [bid×0.5, ask×1.5] — generous, catches a 10× scale slip.
                const lo = bid != null && bid > 0 ? bid * 0.5 : 0;
                const hi = ask * 1.5;
                if (play.entry_premium < lo || play.entry_premium > hi) {
                  premiumMismatch++;
                  if (premDetail.length < 5)
                    premDetail.push(`${play.ticker} entry $${play.entry_premium} vs chain bid/ask ${bid}/${ask}`);
                }
              }
            }
          }
        } else {
          unmatched++; // present in neither / longer-dated than the ATM window — not a contradiction
        }
      }

      checks.push(
        mk(
          "cross-provider",
          "strike",
          contradicted === 0 ? (confirmed > 0 ? "pass" : "consistency-only") : "flag",
          contradicted === 0
            ? confirmed > 0
              ? `${confirmed}/${parseable.length} sampled play strikes INDEPENDENTLY CONFIRMED in the live chain (strike present + OI floor met); ${unmatched} outside the ATM/front-expiry window (not contradicted).`
              : `Sampled play strikes could not be matched in the narrow ATM window (${unmatched} outside it) — no contradiction, but none confirmed this run.`
            : `${contradicted} sampled play(s) are CONTRADICTED by the live chain (strike present but OI below the liquidity floor): ${contraDetail.join("; ")}.`,
          {
            id: "strike-chain-confirm",
            expected: 0,
            actual: contradicted,
            independentlyConfirmed: contradicted === 0 && confirmed > 0,
          }
        )
      );

      if (premiumMismatch > 0 || confirmed > 0) {
        checks.push(
          mk(
            "cross-provider",
            "premium",
            premiumMismatch === 0 ? "pass" : "flag",
            premiumMismatch === 0
              ? `Sampled play entry premiums sit within the live chain bid/ask band (confirmed against ${confirmed} matched strike(s)).`
              : `${premiumMismatch} play premium(s) are OUTSIDE the chain bid/ask band: ${premDetail.join("; ")} — entry premium doesn't match the live market (scale/quote error).`,
            { id: "premium-vs-chain-ask", expected: 0, actual: premiumMismatch, independentlyConfirmed: premiumMismatch === 0 }
          )
        );
      }
    }
  }

  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
