"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";

const SUPPORT_EMAIL = "support@blackouttrades.com";

type CatKey = "platform" | "arsenal" | "signals" | "member" | "start";

type Faq = { id: string; catKey: CatKey; cat: string; q: string; a: string };

const CATEGORIES: { key: CatKey; label: string; n: string }[] = [
  { key: "platform", label: "Platform", n: "01" },
  { key: "arsenal", label: "The Arsenal", n: "02" },
  { key: "signals", label: "Signals & Data", n: "03" },
  { key: "member", label: "Membership", n: "04" },
  { key: "start", label: "Getting Started", n: "05" },
];

const RAW: Record<CatKey, { q: string; a: string }[]> = {
  platform: [
    {
      q: "What exactly is BlackOut?",
      a: "BlackOut is an institutional-grade trading intelligence platform built for options and 0DTE traders. It fuses live options flow, an SPX 0DTE command desk, dealer gamma positioning, dark-pool activity, an AI desk analyst (Largo), and an evening swing/leap scanner (Night Hawk) into one screen — compressing what a hedge-fund desk sees into a single decision surface. It is not a Discord, not a signal-seller. It's a decision terminal.",
    },
    {
      q: "Who is BlackOut built for?",
      a: "Active options, SPX and 0DTE traders — anyone who wants institutional data and structure instead of guessing. Serious beginners are covered by the in-app Learn layer; full-time traders get a command center dense enough to run their whole session from.",
    },
    {
      q: "Where does your data come from?",
      a: "From the same caliber of market data that professional trading desks pay a premium for — institutional-grade options and equity feeds, streamed live in real time. We aggregate dealer positioning, options flow, dark-pool prints, and full market internals into one clean signal layer, so you're reading the tape with the same depth the pros do — without stitching together a dozen terminals yourself. No watered-down retail snapshots. No 15-minute delays. Just the real flow, the moment it happens.",
    },
    {
      q: "Do I need to connect a broker?",
      a: "No. BlackOut is a pure intelligence and signal platform — you execute on your own broker. We surface the data, structure, and setups before price moves; you pull the trigger wherever you trade.",
    },
    {
      q: "Is any of this financial advice?",
      a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We just make sure you're never trading blind.",
    },
    {
      q: "Can I use BlackOut on my phone?",
      a: "Yes. BlackOut installs as an app on your phone — an alert-first, glanceable command center built for the way 0DTE traders actually live during market hours.",
    },
  ],
  arsenal: [
    {
      q: "What is the SPX Sniper desk?",
      a: "The 0DTE command center. Live SPX with VWAP, gamma exposure and market internals, plus a graded PLAY CARD: a letter grade (A–F), a numeric score and a confidence read, an 11-point confirmation checklist (MTF, trend, structure, VWAP, flow, dark pool, tide, internals, catalyst, dealer GEX, vol regime), a suggested strike with entry / target / stop — and, critically, the invalidation: the one thing that kills the trade. It answers “what's the setup, and what's the risk” in a single glance.",
    },
    {
      q: "What is Largo, the AI desk analyst?",
      a: "Largo is your AI analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English: “what's the SPX setup right now,” “is this flow real or noise,” “where are dealers trapped.” It answers grounded in the live tape and shows its work, rather than guessing like a generic chatbot.",
    },
    {
      q: "What is the HELIX options-flow feed?",
      a: "Real-time options flow that surfaces institutional footprints instead of a firehose: repeated-hits strike stacks (same-strike accumulation), sweeps versus blocks, call/put pressure, premium and fill counts. You see where size is actually positioning — and our engine merges the live feed with the full session's flow so big prints aren't missed.",
    },
    {
      q: "What is GEX / dealer positioning?",
      a: "Dealer gamma exposure, made actionable. The support and resistance gamma walls, the gamma flip level, and the regime read — positive gamma (dips get bought, range-bound) versus negative gamma (volatility expands). In short: what market makers are forced to do, and where liquidity is likely to pull price.",
    },
    {
      q: "What does the dark-pool view show?",
      a: "Off-exchange institutional prints and levels, anchored to price — where big money is quietly accumulating or distributing away from the lit tape. It makes the invisible part of the market visible.",
    },
    {
      q: "What is Night Hawk?",
      a: "Your AI-generated evening playbook. After the close, Night Hawk builds ranked swing and leap setups with a per-ticker dossier behind each one — so instead of starting tomorrow from a blank chart, you walk in with a plan.",
    },
    {
      q: "Is there a market overview / heatmap?",
      a: "Yes. A market-intelligence layer gives you the regime at a glance: sector heatmaps, leaders and laggards, internals (TICK / TRIN / ADD), market tide, and the macro catalysts on the calendar — so you know the environment before you take a single trade.",
    },
  ],
  signals: [
    {
      q: "How do alerts work?",
      a: "BlackOut surfaces live, in-app alerts the moment flow and desk state change — a setup moving to WATCH, a play promoting to ENTRY, unusual flow stacking into a level. The signal reaches you in real time, so you act on structure forming, not after it's gone.",
    },
    {
      q: "Is the data really real-time?",
      a: "Yes — everything streams live, tick by tick. Quotes, options flow, dealer gamma, dark-pool activity, and your alerts all update the instant the market moves, not on a delay. When a sweep hits the tape or positioning shifts, you see it in real time, the same way an institutional desk would. The platform is built around a live data spine, so the screen in front of you is always the market as it is right now — never a stale snapshot.",
    },
    {
      q: "Do you track your performance?",
      a: "Yes — transparently. BlackOut keeps a verified, append-only track record of closed setups (win rate, best- and worst-case excursion), not a cherry-picked highlight reel. You can judge the engine on its actual results, by grade.",
    },
  ],
  member: [
    {
      q: "How do I get access?",
      a: "Create your free BlackOut account, then choose monthly, yearly, or lifetime access using the same email. One click unlocks the full platform — no separate logins, no friction.",
    },
    {
      q: "What's included in Premium?",
      a: "The entire arsenal, one membership: the SPX Sniper desk, the HELIX live flow feed, Largo AI, GEX / dealer positioning, dark-pool activity, Night Hawk, the market heatmap, and the verified track record. Nothing is held back behind a higher tier.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Billing is handled securely through Whop, and you can manage or cancel your membership anytime from your account. Questions about a charge, an invoice, or your plan? Email billing@blackouttrades.com and we'll sort it out personally.",
    },
  ],
  start: [
    {
      q: "How do I get started in 5 minutes?",
      a: "Create your account, unlock Premium, and open the SPX Sniper desk — the live read is there immediately. Ask Largo your first question (“what's the SPX setup right now?”), and if you're newer to options, start with the in-app Learn layer. You'll be reading the tape like a desk by the end of your first session.",
    },
    {
      q: "How do I reach the team?",
      a: `Email us anytime at ${SUPPORT_EMAIL} — real humans, fast replies. Whether it's billing, access, a feature request, or a question about a setup, we've got you.`,
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
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => (q ? FAQS.filter((f) => (f.q + " " + f.a).toLowerCase().includes(q)) : null),
    [q]
  );

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

  // keyboard: "/" focus search · Esc clear · ←/→ walk answers (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = document.activeElement === searchRef.current;
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && query) {
        setQuery("");
        searchRef.current?.blur();
      } else if (!inInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const idx = FAQS.findIndex((f) => f.id === activeId);
        const next = e.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(FAQS.length - 1, idx + 1);
        if (next !== idx) open(FAQS[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, activeId, open]);

  return (
    <section id="faq" className="relative lg:h-[100svh] lg:overflow-hidden">
      <LandingBackdrop />

      <div className="faq-board relative z-10 mx-auto w-full max-w-[1440px] px-4 lg:px-8 py-14 lg:py-6 lg:h-full">
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
              <h2 className="font-anton text-2xl md:text-[2rem] leading-none mt-1.5 text-white">
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
            <div className="text-left sm:text-right">
              <p className="font-mono text-[10px] tracking-[0.2em] text-sky-300">
                21 ANSWERS · 5 DESKS · ONE WINDOW
              </p>
              <p className="font-mono text-[10px] mt-1.5 flex items-center gap-3 sm:justify-end text-white/85">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bull" /> Data live, real time
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sky-300" /> 5 desks online
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* ── SEARCH ── */}
        <div className="faq-tile fa-search justify-center">
          <label htmlFor="faq-search" className="sr-only">
            Search answers
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-bull/70 font-mono text-sm"
            >
              &#9906;
            </span>
            <input
              id="faq-search"
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — flow, Largo, gamma, billing…"
              className="w-full rounded-xl bg-[rgba(8,8,14,0.7)] border border-[rgba(0,230,118,0.16)] py-2.5 pl-10 pr-24 text-sm text-white placeholder:text-sky-300/45 outline-none transition-colors focus:border-bull/60"
            />
            <span
              aria-live="polite"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-cyan-400"
            >
              {results ? `${results.length} match${results.length === 1 ? "" : "es"}` : ""}
            </span>
          </div>
        </div>

        {/* ── CATEGORY TILES (or search results) ── */}
        {!results ? (
          CATEGORIES.map((c) => {
            const items = FAQS.filter((f) => f.catKey === c.key);
            return (
              <div key={c.key} className={`faq-tile fa-${c.key}`} role="group" aria-label={c.label}>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase flex items-center gap-2 mb-2 shrink-0">
                  <span className="text-bull/70 tabular-nums">{c.n}</span>
                  <span className="text-sky-300">{c.label}</span>
                  <span className="ml-auto text-cyan-400 tabular-nums">{items.length}</span>
                </p>
                <ul className="flex flex-col gap-0.5 min-h-0">
                  {items.map((f) => {
                    const on = active.id === f.id;
                    return (
                      <li key={f.id}>
                        <button
                          onClick={() => open(f.id)}
                          aria-pressed={on}
                          aria-controls="faq-reader"
                          className="group/q w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                          style={{
                            borderLeft: `2px solid ${on ? "#00e676" : "transparent"}`,
                            background: on ? "rgba(0,230,118,0.08)" : "transparent",
                          }}
                        >
                          <span
                            className="truncate text-[13px] transition-colors"
                            style={{ color: on ? "#fff" : "rgba(255,255,255,0.82)" }}
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
                          <div className="lg:hidden px-2 pb-2.5 pt-1">
                            <p className="text-[13px] leading-relaxed text-white/80 m-0">{f.a}</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        ) : (
          <div className="faq-tile fa-results faq-scroll" role="region" aria-label="Search results">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-sky-300 mb-2 shrink-0">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            {results.length === 0 ? (
              <p className="text-sm text-white/80 m-0">
                No matches for &ldquo;{query}&rdquo; —{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bull hover:underline">
                  email the desk
                </a>
                .
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {results.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => {
                        open(f.id);
                        setQuery("");
                      }}
                      className="w-full text-left rounded-md px-3 py-2 transition-colors hover:bg-white/[0.05]"
                    >
                      <span className="block font-mono text-[10px] tracking-[0.15em] text-sky-300 uppercase">
                        {f.cat}
                      </span>
                      <span className="block text-[14px] text-white">{f.q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── SUPPORT ── */}
        <div className="faq-tile fa-support">
          <div className="flex items-center justify-between gap-4 flex-wrap h-full">
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-bull text-lg">
                &#9993;
              </span>
              <div>
                <p className="text-white font-semibold text-[14px] leading-tight m-0">
                  Still stuck? Talk to a human on the desk.
                </p>
                <p className="font-mono text-[10px] text-sky-300 mt-1 hidden xl:block">
                  &uarr;&darr; navigate · Enter open · &larr;&rarr; prev/next · / search · Esc clear
                </p>
              </div>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="rounded-xl px-5 py-2.5 font-semibold text-[13px] tracking-[0.01em] transition-transform hover:scale-[1.02]"
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
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-cyan-400 shrink-0">
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
                className="font-anton text-xl md:text-2xl leading-tight text-white outline-none shrink-0"
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
                className="faq-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2 text-[14px] leading-[1.72] text-white/85"
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
