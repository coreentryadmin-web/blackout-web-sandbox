"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { LEARN_NAV, learnHref, type LearnSlug } from "@/lib/learn/nav";

function slugFromPath(path: string): LearnSlug | undefined {
  if (path === "/learn") return undefined;
  const hit = LEARN_NAV.find((item) => path === learnHref(item.slug) || path.startsWith(`${learnHref(item.slug)}/`));
  return hit?.slug;
}

export function LearnSidebar() {
  const path = usePathname();
  const active = slugFromPath(path);

  return (
    <nav
      aria-label="Documentation"
      className="sticky top-[calc(var(--nav-offset)+1rem)] flex flex-col gap-0.5 rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.55)] p-3 backdrop-blur-md"
    >
      <Link
        href="/learn"
        className={clsx(
          "mb-2 rounded-lg px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors",
          path === "/learn" ? "text-cyan-300" : "text-mute hover:text-secondary"
        )}
      >
        All guides
      </Link>
      {LEARN_NAV.map((item) => {
        const isActive = item.slug === active;
        return (
          <Link
            key={item.slug}
            href={learnHref(item.slug)}
            className={clsx(
              "group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-[background-color,color] duration-base ease-out",
              isActive
                ? "bg-cyan-400/10 text-cyan-200"
                : "text-secondary hover:bg-white/[0.04] hover:text-white"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {item.product === "docs" ? (
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-[10px] text-cyan-300"
              >
                ?
              </span>
            ) : (
              <ProductMark product={item.product} size={28} animated={false} className="shrink-0" />
            )}
            <span className="font-mono text-[13px] leading-snug">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
