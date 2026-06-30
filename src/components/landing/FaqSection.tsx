"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";

const SUPPORT_EMAIL = "support@blackouttrades.com";

type CatKey = "platform" | "arsenal" | "signals" | "member" | "start";

type Faq = { id: string; catKey: CatKey; cat: string; q: string; a: string };

const CATEGORIES: { key: CatKey; label: string; n: string; blurb: string; wide?: boolean }[] = [
  { key: "platform", label: "Platform", n: "01", blurb: "What BlackOut is, and how it runs." },
  { key: "arsenal", label: "Instruments", n: "02", blurb: "Every instrument on the desk, broken down." },
  { key: "signals", label: "Signals & Data", n: "03", blurb: "Alerts, latency, and the proof." },
  { key: "member", label: "Membership", n: "04", blurb: "Access, pricing, and cancellation.", wide: true },
  { key: "start", label: "Getting Started", n: "05", blurb: "From zero to live in one session.", wide: true },
];

const RAW: Record<CatKey, { q: string; a: string }[]> = {
  platform: [
    {
      q: "What exactly is BlackOut?",
      a: "BlackOut is an institutional-grade trading intelligence platform built for options and 0DTE traders. It combines live options flow, the SPX Slayer desk, dealer gamma positioning, dark-pool activity, Largo analysis, and the Night Hawk overnight playbook into one surface — what a professional desk sees, built for individual traders.",
    },
    {
      q: "Who is BlackOut built for?",
      a: "Active options, SPX and 0DTE traders — anyone who wants real structure on the screen instead of a hunch. Serious beginners are covered by the in-app Learn layer; full-time operators get a command surface dense enough to run a whole session from.",
    },
    {
      q: "Where does your data come from?",
      a: "Aggregated from professional-grade options and equity feeds, streamed live. We merge dealer positioning, options flow, dark-pool prints, and full market internals into one clean signal layer — the depth the pros run on, without stitching together a dozen terminals yourself.",
    },
    {
      q: "Do I need to connect a broker?",
      a: "No. BlackOut is a pure intelligence layer — you execute on your own broker. We surface the data, structure, and setups before price moves; you pull the trigger wherever you already trade.",
    },
    {
      q: "Is any of this financial advice?",
      a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We just make sure you're never guessing the structure.",
    },
    {
      q: "Can I use BlackOut on my phone?",
      a: "Yes. BlackOut installs as an app on your phone — an alert-first, glanceable command surface built for the way 0DTE traders actually live during market hours.",
    },
  ],
  arsenal: [
    {
      q: "What is the SPX Slayer desk?",
      a: "The primary 0DTE desk. Live SPX with VWAP, gamma exposure and market internals, plus a graded play card: letter grade (A–F), numeric score, confidence read, an 11-point confirmation checklist (MTF, trend, structure, VWAP, flow, dark pool, tide, internals, catalyst, dealer GEX, vol regime), a suggested strike with entry / target / stop — and the invalidation level. It answers what's the setup and what's the risk in a single glance.",
    },
    {
      q: "What is Largo, the BlackOut Intelligence desk analyst?",
      a: "Largo is your BlackOut Intelligence desk analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English: 'what's the SPX setup right now,' 'is this flow real or noise,' 'where are dealers trapped.' It answers grounded in live data and shows its work — never a guess pulled from thin air.",
    },
    {
      q: "What is the HELIX options-flow feed?",
      a: "Live options flow filtered down to what moves the desk, not a firehose: repeated-hit strike stacks (same-strike accumulation), sweeps versus blocks, call/put pressure, premium and fill counts. The engine merges the live feed with the full session's flow so the big prints never slip past.",
    },
    {
      q: "What is GEX / dealer positioning?",
      a: "Dealer gamma exposure, made actionable. The support and resistance gamma walls, the gamma flip level, and the regime read — positive gamma (dips get bought, range-bound) versus negative gamma (volatility expands). In short: what market makers are forced to do, and where liquidity is likely to pull price.",
    },
    {
      q: "What does the dark-pool view show?",
      a: "Off-exchange institutional prints and levels, anchored to price — where size is quietly accumulating or distributing away from the lit tape. The flow that prints in the dark, surfaced next to the level it sits on.",
    },
    {
      q: "What is Night Hawk?",
      a: "Your BlackOut Intelligence evening playbook. After the close, Night Hawk builds ranked swing and leap setups with a per-ticker dossier behind each one — so instead of starting tomorrow from a blank chart, you walk in with a plan.",
    },
    {
      q: "Is there a market overview / heatmap?",
      a: "Yes — a dealer-positioning heatmap. It maps GEX, VEX, DEX and charm by strike: the gamma walls that pin or repel price, the flip level where the regime turns, and where dealer flow concentrates. You read market structure before the first trade goes on, not a stale sector grid.",
    },
  ],
  signals: [
    {
      q: "How do alerts work?",
      a: "BlackOut surfaces live, in-app alerts the moment flow and desk state change — a setup moving to WATCH, a play promoting to ENTRY, unusual flow stacking into a level. The signal reaches you in real time, so you act on structure forming, not after it's gone.",
    },
    {
      q: "Is the data really real-time?",
      a: "Yes — everything streams live, tick by tick. Quotes, options flow, dealer gamma, dark-pool activity, and your alerts all update the instant the market moves, not on a delay. When a sweep hits or positioning shifts, you see it as it prints — the screen in front of you is always the market as it is right now, never a stale snapshot.",
    },
    {
      q: "Do you track your performance?",
      a: "Yes — transparently. BlackOut keeps an append-only log of every closed SPX setup, scored by its original grade, with best- and worst-case excursion recorded — not a cherry-picked highlight reel. You judge the grader on its own logged results, not our word. Past performance is no guarantee of future results.",
    },
  ],
  member: [
    {
      q: "How do I get access?",
      a: "Create your free BlackOut account, then choose monthly, yearly, or lifetime access using the same email. One click unlocks the full platform — same login, full clearance.",
    },
    {
      q: "What's included in Premium?",
      a: "The entire arsenal, one membership: the SPX Slayer desk, the HELIX live flow feed, Largo, GEX / dealer positioning, dark-pool activity, Night Hawk, the market heatmap, and the public play log. One tier, full clearance — nothing held back.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Billing is handled through our secure checkout partner, and you can manage or cancel your membership anytime from your account. Questions about a charge, an invoice, or your plan? Email billing@blackouttrades.com and we'll sort it out personally.",
    },
  ],
  start: [
    {
      q: "How do I get started in 5 minutes?",
      a: "Create your account, unlock Premium, and open the SPX Slayer desk — the live read is there immediately. Ask Largo your first question ('what's the SPX setup right now?'), and if you're newer to options, start with the in-app Learn layer. Inside your first session you'll have the desk's full read in front of you.",
    },
    {
      q: "How do I reach the team?",
      a: `Email us anytime at ${SUPPORT_EMAIL} — real people, fast replies. Billing, access, a feature request, or a question about a setup: it reaches the desk.`,
    },
  ],
};

