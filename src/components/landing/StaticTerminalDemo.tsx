const LOG_LINES = [
  { t: "09:31:04", level: "info", msg: "BIE gate · SPX 0DTE structure aligned · gamma wall 6025" },
  { t: "09:31:11", level: "flow", msg: "HELIX · SPXW 6030C sweep · $1.2M prem · bullish bias" },
  { t: "09:31:18", level: "score", msg: "Largo read · invalidation 6018 · target cluster 6040" },
  { t: "09:31:26", level: "alert", msg: "SPX Slayer · graded B+ · dealer pin lift · tape confirms" },
  { t: "09:31:33", level: "info", msg: "Thermal · charm flip zone · 6010–6020 concentration" },
  { t: "09:31:41", level: "flow", msg: "HELIX · QQQ put block · hedge print · context only" },
  { t: "09:31:48", level: "score", msg: "Night Hawk · playbook queued · push after RTH gate" },
  { t: "09:31:55", level: "info", msg: "Verification · cross-check UW · snapshot fresh" },
];

const LEVEL_COLOR: Record<string, string> = {
  info: "#7dd3fc",
  flow: "#22d3ee",
  score: "#ffd23f",
  alert: "#00e676",
};

/** CSS-only desk terminal mock — split layout on desktop. */
export function StaticTerminalDemo() {
  return (
    <section id="desk" className="mkt-section mkt-section-alt border-b-0">
      <div className="mkt-section-inner mkt-terminal-layout">
        <div className="mkt-terminal-copy">
          <p className="mkt-kicker">
            <span className="mkt-kicker-dot" aria-hidden />
            Live desk
          </p>
          <h2 className="mt-3 font-anton text-4xl text-white md:text-5xl">
            STRUCTURE IN <span className="mkt-gradient-text">REAL TIME.</span>
          </h2>
          <p className="mkt-lede !mx-0 !mt-4 !max-w-xl !text-left !text-sm md:!text-base">
            Dense, timestamped, and gated before it reaches your broker. Every line is tied to the same live
            feeds powering SPX Slayer, HELIX, and Largo.
          </p>
          <ul className="mkt-terminal-points">
            <li>Verification gate on every alert</li>
            <li>Cross-tool context in one log</li>
            <li>No chat box — desk-native output</li>
          </ul>
        </div>

        <div className="mkt-terminal" aria-label="Example desk log (illustrative)">
          <div className="mkt-terminal-chrome">
            <span className="mkt-terminal-dot mkt-terminal-dot-red" />
            <span className="mkt-terminal-dot mkt-terminal-dot-amber" />
            <span className="mkt-terminal-dot mkt-terminal-dot-green" />
            <span className="mkt-terminal-title font-mono text-[10px] uppercase tracking-[0.35em] text-white/50">
              blackout · desk log
            </span>
            <span className="mkt-terminal-live font-mono text-[10px] uppercase tracking-[0.2em] text-bull">
              illustrative
            </span>
          </div>
          <div className="mkt-terminal-body">
            <ul className="mkt-terminal-log">
              {LOG_LINES.map((line) => (
                <li key={line.t + line.msg} className="mkt-terminal-line">
                  <time className="mkt-terminal-time">{line.t}</time>
                  <span className="mkt-terminal-level" style={{ color: LEVEL_COLOR[line.level] }}>
                    {line.level}
                  </span>
                  <span className="mkt-terminal-msg">{line.msg}</span>
                </li>
              ))}
            </ul>
            <div className="mkt-terminal-cursor" aria-hidden />
            <div className="mkt-terminal-fade" aria-hidden />
          </div>
        </div>
      </div>
    </section>
  );
}
