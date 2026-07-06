"use client";

import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { AnimatePresence, motion } from "framer-motion";
import { getIosHeaderMeta } from "@/lib/ios-tool-routes";
import { ProductMark } from "@/components/marks/ProductMark";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "4px",
  },
  elements: {
    avatarBox: "w-8 h-8 ring-1 ring-bull/40 rounded-[4px]",
    userButtonPopoverCard: "!bg-[#040407] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)]",
    userButtonPopoverActionButton: "text-sky-200 hover:text-white hover:!bg-white/5",
    userButtonPopoverActionButtonText: "text-sky-200",
    userButtonPopoverFooter: "!bg-[#040407] border-t border-white/8",
  },
} as const;

const TITLE_SPRING = { type: "spring" as const, stiffness: 520, damping: 40 };

type Props = {
  path: string;
  onMenuOpen: () => void;
};

/** Institutional command bar — instrument ID + live accent rail. */
export function IosNativeHeader({ path, onMenuOpen }: Props) {
  const router = useRouter();
  const meta = getIosHeaderMeta(path);
  const titleKey = `${meta.key}:${meta.kicker}`;

  return (
    <header className="ios-native-header" role="banner">
      <div className="ios-native-header-inner">
        {meta.showBack ? (
          <button
            type="button"
            className="ios-native-icon-btn ios-native-back-btn"
            aria-label="Back to desk"
            onClick={() => router.push("/dashboard")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="ios-native-icon-btn"
            aria-label="Open command deck"
            onClick={onMenuOpen}
          >
            <span className="ios-native-menu-glyph" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
        )}

        <div className="ios-native-header-title">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={titleKey}
              className="ios-native-header-title-inner"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={TITLE_SPRING}
            >
              {meta.kicker ? (
                <span className="ios-native-header-kicker">{meta.kicker}</span>
              ) : null}
              <div className="flex items-center justify-center gap-1.5 min-w-0">
                {meta.mark ? (
                  <ProductMark product={meta.mark} size={16} title={meta.title} className="shrink-0" />
                ) : null}
                <span className="ios-native-header-title-text truncate">{meta.title}</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="ios-native-header-actions">
          {meta.showBack ? (
            <button
              type="button"
              className="ios-native-icon-btn"
              aria-label="Open command deck"
              onClick={onMenuOpen}
            >
              <span className="ios-native-menu-glyph ios-native-menu-glyph-compact" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </button>
          ) : (
            <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />
          )}
        </div>
      </div>
      <motion.div
        className="ios-native-header-accent"
        aria-hidden
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
    </header>
  );
}
