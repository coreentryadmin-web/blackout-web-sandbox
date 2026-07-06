"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { getIosRouteKey, getIosToolRouteIndex } from "@/lib/ios-tool-routes";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.88 };
const FADE = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

type Props = {
  children: React.ReactNode;
};

/**
 * Direction-aware page transitions for the native iOS shell — spring slide between
 * tab tools; soft fade for utility routes (account, learn, FAQ, admin).
 */
export function IosNativePageTransition({ children }: Props) {
  const path = usePathname();
  const native = useIosNativeShell();
  const reduced = useReducedMotion();
  const prevPath = useRef(path);
  const dirRef = useRef(0);
  const utilityRef = useRef(false);

  if (path !== prevPath.current) {
    const prevIdx = getIosToolRouteIndex(prevPath.current);
    const nextIdx = getIosToolRouteIndex(path);
    const prevTool = prevIdx >= 0;
    const nextTool = nextIdx >= 0;
    dirRef.current =
      prevTool && nextTool && prevIdx !== nextIdx ? (nextIdx > prevIdx ? 1 : -1) : 0;
    utilityRef.current = !nextTool || !prevTool || prevIdx < 0 || nextIdx < 0;
    prevPath.current = path;
  }

  useEffect(() => {
    if (!native) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [path, native]);

  if (!native) return <>{children}</>;

  const dir = dirRef.current;
  const utility = utilityRef.current || getIosToolRouteIndex(path) < 0;
  const offset = reduced || utility ? 0 : dir * 32;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={path}
        className="ios-native-page-stage"
        initial={{
          opacity: reduced ? 0.94 : utility ? 0.88 : 0,
          x: offset,
          y: reduced || !utility ? 0 : 10,
          filter: reduced || utility ? "none" : "blur(6px)",
        }}
        animate={{
          opacity: 1,
          x: 0,
          y: 0,
          filter: "blur(0px)",
        }}
        exit={{
          opacity: reduced ? 0.94 : utility ? 0.88 : 0,
          x: reduced || utility ? 0 : dir * -18,
          y: reduced || !utility ? 0 : -6,
          filter: reduced || utility ? "none" : "blur(4px)",
        }}
        transition={reduced ? { duration: 0.12 } : utility ? FADE : SPRING}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
