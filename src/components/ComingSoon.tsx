import Link from "next/link";
import { ProductMark } from "@/components/marks/ProductMark";
import { toolMeta, type ToolKey } from "@/lib/tool-access";

// Full-page padlock screen for locked tools (non-admin). ProductMark carries brand;
// SPX Slayer + HELIX are the live alternatives so users always have somewhere to go.
export function ComingSoon({ toolKey }: { toolKey: ToolKey }) {
  const meta = toolMeta(toolKey);
  const label = meta?.label ?? "This tool";

  return (
    <div className="relative flex min-h-[calc(100svh-var(--nav-offset,4rem))] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="platform-dot-grid" aria-hidden />
      <div className="relative z-10 flex max-w-lg flex-col items-center gap-6">
        <div className="relative">
          {meta ? <ProductMark product={meta.product} size={76} /> : null}
          <span
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#040407] text-secondary"
            aria-hidden
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="11" width="17" height="10" rx="2" />
              <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
            </svg>
          </span>
        </div>

        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-bull">
          Coming soon
        </p>
        <h1 className="font-syne text-4xl font-bold tracking-tight text-white sm:text-5xl">{label}</h1>

        <p className="leading-relaxed text-secondary">
          {label} is in final testing and unlocks soon. We ship one instrument at a time so every
          feature is production-ready on launch day.
        </p>

        <p className="text-sm text-mute">
          Available now: <strong className="font-semibold text-white">SPX Slayer</strong> and{" "}
          <strong className="font-semibold text-white">HELIX</strong>.
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-md border border-bull/40 bg-bull/10 px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-bull transition-colors hover:border-bull/60 hover:bg-bull/15"
          >
            Open SPX Slayer
          </Link>
          <Link
            href="/flows"
            className="rounded-md border border-white/10 px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-secondary transition-colors hover:border-white/20 hover:text-white"
          >
            HELIX flow tape
          </Link>
        </div>
      </div>
    </div>
  );
}
