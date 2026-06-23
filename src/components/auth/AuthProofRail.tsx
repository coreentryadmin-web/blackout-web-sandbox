import { FEATURE_MATRIX } from "@/lib/upsell-features";

/**
 * Proof rail for the auth / upgrade screens.
 *
 * HONESTY GATE: the headline stats (win rate / members / flow alerts) ship ONLY when
 * they are real and independently substantiable — fabricating performance numbers on a
 * trading product is not acceptable. We do not have verified figures, so PROOF_REAL is
 * false: the auth pane shows a static "what you unlock" ledger instead, and the upgrade
 * page omits the rail entirely. Flip PROOF_REAL to true ONLY with real, logged data and
 * keep the disclaimer.
 */
const PROOF_REAL: boolean = false;

const STATS = [
  { value: "—", label: "Win rate" },
  { value: "—", label: "Members" },
  { value: "—", label: "Flow alerts" },
];

export function AuthProofRail({ variant }: { variant: "auth" | "upgrade" }) {
  if (!PROOF_REAL) {
    if (variant === "upgrade") return null;
    return (
      <ul className="flex flex-col gap-3">
        {FEATURE_MATRIX.slice(0, 4).map((f) => (
          <li key={f.label} className="flex items-start gap-3">
            <span className="mt-0.5 text-bull" aria-hidden>
              ✓
            </span>
            <span>
              <span className="block font-syne text-sm font-semibold text-white">{f.label}</span>
              <span className="block text-xs text-sky-300">{f.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-bull/15 bg-[rgba(8,9,14,0.6)] backdrop-blur p-4"
          >
            <div className="font-anton text-3xl text-white">{s.value}</div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-bull">{s.label}</div>
            <div className="mt-0.5 text-[9px] text-sky-300">
              verified ✓<span className="sr-only"> independently verified</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-sky-300/70">
        Track record independently logged. Past performance ≠ future results.
      </p>
    </div>
  );
}
