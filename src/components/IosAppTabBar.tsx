"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@clerk/nextjs";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { IOS_TOOLS, isIosToolRoute } from "@/lib/ios-tool-routes";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";

const TAB_SPRING = { type: "spring" as const, stiffness: 520, damping: 42 };

/** Instrument rail — terminal-style bottom switcher (not a floating pill tab bar). */
export function IosAppTabBar({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAuth();
  const [iosApp, setIosApp] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  const visible =
    iosApp &&
    isLoaded &&
    isSignedIn &&
    isIosToolRoute(path) &&
    path !== "/terminal" &&
    !path.startsWith("/terminal/");
  useEffect(() => {
    document.documentElement.classList.toggle("ios-tab-bar", visible);
    return () => document.documentElement.classList.remove("ios-tab-bar");
  }, [visible]);

  if (!visible) return null;

  return (
    <nav className="ios-app-tab-bar" aria-label="Instrument rail">
      <ul className="ios-app-tab-list">
        {IOS_TOOLS.map((tab) => {
          const active = path === tab.href || path.startsWith(`${tab.href}/`);
          const key = toolKeyForHref(tab.href);
          const locked = key != null && lockedTools.includes(key);
          return (
            <li key={tab.href} className="ios-app-tab-li">
              {active && (
                <motion.span
                  layoutId="ios-native-tab-indicator"
                  className="ios-app-tab-indicator"
                  style={{ "--tab-accent": tab.accent } as React.CSSProperties}
                  transition={TAB_SPRING}
                  aria-hidden
                />
              )}
              <Link
                href={tab.href}
                prefetch={false}
                scroll={false}
                className={clsx(
                  "ios-app-tab-link",
                  active && "ios-app-tab-link-active",
                  locked && "ios-app-tab-link-locked"
                )}
                style={{ "--tab-accent": tab.accent } as React.CSSProperties}
                aria-current={active ? "page" : undefined}
                aria-label={tab.label}
              >
                <ProductMark product={tab.mark} size={18} title={tab.label} className="ios-app-tab-icon" />
                <span className="ios-app-tab-label">{tab.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
