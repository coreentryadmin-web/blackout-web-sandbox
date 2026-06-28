export const dynamic = "force-static";

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { LEARN_NAV, learnHref } from "@/lib/learn/nav";

export const metadata: Metadata = {
  title: "Learn · BlackOut",
  description: "Documentation and guides for every BlackOut trading desk.",
};

export default function LearnPage() {
  const start = LEARN_NAV[0];
  const guides = LEARN_NAV.slice(1);

  return (
    <>
      <PageHeader
        kicker="Documentation"
        title="BlackOut guides"
        subtitle="How each desk fits together — from your first session to advanced workflows."
        className="mb-8"
      />

      <Link href={learnHref(start.slug)} className="group block">
        <Card padding="md" hover accent="accent" className="mb-8">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/10">
              <ProductMark product="spx" size={32} animated={false} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                {start.tag}
              </p>
              <p className="mt-1 font-sans text-lg font-semibold text-white">{start.label}</p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">{start.description}</p>
            </div>
            <span
              className="hidden shrink-0 font-mono text-sm text-cyan-300 opacity-0 transition-opacity group-hover:opacity-100 sm:inline"
              aria-hidden
            >
              Open →
            </span>
          </div>
        </Card>
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {guides.map((guide) => (
          <Link key={guide.slug} href={learnHref(guide.slug)} className="group block h-full">
            <Card padding="sm" hover className="flex h-full flex-col gap-3">
              <div className="flex items-center gap-3">
                {guide.product === "docs" ? (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] font-mono text-xs text-cyan-300">
                    Abc
                  </span>
                ) : (
                  <ProductMark product={guide.product} size={36} animated={false} />
                )}
                <span className="font-sans text-sm font-semibold text-white">{guide.label}</span>
              </div>
              <p className="text-sm leading-relaxed text-secondary">{guide.description}</p>
              <span
                className="mt-auto font-mono text-[11px] text-cyan-300/80 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              >
                Read guide →
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <p className="mt-10 font-mono text-[11px] text-mute">
        Updated as features ship. Educational content only — not financial advice.
      </p>
    </>
  );
}
