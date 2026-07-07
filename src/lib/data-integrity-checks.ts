import "server-only";

import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { fetchStockSnapshot } from "@/lib/providers/polygon";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import type { SpxAdminIssue } from "@/lib/admin-spx-issues";

// ---------------------------------------------------------------------------
// RTH data-integrity sweep — cross-validate the numbers EVERY tool shows against
// each other and against their own inputs. This is the numeric-correctness pass
// that render/interaction sweeps don't cover: it answers "is the price SPX Slayer
// shows the same one Heat Maps and the quote tape show, and does the desk's own
// change% match its price ÷ prior close".
//
// DESIGN — built to NEVER false-positive (so auto-opened incidents stay trustworthy):
//   • Every check requires BOTH sides present + fresh; a cold/missing source skips
//     the comparison (the dedicated freshness check is the one that flags cold data).
//   • Bands are WIDE — set well outside normal timing jitter / tracking basis, so a
//     fired issue means a genuinely stuck/wrong/stale number, not noise.
//   • All issues use category `data-integrity` (namespace-scoped reconcile in
//     admin-incidents) and a STABLE title (live numbers live in `detail`, not the
//     title) so the same discrepancy upserts one incident instead of spamming.
//   • Only runs the cross-checks when the market is actually open (merged.market_open);
//     pre/post-market thin data is legitimately stale and must not flag.
//
// v1 keeps every issue at `warning` severity — they open incidents and bump the
// Ops WARNING count without screaming CRITICAL while the bands settle in. Severity
// and the check set are intended to grow (see Task #4).
// ---------------------------------------------------------------------------

const CATEGORY = "data-integrity";

/** Symmetric percent difference between two positive numbers. */
function pctDiff(a: number, b: number): number {
  const mid = (a + b) / 2;
  if (!(mid > 0)) return 0;
  return (Math.abs(a - b) / mid) * 100;
}

function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export type DataIntegrityResult = {
  marketOpen: boolean;
  /** Number of cross-checks actually evaluated (both sides present). */
  checked: number;
  issues: SpxAdminIssue[];
};

/**
 * Run the cross-tool numeric-consistency sweep. Returns the set of discrepancy
 * issues (empty when everything agrees, or when the market is closed). Never throws
 * on a single missing source — a cold source just skips its comparisons.
 */
export async function runDataIntegrityChecks(): Promise<DataIntegrityResult> {
  const issues: SpxAdminIssue[] = [];
  let checked = 0;

  const add = (title: string, detail: string): void => {
    issues.push({ id: `${CATEGORY}:${title}`, severity: "warning", category: CATEGORY, title, detail });
  };

  const { merged } = await loadMergedSpxDesk();
  const marketOpen = merged.market_open === true;

  // Pull the same numbers each tool consumes — desk (SPX Slayer), the canonical GEX
  // matrix for SPX + SPY (Heat Maps / Largo / Night's Watch all read this), and the
  // SPY quote tape. Cache-readers / snapshots — no extra upstream pressure.
  const [spySnap, gexSpx, gexSpy] = await Promise.all([
    fetchStockSnapshot("SPY").catch(() => null),
    getGexPositioning("SPX").catch(() => null),
    getGexPositioning("SPY").catch(() => null),
  ]);

  if (!marketOpen) {
    // Market closed → numbers legitimately stale; nothing to validate. Empty issue
    // set also auto-resolves any lingering data-integrity incidents from the session.
    return { marketOpen: false, checked: 0, issues };
  }

  // C1 — desk internal consistency: spx_change_pct must reconstruct from price ÷ prior_close.
  if (merged.available && merged.price > 0 && merged.prior_close != null && merged.prior_close > 0) {
    checked++;
    const implied = ((merged.price - merged.prior_close) / merged.prior_close) * 100;
    if (Math.abs(implied - merged.spx_change_pct) > 0.1) {
      add(
        "SPX desk change% inconsistent with price/prior-close",
        `desk change ${merged.spx_change_pct.toFixed(2)}% but price ${num(merged.price)} vs prior close ${num(
          merged.prior_close
        )} implies ${implied.toFixed(2)}%`
      );
    }
  }

  // C2 — cross-tool SPX spot: SPX Slayer desk vs the GEX matrix Heat Maps/Largo read.
  if (merged.available && merged.price > 0 && gexSpx && gexSpx.spot > 0) {
    checked++;
    const d = pctDiff(merged.price, gexSpx.spot);
    if (d > 0.5) {
      add(
        "SPX spot disagreement (desk vs heatmap)",
        `desk ${num(merged.price)} vs heatmap ${num(gexSpx.spot)} — ${d.toFixed(2)}% apart (one source is stuck/stale)`
      );
    }
  }

  // C3 — cross-tool SPY spot: quote tape vs the GEX matrix.
  if (spySnap && spySnap.price > 0 && gexSpy && gexSpy.spot > 0) {
    checked++;
    const d = pctDiff(spySnap.price, gexSpy.spot);
    if (d > 0.5) {
      add(
        "SPY spot disagreement (quote vs heatmap)",
        `quote ${num(spySnap.price)} vs heatmap ${num(gexSpy.spot)} — ${d.toFixed(2)}% apart`
      );
    }
  }

  // C4 — SPY/SPX tracking band: SPY×10 should track SPX within ~0.4% (post-ex-div basis).
  // A >1.5% gap means a grossly wrong/stuck price on one of them, not normal tracking.
  if (gexSpx && gexSpx.spot > 0 && gexSpy && gexSpy.spot > 0) {
    checked++;
    const offset = ((gexSpy.spot * 10 - gexSpx.spot) / gexSpx.spot) * 100;
    if (Math.abs(offset) > 1.5) {
      add(
        "SPY/SPX tracking out of band",
        `SPY ${num(gexSpy.spot)} ×10 = ${num(gexSpy.spot * 10)} vs SPX ${num(gexSpx.spot)} — ${offset.toFixed(
          2
        )}% (normal ≈ -0.4%)`
      );
    }
  }

  // C5 — max-pain scaling consistency: SPX max-pain vs SPY max-pain ×10 (same matrix, both tickers).
  if (gexSpx?.max_pain != null && gexSpx.max_pain > 0 && gexSpy?.max_pain != null && gexSpy.max_pain > 0) {
    checked++;
    const d = pctDiff(gexSpx.max_pain, gexSpy.max_pain * 10);
    if (d > 2) {
      add(
        "Max-pain SPX vs SPY scaling mismatch",
        `SPX max-pain ${num(gexSpx.max_pain)} vs SPY ${num(gexSpy.max_pain)} ×10 = ${num(
          gexSpy.max_pain * 10
        )} — ${d.toFixed(2)}% apart`
      );
    }
  }

  // C6 — heatmap freshness during RTH. Heat Maps Warm runs every ~30s, so a >15-min-old
  // (or cold) SPX/SPY matrix during the session is a real stall, not a warm-up gap.
  const now = Date.now();
  for (const [label, pos] of [["SPX", gexSpx], ["SPY", gexSpy]] as const) {
    if (!pos) {
      add(`GEX ${label} cold during RTH`, `getGexPositioning("${label}") returned no matrix while market is open`);
      continue;
    }
    checked++;
    const ageMin = (now - new Date(pos.asof).getTime()) / 60000;
    if (Number.isFinite(ageMin) && ageMin > 15) {
      add(`GEX ${label} stale during RTH`, `${label} matrix last computed ${ageMin.toFixed(0)}m ago (asof ${pos.asof})`);
    }
  }

  return { marketOpen: true, checked, issues };
}