const FAQS: Faq[] = CATEGORIES.flatMap((c) =>
  RAW[c.key].map((it, i) => ({
    id: `${c.key}-${i + 1}`,
    catKey: c.key,
    cat: c.label,
    q: it.q,
    a: it.a,
  }))
);

export function FaqSection() {
  const [activeId, setActiveId] = useState<string>(FAQS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const active = FAQS.find((f) => f.id === activeId) ?? FAQS[0];
  const flatIndex = FAQS.findIndex((f) => f.id === active.id);

  const open = useCallback((id: string) => {
    setActiveId(id);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  }, []);

  // deep-link: honor #<id> on mount
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h && FAQS.some((f) => f.id === h)) setActiveId(h);
  }, []);

  // keyboard: ←/→ walk through answers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const idx = FAQS.findIndex((f) => f.id === activeId);
      const next = e.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(FAQS.length - 1, idx + 1);
      if (next !== idx) open(FAQS[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, open]);

  return (
    <section id="faq" className="relative lg:h-[100svh] lg:overflow-hidden">
      <LandingBackdrop />

      <div className="faq-board relative z-10 mx-auto w-full max-w-[2100px] px-4 lg:px-10 py-14 lg:py-6 lg:h-full">
        {/* ── BRAND ── */}
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
            <p className="hidden md:block max-w-md text-left sm:text-right text-[14px] leading-relaxed text-secondary">
              Every tool, every signal, every answer — what BlackOut is and how the
              arsenal works, end to end.
            </p>
          </div>
        </div>

        {/* ── CATEGORY TILES ── */}
        {CATEGORIES.map((c) => {
            const items = FAQS.filter((f) => f.catKey === c.key);
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
                      ? "flex flex-col gap-1 min-h-0 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-1"
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
                        {/* mobile inline answer (desktop uses the reader rail) */}
                        {on && (
                          <div className="lg:hidden px-3 pb-3 pt-1">
                            <p className="text-[14px] leading-relaxed text-white/80 m-0">{f.a}</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

        {/* ── SUPPORT ── */}
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
              href={`mailto:${SUPPORT_EMAIL}`}
              className="rounded-xl px-6 py-3 font-semibold text-[14px] tracking-[0.01em] transition-transform hover:scale-[1.02]"
              style={{
                background: "linear-gradient(180deg, #00e676, #0f9d58)",
                color: "#021c14",
                boxShadow: "0 0 30px -10px rgba(0,230,118,0.6)",
              }}
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>

        {/* ── READER (desktop persistent rail — the single scroll owner) ── */}
        <section
          id="faq-reader"
          role="region"
          aria-live="polite"
          aria-label="Answer"
          className="faq-tile fa-reader hidden lg:flex"
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
              onClick={() => open(FAQS[Math.max(0, flatIndex - 1)].id)}
              disabled={flatIndex === 0}
              className="disabled:opacity-30 hover:text-bull transition-colors"
            >
              &lsaquo; Prev
            </button>
            <span className="tabular-nums text-white/70">
              {String(flatIndex + 1).padStart(2, "0")} / {FAQS.length}
            </span>
            <button
              onClick={() => open(FAQS[Math.min(FAQS.length - 1, flatIndex + 1)].id)}
              disabled={flatIndex === FAQS.length - 1}
              className="disabled:opacity-30 hover:text-bull transition-colors"
            >
              Next &rsaquo;
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
