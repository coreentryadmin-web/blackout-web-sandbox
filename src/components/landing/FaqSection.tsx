"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";
import { FaqNativeView } from "@/components/faq/FaqNativeView";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "@/lib/faq/content";

export function FaqSection() {
  const native = useIosNativeShell();
  if (native) return <FaqNativeView />;

  return <FaqSectionWeb />;
}

function FaqSectionWeb() {
  const [activeId, setActiveId] = useState<string>(FAQ_ITEMS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const active = FAQ_ITEMS.find((f) => f.id === activeId) ?? FAQ_ITEMS[0];
  const flatIndex = FAQ_ITEMS.findIndex((f) => f.id === active.id);

  const open = useCallback((id: string) => {
    setActiveId(id);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h && FAQ_ITEMS.some((f) => f.id === h)) setActiveId(h);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const idx = FAQ_ITEMS.findIndex((f) => f.id === activeId);
      const next = e.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(FAQ_ITEMS.length - 1, idx + 1);
      if (next !== idx) open(FAQ_ITEMS[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, open]);

  return (
    <section id="faq" className="relative min-h-[100svh] overflow-hidden">
      <LandingBackdrop />

      <div className="faq-board-scroll relative z-10 mx-auto w-full max-w-[2100px] px-4 lg:px-10 py-14 lg:py-6 lg:h-full">
        <div className="faq-board lg:h-full">
          <div className="faq-tile fa-brand justify-center">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-cyan-400 uppercase flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-bull animate-pulse motion-reduce:animate-none"
                    style={{ boxShadow: "0 0 10px #00e676" }}
                  />
                  The Briefing
                </p>
                <h2 className="font-anton text-3xl md:text-[2.7rem] leading-none mt-1.5 text-white">
                  EVERYTHING,{" "}
                  <span
                    style={{
                      background: "linear-gradient(90deg, #00e676, #34d399 55%, #7dd3fc)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }}
                  >
                    EXPLAINED.
                  </span>
                </h2>
              </div>
              <p className="max-w-md text-left sm:text-right text-[14px] leading-relaxed text-secondary">
                Every tool, every signal, every answer — what BlackOut is and how the arsenal works,
                end to end.
              </p>
            </div>
          </div>

          {FAQ_CATEGORIES.map((c) => {
            const items = FAQ_ITEMS.filter((f) => f.catKey === c.key);
            return (
              <div key={c.key} className={`faq-tile fa-${c.key}`} role="group" aria-label={c.label}>
                <p className="font-mono text-[11px] tracking-[0.22em] uppercase flex items-center gap-2 shrink-0">
                  <span className="text-bull/70 tabular-nums">{c.n}</span>
                  <span className="text-sky-300">{c.label}</span>
                  <span className="ml-auto text-cyan-400 tabular-nums">{items.length}</span>
                </p>
                <p className="text-[12.5px] text-sky-300/70 mt-1.5 mb-3 shrink-0">{c.blurb}</p>
                <ul
                  className={
                    c.wide
                      ? "grid grid-cols-2 gap-x-6 gap-y-1 min-h-0"
                      : "flex flex-col gap-1 min-h-0"
                  }
                >
                  {items.map((f) => {
                    const on = active.id === f.id;
                    return (
                      <li key={f.id}>
                        <button
                          onClick={() => open(f.id)}
                          aria-pressed={on}
                          aria-controls="faq-reader"
                          className="group/q w-full flex items-center gap-2 text-left rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.05]"
                          style={{
                            borderLeft: `2px solid ${on ? "#00e676" : "transparent"}`,
                            background: on ? "rgba(0,230,118,0.08)" : "transparent",
                          }}
                        >
                          <span
                            className="truncate text-[14.5px] font-medium transition-colors"
                            style={{ color: on ? "#fff" : "rgba(255,255,255,0.85)" }}
                          >
                            {f.q}
                          </span>
                          <span
                            aria-hidden
                            className="ml-auto shrink-0 text-bull/60 transition-transform group-hover/q:translate-x-0.5"
                          >
                            &rsaquo;
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <div className="faq-tile fa-support">
            <div className="flex items-center justify-between gap-4 flex-wrap h-full">
              <div className="flex items-center gap-3">
                <span aria-hidden className="text-bull text-lg">
                  &#9993;
                </span>
                <div>
                  <p className="text-white font-semibold text-[15px] leading-tight m-0">
                    Need a human? Reach the desk directly.
                  </p>
                </div>
              </div>
              <a
                href="mailto:support@blackouttrades.com"
                className="rounded-xl px-6 py-3 font-semibold text-[14px] tracking-[0.01em] transition-transform hover:scale-[1.02]"
                style={{
                  background: "linear-gradient(180deg, #00e676, #0f9d58)",
                  color: "#021c14",
                  boxShadow: "0 0 30px -10px rgba(0,230,118,0.6)",
                }}
              >
                support@blackouttrades.com
              </a>
            </div>
          </div>

          <section
            id="faq-reader"
            role="region"
            aria-live="polite"
            aria-label="Answer"
            className="faq-tile fa-reader flex"
            style={{
              border: "1px solid rgba(0,230,118,0.4)",
              background: "linear-gradient(180deg, rgba(0,230,118,0.06), rgba(8,9,14,0.85))",
              boxShadow: "0 18px 60px -28px rgba(0,230,118,0.5)",
            }}
          >
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-cyan-400 shrink-0">
              {active.cat} / {String(flatIndex + 1).padStart(2, "0")}
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                className="flex flex-col min-h-0 flex-1 mt-2"
              >
                <h3
                  ref={headingRef}
                  tabIndex={-1}
                  className="font-anton text-2xl md:text-[2.1rem] leading-tight text-white outline-none shrink-0"
                >
                  {active.q}
                </h3>
                <div
                  className="mt-2.5 mb-3 h-px shrink-0"
                  style={{ background: "linear-gradient(90deg, rgba(0,230,118,0.3), transparent 70%)" }}
                />
                <div
                  ref={bodyRef}
                  tabIndex={0}
                  className="faq-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2 text-[15px] md:text-base leading-[1.8] text-white/90"
                >
                  {active.a}
                </div>
              </motion.div>
            </AnimatePresence>
            <div
              className="mt-3 pt-3 flex items-center justify-between font-mono text-[11px] text-sky-300 shrink-0"
              style={{ borderTop: "1px solid rgba(125,211,252,0.1)" }}
            >
              <button
                onClick={() => open(FAQ_ITEMS[Math.max(0, flatIndex - 1)].id)}
                disabled={flatIndex === 0}
                className="disabled:opacity-30 hover:text-bull transition-colors"
              >
                &lsaquo; Prev
              </button>
              <span className="tabular-nums text-white/70">
                {String(flatIndex + 1).padStart(2, "0")} / {FAQ_ITEMS.length}
              </span>
              <button
                onClick={() => open(FAQ_ITEMS[Math.min(FAQ_ITEMS.length - 1, flatIndex + 1)].id)}
                disabled={flatIndex === FAQ_ITEMS.length - 1}
                className="disabled:opacity-30 hover:text-bull transition-colors"
              >
                Next &rsaquo;
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
