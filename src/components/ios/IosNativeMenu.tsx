"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import { IOS_TOOLS } from "@/lib/ios-tool-routes";
import { ProductMark } from "@/components/marks/ProductMark";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";
import { iosHapticImpact, iosHapticSelection } from "@/lib/ios-haptics";

type Props = {
  open: boolean;
  onClose: () => void;
  lockedTools?: ToolKey[];
  showAdmin?: boolean;
};

const SHEET_SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.85 };
const DISMISS_OFFSET = 96;
const LIST_STAGGER = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03, delayChildren: 0.04 } },
};
const LIST_ITEM = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
};

/** Command deck — vertical instrument list (not a 2×2 card grid). */
export function IosNativeMenu({ open, onClose, lockedTools = [], showAdmin }: Props) {
  const path = usePathname();

  useEffect(() => {
    if (open) iosHapticImpact("Light");
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="ios-native-menu-scrim"
            aria-label="Close command deck"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command deck"
            className="ios-native-menu-sheet outline-none"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SHEET_SPRING}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.35 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_OFFSET || info.velocity.y > 520) onClose();
            }}
          >
            <div className="ios-native-menu-handle" aria-hidden />
            <p className="ios-native-menu-kicker">Instruments</p>

            <motion.div
              className="ios-native-menu-grid"
              variants={LIST_STAGGER}
              initial="hidden"
              animate="show"
            >
              {IOS_TOOLS.map((tool) => {
                const key = toolKeyForHref(tool.href);
                const locked = key != null && lockedTools.includes(key);
                const active = path === tool.href || path.startsWith(`${tool.href}/`);
                return (
                  <motion.div key={tool.href} variants={LIST_ITEM}>
                    <Link
                      href={tool.href}
                      prefetch={false}
                      scroll={false}
                      onClick={() => {
                        iosHapticSelection();
                        onClose();
                      }}
                      className={clsx(
                        "ios-native-menu-tool",
                        active && "ios-native-menu-tool-active",
                        locked && "ios-native-menu-tool-locked"
                      )}
                      style={{ "--tool-accent": tool.accent } as React.CSSProperties}
                    >
                      <ProductMark product={tool.mark} size={28} title={tool.label} />
                      <div className="ios-native-menu-tool-body">
                        <span className="ios-native-menu-tool-label">{tool.label}</span>
                        <span className="ios-native-menu-tool-sub">{tool.tagline}</span>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>

            <div className="ios-native-menu-links">
              <Link href="/account" scroll={false} onClick={onClose} className="ios-native-menu-link">
                Account
              </Link>
              <Link href="/upgrade" scroll={false} onClick={onClose} className="ios-native-menu-link">
                Membership
              </Link>
              <Link href="/faq" scroll={false} onClick={onClose} className="ios-native-menu-link">
                FAQ
              </Link>
              <Link href="/learn" scroll={false} onClick={onClose} className="ios-native-menu-link">
                Learn
              </Link>
              {showAdmin && (
                <Link href="/admin" scroll={false} onClick={onClose} className="ios-native-menu-link text-bear">
                  Admin
                </Link>
              )}
            </div>

            <div className="ios-native-menu-footer">
              <PushNotificationToggle />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
