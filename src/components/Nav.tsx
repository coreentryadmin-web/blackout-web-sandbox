"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { UserButton, useAuth } from "@clerk/nextjs";
import { clsx } from "clsx";
import { ProductMark, NAV_TO_MARK } from "@/components/marks/ProductMark";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";
import { useFocusTrap } from "@/components/ui";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";

type Accent = "green" | "purple" | "orange" | "blue" | "red" | "gold";
type FeatureLink = { href: string; label: string; sub: string; accent: Accent };

const FEATURE_LINKS: FeatureLink[] = [
  { href: "/dashboard", label: "SPX Slayer", sub: "SPX structure & 0DTE desk", accent: "green" },
  { href: "/flows", label: "HELIX", sub: "Institutional options flow", accent: "purple" },
  { href: "/heatmap", label: "BlackOut Thermal", sub: "Dealer gamma & vanna map", accent: "orange" },
  { href: "/terminal", label: "Largo", sub: "BlackOut Intelligence desk analyst", accent: "blue" },
  { href: "/nighthawk", label: "Night Hawk", sub: "Playbook + Night's Watch positions", accent: "red" },
  { href: "/grid", label: "0DTE Command", sub: "Always-on 0DTE play hunter", accent: "gold" },
];

const TOP_LINKS = [
  { hash: "faq", label: "FAQ" },
  { hash: "pricing", label: "Pricing" },
] as const;

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "12px",
  },
  elements: {
    avatarBox: "w-9 h-9 ring-1 ring-bull/40",
    userButtonPopoverCard: "!bg-[#040407] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)]",
    userButtonPopoverActionButton: "text-sky-200 hover:text-white hover:!bg-white/5",
    userButtonPopoverActionButtonText: "text-sky-200",
    userButtonPopoverFooter: "!bg-[#040407] border-t border-white/8",
  },
} as const;

function FeatureCards({
  path,
  lockedTools = [],
  onNavigate,
}: {
  path: string;
  lockedTools?: ToolKey[];
  onNavigate?: () => void;
}) {
  return (
    <>
      {FEATURE_LINKS.map((it) => {
        const key = toolKeyForHref(it.href);
        const locked = key != null && lockedTools.includes(key);
        return (
          <Link
            key={it.href}
            role="menuitem"
            href={it.href}
            onClick={onNavigate}
            className={clsx(
              "nav-card",
              `nav-accent-${it.accent}`,
              path.startsWith(it.href) && "nav-card-active",
              locked && "nav-card-locked"
            )}
          >
            <span className="nav-card-chip" aria-hidden>
              <ProductMark product={NAV_TO_MARK[it.accent]} size={46} />
            </span>
            <span className="nav-card-label font-syne">{it.label}</span>
            <span className="nav-card-sub font-mono">{it.sub}</span>
            <span className="nav-card-open font-mono" aria-hidden>
              {locked ? "Preview" : "Open →"}
            </span>
          </Link>
        );
      })}
    </>
  );
}

