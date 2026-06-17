"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { clsx } from "clsx";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/flows", label: "Flows" },
  { href: "/heatmap", label: "Heatmaps" },
  { href: "/terminal", label: "Largo" },
  { href: "/nighthawk", label: "Night Hawk" },
];

export function Nav() {
  const path = usePathname();
  const isHome = path === "/";

  return (
    <nav className={clsx("nav-bar", isHome && "bg-transparent border-bull/10")}>
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
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={clsx("nav-link", path.startsWith(href) && "nav-link-active")}
              >
                {label}
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
    </nav>
  );
}
