import type { CSSProperties } from "react";

type Props = {
  moduleId: string;
  label: string;
  accent: string;
};

/** Per-module CSS mock — replaces generic placeholder blocks. */
export function ModulePreviewMock({ moduleId, label, accent }: Props) {
  const style = { "--mkt-accent": accent } as CSSProperties;

  return (
    <div className={`mkt-module-preview mkt-card mkt-preview-${moduleId}`} style={{ borderColor: `${accent}33`, ...style }}>
      <div className="mkt-module-preview-bar">
        <span className="mkt-module-preview-dot" style={{ background: accent }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/60">{label}</span>
      </div>
      <div className="mkt-module-preview-body mkt-preview-body">
        {moduleId === "spx" && <SpxPreview />}
        {moduleId === "helix" && <HelixPreview accent={accent} />}
        {moduleId === "thermal" && <ThermalPreview accent={accent} />}
        {moduleId === "largo" && <LargoPreview accent={accent} />}
        {moduleId === "hawk" && <HawkPreview accent={accent} />}
        {moduleId === "vector" && <VectorPreview accent={accent} />}
      </div>
    </div>
  );
}

function SpxPreview() {
  return (
    <div className="mkt-preview-spx">
      <div className="mkt-preview-spx-spot">SPX 6,028 · spot row</div>
      <div className="mkt-preview-matrix">
        {Array.from({ length: 20 }).map((_, i) => (
          <span key={i} className="mkt-preview-matrix-cell" data-hot={i % 7 === 3 || i === 11 ? "1" : undefined} />
        ))}
      </div>
    </div>
  );
}

function HelixPreview({ accent }: { accent: string }) {
  const rows = [
    { sym: "SPXW", strike: "6030C", prem: "$1.2M", side: "bull" },
    { sym: "SPY", strike: "598P", prem: "$840K", side: "bear" },
    { sym: "QQQ", strike: "520C", prem: "$620K", side: "bull" },
    { sym: "IWM", strike: "210P", prem: "$310K", side: "bear" },
  ];
  return (
    <ul className="mkt-preview-tape">
      {rows.map((r) => (
        <li key={r.strike} className={`mkt-preview-tape-row mkt-preview-tape-${r.side}`}>
          <span>{r.sym}</span>
          <span>{r.strike}</span>
          <span style={{ color: accent }}>{r.prem}</span>
        </li>
      ))}
    </ul>
  );
}

function ThermalPreview({ accent }: { accent: string }) {
  return (
    <div className="mkt-preview-heatmap">
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="mkt-preview-heat-cell"
          style={{
            background: `color-mix(in srgb, ${accent} ${12 + (i % 6) * 14}%, transparent)`,
          }}
        />
      ))}
    </div>
  );
}

function LargoPreview({ accent }: { accent: string }) {
  return (
    <div className="mkt-preview-largo">
      <p className="mkt-preview-largo-q">Where is invalidation on this 6030 call sweep?</p>
      <p className="mkt-preview-largo-a" style={{ borderColor: `${accent}44` }}>
        <span style={{ color: accent }}>Largo</span> · Hold above 6022 gamma shelf. Target 6040 cluster. Size
        down if charm flips under 6025.
      </p>
    </div>
  );
}

function HawkPreview({ accent }: { accent: string }) {
  return (
    <div className="mkt-preview-hawk">
      <div className="mkt-preview-grade" style={{ borderColor: `${accent}55`, color: accent }}>
        B+
      </div>
      <ul className="mkt-preview-hawk-log">
        <li>Playbook · NVDA swing · structure aligned</li>
        <li>Invalidation · 118.40 · logged at trigger</li>
        <li>Result · pending · transparent ledger</li>
      </ul>
    </div>
  );
}

function VectorPreview({ accent }: { accent: string }) {
  return (
    <div className="mkt-preview-vector">
      <div className="mkt-preview-radar">
        <span className="mkt-preview-radar-ring" />
        <span className="mkt-preview-radar-ring mkt-preview-radar-ring-2" />
        <span className="mkt-preview-radar-blip" style={{ background: accent }} />
      </div>
      <ul className="mkt-preview-vector-list">
        <li>SPX · flow rank #1</li>
        <li>NVDA · gamma shift</li>
        <li>QQQ · anomaly score ↑</li>
      </ul>
    </div>
  );
}
