"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { clsx } from "clsx";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { isIosToolRoute } from "@/lib/ios-tool-routes";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";

type Tab = {
  href: string;
  label: string;
  mark: MarkProduct;
};

const TABS: Tab[] = [
  { href: "/dashboard", label: "SPX", mark: "spx" },
  { href: "/flows", label: "HELIX", mark: "helix" },
  { href: "/heatmap", label: "Thermal", mark: "heatmap" },
  { href: "/terminal", label: "Largo", mark: "largo" },
  { href: "/nighthawk", label: "Hawk", mark: "nighthawk" },
  { href: "/grid", label: "0DTE", mark: "grid" },
];

/** Native-style bottom tool switcher — iOS app shell only, signed-in tool routes. */
export function IosAppTabBar({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAuth();
  const [iosApp, setIosApp] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  const visible = iosApp && isLoaded && isSignedIn && isIosToolRoute(path);
  useEffect(() => {
    document.documentElement.classList.toggle("ios-tab-bar", visible);
    return () => document.documentElement.classList.remove("ios-tab-bar");
  }, [visible]);

  if (!visible) return null;

  return (
    <nav className="ios-app-tab-bar" aria-label="Tools">
      <ul className="ios-app-tab-list">
        {TABS.map((tab) => {
          const active = path === tab.href || path.startsWith(`${tab.href}/`);
          const key = toolKeyForHref(tab.href);
          const locked = key != null && lockedTools.includes(key);
          return (
            <li key={tab.href} className="ios-app-tab-li">
              <Link
                href={tab.href}
                prefetch={false}
                className={clsx(
                  "ios-app-tab-link",
                  active && "ios-app-tab-link-active",
                  locked && "ios-app-tab-link-locked"
                )}
                aria-current={active ? "page" : undefined}
              >
                <ProductMark product={tab.mark} size={22} title={tab.label} className="ios-app-tab-icon" />
                <span className="ios-app-tab-label font-mono">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
