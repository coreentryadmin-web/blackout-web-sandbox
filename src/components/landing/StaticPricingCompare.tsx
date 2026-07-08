import Link from "next/link";

type CompareValue = boolean | "partial";

const ROWS: { feature: string; blackout: boolean; typical: CompareValue }[] = [
  { feature: "Live options flow (tick-by-tick)", blackout: true, typical: false },
  { feature: "0DTE SPX gamma matrix", blackout: true, typical: false },
  { feature: "Dealer GEX / charm heatmaps", blackout: true, typical: "partial" },
  { feature: "AI desk analyst on live tape", blackout: true, typical: false },
  { feature: "Graded play log (A–F)", blackout: true, typical: false },
  { feature: "No broker lock-in", blackout: true, typical: "partial" },
  { feature: "One membership · all modules", blackout: true, typical: false },
];

function Cell({ value }: { value: CompareValue }) {
  if (value === true) return <span className="mkt-compare-yes">✓</span>;
  if (value === "partial") return <span className="mkt-compare-partial">~</span>;
  return <span className="mkt-compare-no">—</span>;
}

/** Homepage pricing teaser — full plans on /pricing. */
export function StaticPricingCompare() {
  return (
    <section id="pricing-teaser" className="mkt-section">
      <div className="mkt-section-inner">
        <p className="mkt-kicker justify-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Why BlackOut
        </p>
        <h2 className="mt-3 text-center font-anton text-4xl leading-[0.92] text-white md:text-5xl">
          SAME TOOLKIT.
          <br />
          <span className="mkt-gradient-text">BETTER STACK.</span>
        </h2>
        <p className="mkt-lede text-center">
          Retail platforms stitch delayed feeds and chat bots. We ship one verified desk — priced for traders
          who already pay for edge.
        </p>

        <div className="mkt-compare-cards mt-10">
          <div className="mkt-compare-card mkt-compare-card-primary">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-bull">BlackOut</p>
            <p className="mt-2 font-anton text-4xl text-white">
              $199<span className="font-syne text-base font-semibold text-sky-300">/mo</span>
            </p>
            <p className="mt-1 text-sm text-sky-300">All six modules · one membership</p>
          </div>
          <div className="mkt-compare-card">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Typical stack</p>
            <p className="mt-2 font-anton text-4xl text-white/70">
              $300+<span className="font-syne text-base font-semibold text-sky-300/60">/mo</span>
            </p>
            <p className="mt-1 text-sm text-sky-300/70">Flow + gamma + chat · stitched together</p>
          </div>
        </div>

        <div className="mkt-compare-wrap mt-6">
          <table className="mkt-compare-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col" className="mkt-compare-highlight">
                  BlackOut
                </th>
                <th scope="col">Typical retail stack</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.feature}>
                  <td>{r.feature}</td>
                  <td className="mkt-compare-highlight">
                    <Cell value={r.blackout} />
                  </td>
                  <td>
                    <Cell value={r.typical} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mkt-cta-row mt-10">
          <Link
            href="/pricing"
            prefetch={false}
            className="landing-btn-primary inline-flex min-w-[200px] items-center justify-center px-8 py-3 font-syne text-sm font-bold uppercase tracking-[0.2em]"
          >
            View pricing
          </Link>
          <Link
            href="/sign-up"
            prefetch={false}
            className="landing-btn-ghost inline-flex min-w-[200px] items-center justify-center border border-white/20 px-8 py-3 font-syne text-sm font-bold uppercase tracking-[0.2em] text-white"
          >
            Start trading
          </Link>
        </div>
      </div>
    </section>
  );
}
