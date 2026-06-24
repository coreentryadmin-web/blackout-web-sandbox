"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SignedIn, SignedOut, UserButton, useAuth } from "@clerk/nextjs";
import { clsx } from "clsx";
import { OnboardingTrigger } from "@/components/OnboardingTrigger";
import { ProductMark, NAV_TO_MARK } from "@/components/marks/ProductMark";
import { useFocusTrap } from "@/components/ui";

type Accent = "green" | "purple" | "orange" | "blue" | "red";
type FeatureLink = { href: string; label: string; sub: string; accent: Accent };

const FEATURE_LINKS: FeatureLink[] = [
  { href: "/dashboard", label: "SPX Slayer", sub: "The 0DTE war room", accent: "green" },
  { href: "/flows", label: "HELIX", sub: "Follow the smart money", accent: "purple" },
  { href: "/heatmap", label: "Heatmaps", sub: "Read the regime at a glance", accent: "orange" },
  { href: "/terminal", label: "Largo AI", sub: "The desk officer on call", accent: "blue" },
  { href: "/nighthawk", label: "Night Hawk", sub: "Tomorrow's plan, tonight", accent: "red" },
];

const TOP_LINKS = [
  { hash: "faq", label: "FAQ" },
  { hash: "pricing", label: "Pricing" },
] as const;

const CLERK_APPEARANCE = {
  elements: {
    avatarBox: "w-9 h-9 ring-1 ring-bull/40",
    userButtonPopoverCard: "bg-[#040407] border border-bull/15",
    userButtonPopoverActionButton: "text-sky-200 hover:text-white",
  },
} as const;

function FeatureCards({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <>
      {FEATURE_LINKS.map((it) => (
        <Link
          key={it.href}
          role="menuitem"
          href={it.href}
          onClick={onNavigate}
          className={clsx("nav-card", `nav-accent-${it.accent}`, path.startsWith(it.href) && "nav-card-active")}
        >
          <span className="nav-card-chip" aria-hidden>
            <ProductMark product={NAV_TO_MARK[it.accent]} size={46} />
          </span>
          <span className="nav-card-label font-syne">{it.label}</span>
          <span className="nav-card-sub font-mono">{it.sub}</span>
          <span className="nav-card-open font-mono" aria-hidden>
            Open →
          </span>
        </Link>
      ))}
    </>
  );
}

