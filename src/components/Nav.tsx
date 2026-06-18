"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { clsx } from "clsx";

type NavLink = {
  href: string;
  label: string;
  lines?: [string, string];
};

const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "SPX Slayer", lines: ["SPX", "Slayer"] },
  { href: "/flows", label: "Flows" },
  { href: "/heatmap", label: "Heatmaps" },
  { href: "/terminal", label: "Largo" },
  { href: "/nighthawk", label: "Night Hawk" },
];

export function Nav() {
  const path = usePathname();
  const isHome = path === "/";
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.admin) setIsAdmin(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const links = isAdmin
    ? [...NAV_LINKS, { href: "/admin", label: "Admin" }]
    : NAV_LINKS;

  return (
    <motion.nav
      initial={isHome ? { opacity: 0, y: -20 } : undefined}
      animate={isHome ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={clsx("nav-bar", isHome && "nav-bar-landing", isHome && "bg-transparent border-bull/10")}
    >
      <Link href="/" className="group relative">
        <span className="font-anton text-xl md:text-2xl tracking-[0.2em] text-white group-hover:text-bull transition-colors">
          BLACKOUT
        </span>
        <span className="block font-mono text-[8px] tracking-[0.4em] text-bull uppercase -mt-0.5">
          Trading
        </span>
      </Link>

      <SignedIn>
        <ul className="hidden md:flex items-center gap-6 lg:gap-8">
          {links.map(({ href, label, lines }) => (
            <li key={href}>
              <Link
                href={href}
                className={clsx(
                  "nav-link",
                  isHome && "nav-link-landing nav-link-landing-bold",
                  path.startsWith(href) && "nav-link-active",
                  isHome && path.startsWith(href) && "nav-link-active-landing"
                )}
              >
                {lines ? (
                  <span className="nav-link-stacked">
                    <span>{lines[0]}</span>
                    <span>{lines[1]}</span>
                  </span>
                ) : (
                  label
                )}
              </Link>
            </li>
          ))}
        </ul>
      </SignedIn>

      <div className="flex items-center gap-3 md:gap-5">
        <SignedOut>
          <Link href="/sign-in" className="nav-link hidden sm:inline">
            Sign In
          </Link>
          <Link href="/sign-up" className="btn-primary-sm glitch-hover">
            Join →
          </Link>
        </SignedOut>
        <SignedIn>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-8 h-8 ring-2 ring-bull/50",
                userButtonPopoverCard: "bg-grey-900 border border-grey-700",
              },
            }}
          />
        </SignedIn>
      </div>
    </motion.nav>
  );
}
