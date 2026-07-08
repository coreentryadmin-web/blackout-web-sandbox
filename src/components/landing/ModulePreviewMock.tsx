import type { CSSProperties } from "react";
import { MARKETING_MODULE_IMAGES, type MarketingModuleId } from "@/lib/images";

type Props = {
  moduleId: string;
  label: string;
  accent: string;
};

const ALT: Record<MarketingModuleId, string> = {
  spx: "SPX Slayer — live 0DTE gamma matrix and dealer positioning desk",
  helix: "HELIX — institutional options flow tape with anomaly alerts",
  thermal: "BlackOut Thermal — dealer gamma heatmap across strikes and expiries",
  largo: "Largo — AI desk analyst grounded in live platform data",
  hawk: "Night Hawk — graded swing playbook and evening scanner",
  vector: "Vector — cross-ticker flow and gamma universe scan",
};

/** Real desk screenshot in a chrome frame — falls back to CSS mock if asset missing. */
export function ModulePreviewMock({ moduleId, label, accent }: Props) {
  const style = { "--mkt-accent": accent } as CSSProperties;
  const imageId = moduleId as MarketingModuleId;
  const src = MARKETING_MODULE_IMAGES[imageId];

  return (
    <div
      className={`mkt-module-preview mkt-card mkt-preview-${moduleId}`}
      style={{ borderColor: `${accent}33`, ...style }}
    >
      <div className="mkt-module-preview-bar">
        <span className="mkt-module-preview-dot" style={{ background: accent }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/60">{label}</span>
        <span className="mkt-module-preview-live font-mono text-[10px] uppercase tracking-[0.2em]">Live desk</span>
      </div>
      <div className="mkt-module-preview-body mkt-module-preview-body--shot">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- static marketing shell; no next/image bundle
          <img
            src={src}
            alt={ALT[imageId] ?? `${label} preview`}
            className="mkt-module-shot"
            width={1200}
            height={675}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="mkt-module-shot-fallback" aria-hidden />
        )}
        <div className="mkt-module-shot-glow" aria-hidden />
      </div>
    </div>
  );
}