export function Nav({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const isHome = path === "/";
  const { isSignedIn, isLoaded, userId } = useAuth();
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
  const solid = scrolled || !isHome;
  const isLearnActive = path.startsWith("/learn");
  const isAdminTrackActive = path.startsWith("/admin/track-record");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !userId) {
      setIsAdmin(false);
      return;
    }
    const cacheKey = `__admin_flag:${userId}`;
    const cached = sessionStorage.getItem(cacheKey);
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
        sessionStorage.setItem(cacheKey, isAdminUser ? "1" : "0");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId]);

  useEffect(() => {
    let ticking = false;
    const ON = 16, OFF = 8;
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

  useEffect(() => {
    setFeaturesOpen(false);
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!featuresRef.current?.contains(e.target as Node)) setFeaturesOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

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

  useEffect(() => {
    document.documentElement.classList.toggle("nav-locked", mobileOpen);
    return () => document.documentElement.classList.remove("nav-locked");
  }, [mobileOpen]);

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
        <Link href="/" className="nav-brand group">
          <span className="nav-dot" aria-hidden />
          <span className="nav-brand-stack">
            <span className="nav-wordmark font-anton">BLACKOUT</span>
            <span className="nav-kicker font-mono">Trading</span>
          </span>
        </Link>

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
                    <span className="nav-mega-kicker font-mono">Six instruments · one desk</span>
                    <Link
                      href={isHome ? "#features" : "/#features"}
                      className="nav-mega-all font-mono"
                      onClick={() => setFeaturesOpen(false)}
                    >
                      Overview →
                    </Link>
                  </div>
                  <div className="nav-mega-grid">
                    <FeatureCards path={path} lockedTools={lockedTools} onNavigate={() => setFeaturesOpen(false)} />
                  </div>
                  <div className="nav-mega-foot font-mono">Tab to explore · Esc to close</div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>

          {TOP_LINKS.map(({ hash, label }) => {
            const href = isHome ? `#${hash}` : `/#${hash}`;
            // Hide the Pricing link inside the iOS app (it scrolls to the hidden
            // pricing section — App Store guideline 3.1.1).
            const li = hash === "pricing" ? "nav-pill-li hide-in-ios-app" : "nav-pill-li";
            return (
              <li key={hash} className={li}>
                <Link href={href} className="nav-pill-item">
                  {label}
                </Link>
              </li>
            );
          })}

          <li className="nav-pill-li">
            <Link
              href="/learn"
              className={clsx("nav-pill-item", isLearnActive && "nav-pill-item-active")}
            >
              Learn
            </Link>
          </li>

          {showAdmin && (
            <li className="nav-pill-li">
              <Link
                href="/admin/track-record"
                className={clsx("nav-pill-item nav-pill-admin", isAdminTrackActive && "nav-pill-item-active")}
              >
                Track Record
              </Link>
            </li>
          )}

          {showAdmin && (
            <li className="nav-pill-li">
              <Link href="/admin" className={clsx("nav-pill-item nav-pill-admin", path.startsWith("/admin") && !isAdminTrackActive && "nav-pill-item-active")}>
                Admin
              </Link>
            </li>
          )}
        </ul>

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

          {isLoaded && !isSignedIn && (
            <>
              <Link href="/sign-in" className="nav-signin font-syne hidden sm:inline">
                Sign In
              </Link>
              <Link href="/sign-up" className="nav-join font-syne">
                Get access →
              </Link>
            </>
          )}
          {isLoaded && isSignedIn && (
            <div className="flex items-center gap-2">
              <PushNotificationToggle compact />
              <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />
            </div>
          )}
        </div>
      </div>

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
                  className={
                    hash === "pricing"
                      ? "nav-sheet-link font-syne hide-in-ios-app"
                      : "nav-sheet-link font-syne"
                  }
                >
                  {label}
                </Link>
              ))}
              <Link
                href="/learn"
                onClick={() => setMobileOpen(false)}
                className={clsx("nav-sheet-link font-syne", isLearnActive && "nav-pill-item-active")}
              >
                Learn
              </Link>
              {showAdmin && (
                <Link
                  href="/admin/track-record"
                  onClick={() => setMobileOpen(false)}
                  className={clsx("nav-sheet-link font-syne nav-pill-admin", isAdminTrackActive && "nav-pill-item-active")}
                >
                  Track Record
                </Link>
              )}
              {showAdmin && (
                <Link href="/admin" onClick={() => setMobileOpen(false)} className="nav-sheet-link font-syne nav-pill-admin">
                  Admin
                </Link>
              )}
              <div className="nav-sheet-divider" />
              <div className="nav-sheet-auth">
                {isLoaded && !isSignedIn && (
                  <>
                    <Link href="/sign-in" className="nav-signin font-syne" onClick={() => setMobileOpen(false)}>
                      Sign In
                    </Link>
                    <Link href="/sign-up" className="nav-join font-syne w-full justify-center" onClick={() => setMobileOpen(false)}>
                      Get access →
                    </Link>
                  </>
                )}
                {isLoaded && isSignedIn && (
                  <div className="flex items-center gap-2">
                    <PushNotificationToggle compact />
                    <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
