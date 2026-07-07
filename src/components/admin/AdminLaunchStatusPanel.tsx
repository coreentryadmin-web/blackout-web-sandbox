import Link from "next/link";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { getLaunchStatusSnapshot, type LaunchSource, type ToolSigil } from "@/lib/tool-access";

const SIGIL_BY_KEY: Record<string, ToolSigil> = {
  spx: "spx",
  flows: "helix",
  heatmap: "heatmap",
  largo: "largo",
  nighthawk: "nighthawk",
};

function sourceLabel(source: LaunchSource): string {
  if (source === "default") return "always live";
  if (source === "env") return "LAUNCHED_TOOLS";
  return "locked";
}

/** Server-rendered launch gate readout for /admin (premium non-admin view). */
export function AdminLaunchStatusPanel() {
  const status = getLaunchStatusSnapshot();
  const allOpen = status.open_count === status.total_count;

  return (
    <section
      className="admin-glass admin-deck-panel admin-glass-shimmer admin-glass-violet mb-6"
      aria-labelledby="admin-launch-status-heading"
    >
      <div className="admin-glass" aria-hidden />
      <p className="admin-deck-kicker">Premium launch gate · server env</p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="admin-launch-status-heading" className="admin-glass-title admin-deck-title">
            Tool launch status
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-cyan">
            What paying <strong className="font-semibold text-sky-200">non-admin</strong> users see.
            Admins bypass all gates. Five tools ship live by default; add{" "}
            <code className="rounded bg-white/5 px-1 text-sky-200">largo</code> to{" "}
            <code className="rounded bg-white/5 px-1 text-sky-200">LAUNCHED_TOOLS</code> on Railway{" "}
            <span className="text-white/40">blackout-web → Variables</span> to unlock Largo — no deploy.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">Premium tools open</p>
          <p className="font-syne text-2xl font-bold text-white">
            {status.open_count}
            <span className="text-white/30"> / {status.total_count}</span>
          </p>
        </div>
      </div>

      <div className="admin-glass-body mt-4 space-y-4">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px]">
          <span className="text-white/40">LAUNCHED_TOOLS=</span>
          <span className={clsx("font-semibold", status.launched_tools_env ? "text-gold" : "text-white/50")}>
            {status.launched_tools_env ?? "(unset — defaults except Largo locked)"}
          </span>
          {status.env_launched_keys.length > 0 && (
            <span className="ml-2 text-cyan">
              → keys: {status.env_launched_keys.join(", ")}
            </span>
          )}
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {status.tools.map((tool) => {
            const sigil = SIGIL_BY_KEY[tool.key];
            return (
              <li
                key={tool.key}
                className={clsx(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                  tool.launched ? "border-bull/25 bg-bull/5" : "border-white/10 bg-white/[0.02]"
                )}
              >
                {sigil ? <ProductMark product={sigil} size={32} /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] font-semibold text-sky-200">{tool.label}</p>
                  <p className="font-mono text-[10px] text-cyan">{sourceLabel(tool.launch_source)}</p>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span
                    className={clsx(
                      "font-mono text-[10px] font-bold uppercase tracking-wider",
                      tool.launched ? "text-bull" : "text-gold"
                    )}
                  >
                    {tool.launched ? "Open" : "Locked"}
                  </span>
                  <Link
                    href={tool.href}
                    className="font-mono text-[10px] text-white/40 underline-offset-2 hover:text-sky-200 hover:underline"
                  >
                    {tool.href}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="font-mono text-[10px] text-white/35">
          {allOpen
            ? "All six tools are live for premium users on this replica."
            : status.locked_keys.length > 0
              ? `Locked for premium users: ${status.locked_keys.join(", ")} — nav padlocks + Coming soon pages + API 403 coming_soon.`
              : null}
        </p>
      </div>
    </section>
  );
}
