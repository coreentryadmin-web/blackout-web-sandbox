/**
 * Confluence engine for Vector — CTO roadmap #7, slice 1 (pure math).
 *
 * The product now derives many INDEPENDENT price levels: dealer-gamma walls (call/put), the gamma
 * flip, max pain, the auto-fib golden pocket, session/prior-day levels, floor pivots. A level is
 * interesting; SEVERAL independent levels stacked within a fraction of a percent is a trade
 * location. This engine clusters whatever levels the caller supplies and scores each cluster, so
 * the terminal can rank "where multiple things agree" instead of the member eyeballing overlap.
 *
 * Pure and dependency-free: the caller passes the levels it has (this module does not fetch or
 * recompute anything — no hidden coupling to the data layer, trivially unit-testable). Scoring is
 * a transparent weighted sum, weights visible in DEFAULT_WEIGHTS: dealer positioning (walls/flip)
 * counts most — it's the product's core signal — then pocket/max-pain, then classical levels. A
 * cluster only ranks as CONFLUENCE with ≥2 DISTINCT kinds: five fib lines on top of each other is
 * one signal repeated, not five signals agreeing.
 */

export type ConfluenceKind =
  | "call-wall"
  | "put-wall"
  | "gamma-flip"
  | "max-pain"
  | "golden-pocket"
  | "hod"
  | "lod"
  | "pdh"
  | "pdl"
  | "pivot";

export type ConfluenceLevel = {
  price: number;
  kind: ConfluenceKind;
  /** Optional label carried through to the zone (e.g. "757C wall 67/100"). */
  label?: string;
  /** Override the kind's default weight (e.g. scale a wall by its integrity score). */
  weight?: number;
};

export type ConfluenceZone = {
  /** Weighted-average price of the cluster — where to draw/cite the zone. */
  center: number;
  low: number;
  high: number;
  /** Transparent weighted sum — see DEFAULT_WEIGHTS. */
  score: number;
  /** Distinct kinds agreeing here (drives the ≥2 confluence bar). */
  kinds: ConfluenceKind[];
  levels: ConfluenceLevel[];
};

/** Dealer positioning outranks derived/classical levels — it is the product's core signal. */
export const DEFAULT_WEIGHTS: Record<ConfluenceKind, number> = {
  "call-wall": 3,
  "put-wall": 3,
  "gamma-flip": 2.5,
  "max-pain": 2,
  "golden-pocket": 2,
  pdh: 1.5,
  pdl: 1.5,
  pivot: 1.5,
  hod: 1,
  lod: 1,
};

/**
 * Cluster levels within `tolPct` of spot (default 0.15%) and score each cluster. Greedy
 * nearest-neighbour merge over the price-sorted list: a level joins the current cluster while it
 * is within tolerance of the cluster's LAST member (chain distance — adjacent levels merge even if
 * the whole zone spans slightly more, which is how stacked levels actually read on a chart).
 * Returns zones with ≥2 DISTINCT kinds, strongest first; ties break toward the zone nearest spot.
 */
export function confluenceZones(
  levels: readonly ConfluenceLevel[],
  spot: number,
  tolPct = 0.0015
): ConfluenceZone[] {
  if (!(spot > 0)) return [];
  const clean = levels.filter((l) => Number.isFinite(l.price) && l.price > 0);
  if (clean.length < 2) return [];
  const tol = spot * tolPct;
  const sorted = [...clean].sort((a, b) => a.price - b.price);

  const clusters: ConfluenceLevel[][] = [];
  let current: ConfluenceLevel[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const l = sorted[i]!;
    if (l.price - current[current.length - 1]!.price <= tol) current.push(l);
    else {
      clusters.push(current);
      current = [l];
    }
  }
  clusters.push(current);

  const zones: ConfluenceZone[] = [];
  for (const c of clusters) {
    const kinds = [...new Set(c.map((l) => l.kind))];
    if (kinds.length < 2) continue; // one signal repeated is not confluence
    let score = 0;
    let weighted = 0;
    for (const l of c) {
      const w = l.weight ?? DEFAULT_WEIGHTS[l.kind];
      score += w;
      weighted += w * l.price;
    }
    zones.push({
      center: weighted / score,
      low: c[0]!.price,
      high: c[c.length - 1]!.price,
      score,
      kinds,
      levels: c,
    });
  }
  return zones.sort(
    (a, b) => b.score - a.score || Math.abs(a.center - spot) - Math.abs(b.center - spot)
  );
}

const KIND_LABEL: Record<ConfluenceKind, string> = {
  "call-wall": "call wall",
  "put-wall": "put wall",
  "gamma-flip": "gamma flip",
  "max-pain": "max pain",
  "golden-pocket": "golden pocket",
  hod: "HOD",
  lod: "LOD",
  pdh: "PDH",
  pdl: "PDL",
  pivot: "pivot",
};

/**
 * Terminal-ready callout strings for the top zones — formatted HERE (where spot is known) so the
 * terminal just prints lines: "7,472.5 (1.36% below) — put wall + golden pocket + PDL · score 6.5".
 */
export function confluenceCallouts(zones: readonly ConfluenceZone[], spot: number): string[] {
  if (!(spot > 0)) return [];
  return zones.map((z) => {
    const pct = ((z.center - spot) / spot) * 100;
    const side = pct >= 0 ? "above" : "below";
    const kinds = z.kinds.map((k) => KIND_LABEL[k]).join(" + ");
    const center = Math.round(z.center * 100) / 100;
    return `${center.toLocaleString("en-US")} (${Math.abs(pct).toFixed(2)}% ${side}) — ${kinds} · score ${z.score}`;
  });
}
