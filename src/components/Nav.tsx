"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SignedIn, SignedOut, UserButton, useAuth } from "@clerk/nextjs";
import { clsx } from "clsx";

type FeatureLink = {
  href: string;
  label: string;
  sub?: string;
  accent?: string;
};

const FEATURE_LINKS: FeatureLink[] = [
  { href: "/dashboard", label: "SPX Slayer", sub: "0DTE · GEX · VWAP", accent: "green" },
  { href: "/flows", label: "Flow Feed", sub: "Whale · Dark Pool", accent: "purple" },
  { href: "/heatmap", label: "Heatmaps", sub: "Sector Rotation", accent: "orange" },
  { href: "/terminal", label: "Largo AI", sub: "Desk Terminal", accent: "blue" },
  { href: "/nighthawk", label: "Night Hawk", sub: "Playbook · Hunt modes", accent: "red" },
];

const TOP_LINKS = [
  { hash: "faq", label: "FAQ's" },
  { hash: "pricing", label: "Pricing" },
] as const;

function NavFeaturesMenu({
  links,
  path,
  onNavigate,
}: {
  links: FeatureLink[];
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="nav-features-menu-list">
      {links.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={onNavigate}
            className={clsx(
              "nav-features-menu-item",
              `nav-features-accent-${item.accent}`,
              path.startsWith(item.href) && "nav-features-menu-item-active"
            )}
          >
            <span className="nav-features-menu-label">{item.label}</span>
            {item.sub && <span className="nav-features-menu-sub">{item.sub}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Nav() {
  const path = usePathname();
  const isHome = path === "/";
  const { isSignedIn, isLoaded } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const featuresRef = useRef<HTMLLIElement>(null);

  const showAdmin = isLoaded && isSignedIn && isAdmin;
  const featureLinks = FEATURE_LINKS;
  const isFeatureActive = featureLinks.some((l) => path.startsWith(l.href));

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setIsAdmin(false);
      return;
    }

    // Check sessionStorage first — fetch at most once per browser session.
    const cached = sessionStorage.getItem("__admin_flag");
    if (cached !== null) {
      setIsAdmin(cached === "1");
      return;
    }

    let cancelled = false;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const isAdminUser = Boolean(data?.admin);
        setIsAdmin(isAdminUser);
        sessionStorage.setItem("__admin_flag", isAdminUser ? "1" : "0");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    setFeaturesOpen(false);
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!featuresRef.current?.contains(e.target as Node)) {
        setFeaturesOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const navLinkClass = (href: string) =>
    clsx(
      "nav-link",
      isHome && "nav-link-landing nav-link-landing-bold",
      (href.startsWith("#") ? path === "/" && false : path.startsWith(href)) && "nav-link-active",
      isHome && path.startsWith(href) && !href.startsWith("#") && "nav-link-active-landing"
    );

  return (
    <motion.nav
      initial={isHome ? { opacity: 0, y: -20 } : undefined}
      animate={isHome ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={clsx("nav-bar relative", isHome && "nav-bar-landing", isHome && "bg-transparent border-bull/10")}
    >
      <Link href="/" className="group relative shrink-0">
        <span className="font-anton text-xl md:text-2xl tracking-[0.2em] text-white group-hover:text-bull transition-colors">
          BLACKOUT
        </span>
        <span className="block font-mono text-[8px] tracking-[0.4em] text-bull uppercase -mt-0.5">
          Trading
        </span>
      </Link>

      <ul className="hidden md:flex items-center gap-6 lg:gap-10">
        <li ref={featuresRef} className="nav-features-dropdown">
          <button
            type="button"
            aria-expanded={featuresOpen}
            aria-haspopup="true"
            onClick={() => setFeaturesOpen((o) => !o)}
            className={clsx(
              "nav-link nav-features-trigger",
              isHome && "nav-link-landing nav-link-landing-bold",
              (isFeatureActive || featuresOpen) && "nav-link-active",
              isHome && isFeatureActive && "nav-link-active-landing"
            )}
          >
            Features
            <span className={clsx("nav-features-chevron", featuresOpen && "nav-features-chevron-open")}>
              ▾
            </span>
          </button>

          <AnimatePresence>
            {featuresOpen && (
              <motion.div
                className="nav-features-panel"
                initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformOrigin: "top" }}
              >
                <NavFeaturesMenu links={featureLinks} path={path} onNavigate={() => setFeaturesOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </li>

        {TOP_LINKS.map(({ hash, label }) => {
          const href = isHome ? `#${hash}` : `/#${hash}`;
          return (
            <li key={hash}>
              <Link href={href} className={navLinkClass(href)}>
                {label}
              </Link>
            </li>
          );
        })}

        {showAdmin && (
          <li>
            <Link
              href="/admin"
              className={clsx(
                "nav-link",
                isHome && "nav-link-landing nav-link-landing-bold",
                path.startsWith("/admin") && "nav-link-active",
                isHome && path.startsWith("/admin") && "nav-link-active-landing"
              )}
            >
              Admin
            </Link>
          </li>
        )}
      </ul>

      <div className="flex items-center gap-3 md:gap-5">
        <button
          type="button"
          className="nav-mobile-toggle md:hidden"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>

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

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="nav-mobile-drawer md:hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <p className="nav-mobile-drawer-label">Features</p>
            <NavFeaturesMenu
              links={featureLinks}
              path={path}
              onNavigate={() => setMobileOpen(false)}
            />
            <div className="nav-mobile-drawer-divider" />
            {TOP_LINKS.map(({ hash, label }) => (
              <Link
                key={hash}
                href={isHome ? `#${hash}` : `/#${hash}`}
                onClick={() => setMobileOpen(false)}
                className="nav-mobile-top-link"
              >
                {label}
              </Link>
            ))}
            {showAdmin && (
              <Link
                href="/admin"
                onClick={() => setMobileOpen(false)}
                className="nav-mobile-top-link"
              >
                Admin
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
