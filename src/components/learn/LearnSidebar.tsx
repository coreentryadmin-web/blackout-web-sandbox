"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { CURRICULUM } from "@/lib/learn/curriculum";
import { LEARN_NAV, learnHref, type LearnSlug } from "@/lib/learn/nav";

function slugFromPath(path: string): LearnSlug | undefined {
  if (path === "/learn") return undefined;
  const hit = LEARN_NAV.find(
    (item) => path === learnHref(item.slug) || path.startsWith(`${learnHref(item.slug)}/`)
  );
  return hit?.slug;
}

export function LearnSidebar() {
  const path = usePathname();
  const active = slugFromPath(path);
  const progress = active ? CURRICULUM.find((c) => c.slug === active)?.chapter ?? 0 : 0;

  return (
    <nav aria-label="Documentation curriculum" className="learn-sidebar">
      <div className="learn-sidebar-header">
        <Link
          href="/learn"
          className={clsx(
            "font-mono text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors",
            path === "/learn" ? "text-cyan-300" : "text-mute hover:text-secondary"
          )}
        >
          Academy home
        </Link>
        {progress > 0 && (
          <p className="mt-2 font-mono text-[10px] text-mute">
            Chapter {progress} of {CURRICULUM.length}
          </p>
        )}
        {progress > 0 && (
          <div className="learn-sidebar-progress" aria-hidden>
            <div
              className="learn-sidebar-progress-fill"
              style={{ width: `${(progress / CURRICULUM.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      <ol className="learn-sidebar-list">
        {LEARN_NAV.map((item) => {
          const chapter = CURRICULUM.find((c) => c.slug === item.slug)?.chapter ?? 0;
          const isActive = item.slug === active;
          return (
            <li key={item.slug}>
              <Link
                href={learnHref(item.slug)}
                className={clsx(
                  "learn-sidebar-link group",
                  isActive && "learn-sidebar-link--active"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="learn-sidebar-chapter">{chapter}</span>
                {item.product === "docs" ? (
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-[10px] text-cyan-300"
                  >
                    ?
                  </span>
                ) : (
                  <ProductMark product={item.product} size={26} animated={false} className="shrink-0" />
                )}
                <span className="min-w-0 truncate font-mono text-[12px] leading-snug">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