export function Nav() {
  const path = usePathname();
  const isHome = path === "/";
  const { isSignedIn, isLoaded } = useAuth();
  const reduced = useReducedMotion();

  const [isAdmin, setIsAdmin] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  const showAdmin = isLoaded && isSignedIn && isAdmin;
  const isFeatureActive = FEATURE_LINKS.some((l) => path.startsWith(l.href));
  const solid = scrolled || !isHome; // single source of truth for the solid surface

  // admin check — fetch at most once per browser session
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setIsAdmin(false);
      return;
    }
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

  // scroll-aware: hysteresis (on at 16px, off at 8px) + progress hairline var
  useEffect(() => {
    let ticking = false;
    const ON = 16,
      OFF = 8;
    const read = () => {
      const y = window.scrollY;
      const next = scrolledRef.current ? y > OFF : y > ON;
      if (next !== scrolledRef.current) {
        scrolledRef.current = next;
        setScrolled(next);
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      headerRef.current?.style.setProperty("--nav-progress", String(p));
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(read);
      }
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // close menus on route change
  useEffect(() => {
    setFeaturesOpen(false);
    setMobileOpen(false);
  }, [path]);

  // outside-click closes the Features mega-menu
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!featuresRef.current?.contains(e.target as Node)) setFeaturesOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Esc closes the Features mega-menu and returns focus to its trigger.
  // (The mobile drawer's Esc + return-focus is handled by useFocusTrap below.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (featuresOpen) {
        setFeaturesOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [featuresOpen]);

  // lock body scroll while the mobile drawer is open
  useEffect(() => {
    document.documentElement.classList.toggle("nav-locked", mobileOpen);
    return () => document.documentElement.classList.remove("nav-locked");
  }, [mobileOpen]);

  // Trap Tab within the mobile drawer; Esc closes it and focus returns to the
  // hamburger trigger. Scroll-lock stays with the nav-locked class above.
  useFocusTrap(sheetRef, {
    active: mobileOpen,
    onEscape: () => setMobileOpen(false),
    lockScroll: false,
  });

  return (
    <motion.header
      ref={headerRef}
      role="banner"
      data-scrolled={solid ? "true" : "false"}
      initial={isHome && !reduced ? { opacity: 0, y: -20 } : undefined}
      animate={isHome && !reduced ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="nav-bar"
    >
      <div className="nav-surface" aria-hidden>
        <span className="nav-progress" />
      </div>

      <div className="nav-inner">
        {/* LEFT — brand */}
        <Link href="/" className="nav-brand group">
          <span className="nav-dot" aria-hidden />
          <span className="nav-brand-stack">
            <span className="nav-wordmark font-anton">BLACKOUT</span>
            <span className="nav-kicker font-mono">Trading</span>
          </span>
        </Link>

        {/* CENTER — floating glass pill */}
        <ul className="nav-pill" role="menubar">
          <li ref={featuresRef} className="nav-pill-li">
            <button
              ref={triggerRef}
              type="button"
              className={clsx("nav-pill-item", (isFeatureActive || featuresOpen) && "nav-pill-item-active")}
              aria-haspopup="menu"
              aria-expanded={featuresOpen}
              aria-controls="nav-mega"
              onClick={() => setFeaturesOpen((o) => !o)}
            >
              Features
              <span className={clsx("nav-feat-chevron", featuresOpen && "nav-feat-chevron-open")} aria-hidden>
                ▾
              </span>
            </button>

            <AnimatePresence>
              {featuresOpen && (
                <motion.div
                  id="nav-mega"
                  role="menu"
                  className="nav-mega"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: "top" }}
                >
                  <div className="nav-mega-head">
                    <span className="nav-mega-kicker font-mono">The Desk · 5 Instruments</span>
                    <Link
                      href={isHome ? "#features" : "/#features"}
                      className="nav-mega-all font-mono"
                      onClick={() => setFeaturesOpen(false)}
                    >
                      View the Arsenal →
                    </Link>
                  </div>
                  <div className="nav-mega-grid">
                    <FeatureCards path={path} onNavigate={() => setFeaturesOpen(false)} />
                  </div>
                  <div className="nav-mega-foot font-mono">Tab to explore · Esc to close</div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>

          {TOP_LINKS.map(({ hash, label }) => {
            const href = isHome ? `#${hash}` : `/#${hash}`;
            return (
              <li key={hash} className="nav-pill-li">
                <Link href={href} className="nav-pill-item">
                  {label}
                </Link>
              </li>
            );
          })}

          <li className="nav-pill-li">
            <OnboardingTrigger className="nav-pill-item onboarding-nav-trigger" />
          </li>

          {showAdmin && (
            <li className="nav-pill-li">
              <Link href="/admin" className={clsx("nav-pill-item nav-pill-admin", path.startsWith("/admin") && "nav-pill-item-active")}>
                Admin
              </Link>
            </li>
          )}
        </ul>

        {/* RIGHT — auth */}
        <div className="nav-auth">
          <button
            ref={hamburgerRef}
            type="button"
            className="nav-sheet-toggle lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="nav-drawer"
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? "✕" : "☰"}
          </button>

          <SignedOut>
            <Link href="/sign-in" className="nav-signin font-syne hidden sm:inline">
              Sign In
            </Link>
            <Link href="/sign-up" className="nav-join font-syne glitch-hover">
              Deploy →
            </Link>
          </SignedOut>
          <SignedIn>
            <UserButton appearance={CLERK_APPEARANCE} />
          </SignedIn>
        </div>
      </div>

      {/* MOBILE — right slide-in drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="nav-sheet-scrim lg:hidden"
              aria-hidden
              onClick={() => setMobileOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              ref={sheetRef}
              id="nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              tabIndex={-1}
              className="nav-sheet lg:hidden outline-none"
              initial={reduced ? { opacity: 0 } : { x: "100%" }}
              animate={reduced ? { opacity: 1 } : { x: 0 }}
              exit={reduced ? { opacity: 0 } : { x: "100%" }}
              transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="nav-sheet-head">
                <span className="nav-wordmark font-anton">BLACKOUT</span>
                <button className="nav-sheet-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
                  ✕
                </button>
              </div>
              <p className="nav-sheet-label font-mono">Features</p>
              <div className="nav-sheet-cards">
                <FeatureCards path={path} onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="nav-sheet-divider" />
              {TOP_LINKS.map(({ hash, label }) => (
                <Link
                  key={hash}
                  href={isHome ? `#${hash}` : `/#${hash}`}
                  onClick={() => setMobileOpen(false)}
                  className="nav-sheet-link font-syne"
                >
                  {label}
                </Link>
              ))}
              <OnboardingTrigger className="nav-sheet-link font-syne onboarding-nav-trigger" />
              {showAdmin && (
                <Link href="/admin" onClick={() => setMobileOpen(false)} className="nav-sheet-link font-syne nav-pill-admin">
                  Admin
                </Link>
              )}
              <div className="nav-sheet-divider" />
              <div className="nav-sheet-auth">
                <SignedOut>
                  <Link href="/sign-in" className="nav-signin font-syne" onClick={() => setMobileOpen(false)}>
                    Sign In
                  </Link>
                  <Link href="/sign-up" className="nav-join font-syne w-full justify-center" onClick={() => setMobileOpen(false)}>
                    Deploy →
                  </Link>
                </SignedOut>
                <SignedIn>
                  <UserButton appearance={CLERK_APPEARANCE} />
                </SignedIn>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
