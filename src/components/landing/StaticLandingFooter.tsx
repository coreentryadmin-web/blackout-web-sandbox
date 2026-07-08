import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";

const YEAR = new Date().getFullYear();

const INSTRUMENTS = [
  { label: "SPX Slayer", href: "/dashboard" },
  { label: "HELIX Flow", href: "/flows" },
  { label: "BlackOut Thermal", href: "/heatmap" },
  { label: "Largo", href: "/terminal" },
  { label: "Night Hawk", href: "/nighthawk" },
];

const PLATFORM = [
  { label: "Learn", href: "/learn" },
  { label: "Pricing", href: "/pricing", iosHide: true },
  { label: "FAQ", href: "/faq" },
  { label: "Upgrade", href: "/upgrade", iosHide: true },
  { label: "Sign in", href: "/sign-in" },
  { label: "Start Trading", href: "/sign-up" },
];

function FooterLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} prefetch={false} className={className}>
      {children}
    </Link>
  );
}

export function StaticLandingFooter() {
  return (
    <footer className="mkt-footer relative z-10 px-4 md:px-8">
      <p className="mkt-footer-wm" aria-hidden>
        BLACKOUT
      </p>
      <div className="relative z-10 mx-auto grid max-w-6xl gap-10 md:grid-cols-4">
        <div>
          <p className="font-anton text-2xl text-white">BLACKOUT</p>
          <p className="mt-2 text-sm text-sky-300">{SITE.tagline}</p>
        </div>
        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-bull/80">Instruments</p>
          <ul className="flex flex-col gap-2">
            {INSTRUMENTS.map((it) => (
              <li key={it.href}>
                <FooterLink href={it.href} className="text-sm text-white/75 no-underline hover:text-white">
                  {it.label}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-bull/80">Platform</p>
          <ul className="flex flex-col gap-2">
            {PLATFORM.map((it) => (
              <li key={it.href} className={it.iosHide ? "hide-in-ios-app" : undefined}>
                <FooterLink href={it.href} className="text-sm text-white/75 no-underline hover:text-white">
                  {it.label}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <FooterLink href="/sign-in" className="nav-signin">
            Sign in
          </FooterLink>
          <FooterLink href="/sign-up" className="nav-join">
            Get started
          </FooterLink>
          <p className="mt-4 text-xs text-sky-300/70">© {YEAR} {SITE.legalName}</p>
        </div>
      </div>
    </footer>
  );
}
