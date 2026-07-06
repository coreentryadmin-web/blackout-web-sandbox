"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { LEARN_NAV, learnHref } from "@/lib/learn/nav";

/** Horizontal chapter picker for Learn — native shell only (sidebar hidden on phone). */
export function LearnMobileNav() {
  const path = usePathname();
  const native = useIosNativeShell();
  if (!native) return null;

  return (
    <nav className="learn-mobile-nav" aria-label="Chapters">
      <div className="learn-mobile-nav-scroll">
        {LEARN_NAV.map((item) => {
          const href = learnHref(item.slug);
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <Link
              key={item.slug}
              href={href}
              scroll={false}
              className={clsx("learn-mobile-nav-chip font-syne", active && "learn-mobile-nav-chip-active")}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
