"use client";

import { clsx } from "clsx";
import type { BieScenario } from "@/lib/bie/answer-envelope";

const SCENARIO_LABEL: Record<BieScenario["kind"], string> = {
  bull: "Bull",
  base: "Base",
  bear: "Bear",
};

/** One line of a scenario card (trigger/confirm/invalidation), omitted when absent. */
function Line({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="bie-scenario-line">
      <span className="bie-scenario-line-label">{label}</span>
      <span className="bie-scenario-line-value">{value}</span>
    </p>
  );
}

/**
 * Bull / base / bear scenario cards (§1.6/§6). Each card carries thesis + optional
 * trigger, confirmation, invalidation, targets, and risks — the full decision frame,
 * not just a direction. Renders nothing when no scenarios are present.
 */
export function BieScenarioCards({ scenarios }: { scenarios: BieScenario[] | undefined }) {
  if (!scenarios || scenarios.length === 0) return null;
  return (
    <div className="bie-scenarios">
      <p className="bie-block-label">Scenarios</p>
      <div className="bie-scenarios-grid">
        {scenarios.map((s, i) => (
          <div key={`${s.kind}-${i}`} className={clsx("bie-scenario", `bie-scenario-${s.kind}`)}>
            <p className="bie-scenario-kind">{SCENARIO_LABEL[s.kind]}</p>
            <p className="bie-scenario-thesis">{s.thesis}</p>
            <Line label="Trigger" value={s.trigger} />
            <Line label="Confirm" value={s.confirm} />
            <Line label="Invalidation" value={s.invalidation} />
            {s.targets && s.targets.length > 0 ? (
              <p className="bie-scenario-line">
                <span className="bie-scenario-line-label">Targets</span>
                <span className="bie-scenario-line-value">{s.targets.join(", ")}</span>
              </p>
            ) : null}
            {s.risks && s.risks.length > 0 ? (
              <p className="bie-scenario-line">
                <span className="bie-scenario-line-label">Risks</span>
                <span className="bie-scenario-line-value">{s.risks.join(", ")}</span>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
