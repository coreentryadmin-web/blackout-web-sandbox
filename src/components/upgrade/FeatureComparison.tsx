import { FEATURE_MATRIX } from "@/lib/upsell-features";
import { ProductMark } from "@/components/marks/ProductMark";

// Product rows carry their sigil via row.mark (a stable product id on the
// matrix), so a copy edit can't break the lookup — the old LABEL_TO_MARK map
// was keyed on stale display strings and rendered zero sigils.

// Presentational only. Server component (no hooks). Free-vs-Premium matrix on the
// emerald brand — no grey, no purple (bull / bear / white / sky tokens only).
export function FeatureComparison() {
  return (
    <section className="mx-auto mt-16 max-w-3xl text-left" aria-label="Plan comparison">
      <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.4em] text-bull">
        Free vs Premium
      </p>

      <div className="overflow-hidden rounded-2xl border border-bull/15 bg-[#050608]/60 backdrop-blur-md">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-white/10 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">Feature</span>
          <span className="w-16 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-bear">Free</span>
          <span className="w-20 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-bull">Premium</span>
        </div>

        {FEATURE_MATRIX.map((row, i) => (
          <div
            key={row.label}
            className={
              "grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-3 transition-colors hover:bg-bull/5" +
              (i < FEATURE_MATRIX.length - 1 ? " border-b border-white/5" : "")
            }
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold leading-tight text-white">
                {row.mark && (
                  <ProductMark product={row.mark} size={22} animated={false} className="shrink-0" />
                )}
                {row.label}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-sky-300">{row.detail}</p>
            </div>
            <span className="w-16 text-center text-base" aria-label={row.free ? "Included" : "Not included"}>
              {row.free ? <span className="text-bull">✓</span> : <span className="text-bear">—</span>}
            </span>
            <span className="w-20 text-center text-base" aria-label={row.premium ? "Included" : "Not included"}>
              {row.premium ? <span className="text-bull">✓</span> : <span className="text-bear">—</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
