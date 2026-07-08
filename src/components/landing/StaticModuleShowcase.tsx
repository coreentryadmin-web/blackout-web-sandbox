import type { CSSProperties } from "react";

const MODULES = [
  {
    id: "spx",
    label: "SPX Slayer",
    tag: "0DTE desk",
    accent: "#00e676",
    headline: "Read SPX structure before the tape moves.",
    bullets: [
      "Live 0DTE gamma matrix with GEX / VEX / DEX lenses",
      "Spot ladder, dealer walls, and graded play alerts",
      "Same tape BIE uses to gate every downstream signal",
    ],
    stat: { k: "8s", v: "matrix refresh in RTH" },
  },
  {
    id: "helix",
    label: "HELIX",
    tag: "Options flow",
    accent: "#22d3ee",
    headline: "Institutional prints, not delayed screenshots.",
    bullets: [
      "Tick-by-tick unusual options activity",
      "Premium-tier filters and anomaly scoring",
      "Feeds SPX Slayer and Night Hawk playbooks",
    ],
    stat: { k: "Live", v: "UW websocket tape" },
  },
  {
    id: "thermal",
    label: "Thermal",
    tag: "Dealer gamma",
    accent: "#bf5fff",
    headline: "See where dealers are pinned.",
    bullets: [
      "Full-screen GEX heatmap across strikes & expiries",
      "Charm / DEX lenses for positioning shifts",
      "Cross-validated against live SPX rail",
    ],
    stat: { k: "Multi", v: "ticker presets" },
  },
  {
    id: "largo",
    label: "Largo",
    tag: "Desk analyst",
    accent: "#ffd23f",
    headline: "Ask the desk — get structure, not chat fluff.",
    bullets: [
      "Context-aware reads on flow, gamma, and regime",
      "Strike, invalidation, and sizing in plain language",
      "Grounded in the same live feeds as your tools",
    ],
    stat: { k: "AI", v: "structure-first answers" },
  },
  {
    id: "hawk",
    label: "Night Hawk",
    tag: "Playbook",
    accent: "#ff6b2b",
    headline: "Overnight and swing setups with receipts.",
    bullets: [
      "Graded playbook with transparent A–F log",
      "Evening scanner tied to HELIX anomalies",
      "Push alerts when structure clears gates",
    ],
    stat: { k: "A–F", v: "graded play log" },
  },
  {
    id: "vector",
    label: "Vector",
    tag: "Universe scan",
    accent: "#7c5cff",
    headline: "Broaden the hunt beyond SPX.",
    bullets: [
      "Cross-ticker flow and gamma context",
      "Ranked setups from the same BIE engine",
      "Launching as the desk expands coverage",
    ],
    stat: { k: "Soon", v: "multi-ticker radar" },
  },
] as const;

/** CSS-radio tabs — module deep-dive without client JS. */
export function StaticModuleShowcase() {
  const defaultId = MODULES[0].id;

  return (
    <section id="features" className="mkt-section">
      <div className="mkt-section-inner">
        <p className="mkt-kicker">
          <span className="mkt-kicker-dot" aria-hidden />
          Platform
        </p>
        <h2 className="mt-3 font-anton text-4xl leading-[0.92] text-white md:text-6xl">
          MULTIPLE MODULES.
          <br />
          <span className="mkt-gradient-text">ONE EDGE.</span>
        </h2>
        <p className="mkt-lede !mx-0 !mt-4 !max-w-2xl !text-left !text-sm md:!text-base">
          Every surface runs on BlackOut Intelligence — same verification gate, same live tape, no broker
          lock-in.
        </p>

        <div className="mkt-module-tabs mt-10">
          {MODULES.map((m) => (
            <input
              key={m.id}
              type="radio"
              name="mkt-module"
              id={`mkt-mod-${m.id}`}
              className="mkt-module-input"
              defaultChecked={m.id === defaultId}
            />
          ))}

          <div className="mkt-module-tablist" role="tablist" aria-label="Platform modules">
            {MODULES.map((m) => (
              <label
                key={m.id}
                htmlFor={`mkt-mod-${m.id}`}
                className="mkt-module-tab"
                style={{ "--mkt-accent": m.accent } as CSSProperties}
              >
                <span className="mkt-module-tab-label">{m.label}</span>
                <span className="mkt-module-tab-tag">{m.tag}</span>
              </label>
            ))}
          </div>

          <div className="mkt-module-panels">
            {MODULES.map((m) => (
              <article
                key={m.id}
                className="mkt-module-panel"
                data-module={m.id}
                aria-labelledby={`mkt-mod-${m.id}`}
              >
                <div className="mkt-module-copy">
                  <h3 className="font-syne text-2xl font-extrabold text-white md:text-3xl">{m.headline}</h3>
                  <ul className="mkt-module-bullets">
                    {m.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <div className="mkt-module-stat" style={{ borderColor: `${m.accent}44` }}>
                    <span className="font-anton text-3xl" style={{ color: m.accent }}>
                      {m.stat.k}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-sky-300">
                      {m.stat.v}
                    </span>
                  </div>
                </div>
                <div className="mkt-module-preview mkt-card" style={{ borderColor: `${m.accent}33` }}>
                  <div className="mkt-module-preview-bar">
                    <span className="mkt-module-preview-dot" style={{ background: m.accent }} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/60">
                      {m.label}
                    </span>
                  </div>
                  <div className="mkt-module-preview-body">
                    <div className="mkt-module-preview-line" style={{ width: "72%", background: `${m.accent}55` }} />
                    <div className="mkt-module-preview-line" style={{ width: "88%" }} />
                    <div className="mkt-module-preview-line" style={{ width: "54%" }} />
                    <div className="mkt-module-preview-grid">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <span
                          key={i}
                          className="mkt-module-preview-cell"
                          style={{
                            opacity: 0.35 + (i % 5) * 0.12,
                            background: i % 3 === 0 ? `${m.accent}33` : "rgba(255,255,255,0.06)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
