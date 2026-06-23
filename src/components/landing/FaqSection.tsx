"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SUPPORT_EMAIL = "support@blackouttrades.com";

type FaqCategory = "Platform" | "The Arsenal" | "Signals & Data" | "Membership" | "Getting Started";

type Faq = { cat: FaqCategory; q: string; a: string };

const CATEGORIES: { key: FaqCategory; label: string; blurb: string }[] = [
  { key: "Platform", label: "Platform", blurb: "What BlackOut is + who it's for" },
  { key: "The Arsenal", label: "The Arsenal", blurb: "Every tool, explained" },
  { key: "Signals & Data", label: "Signals & Data", blurb: "Alerts, feeds, track record" },
  { key: "Membership", label: "Membership", blurb: "Access, plans, billing" },
  { key: "Getting Started", label: "Getting Started", blurb: "First 5 minutes + support" },
];

const FAQS: Faq[] = [
  // ── Platform ──────────────────────────────────────────────────────────────
  {
    cat: "Platform",
    q: "What exactly is BlackOut?",
    a: "BlackOut is an institutional-grade trading intelligence platform built for options and 0DTE traders. It fuses live options flow, an SPX 0DTE command desk, dealer gamma positioning, dark-pool activity, an AI desk analyst (Largo), and an evening swing/leap scanner (Night Hawk) into one screen — compressing what a hedge-fund desk sees into a single decision surface. It is not a Discord, not a signal-seller. It's a decision terminal.",
  },
  {
    cat: "Platform",
    q: "Who is BlackOut built for?",
    a: "Active options, SPX and 0DTE traders — anyone who wants institutional data and structure instead of guessing. Serious beginners are covered by the in-app Learn layer; full-time traders get a command center dense enough to run their whole session from.",
  },
  {
    cat: "Platform",
    q: "Where does your data come from?",
    a: "Real-time institutional feeds: Polygon / Massive for price, options chains and gamma, and Unusual Whales for options flow, dark-pool prints and dealer positioning — streamed over live WebSockets. The same caliber of data professional desks pay for, unified and interpreted for you.",
  },
  {
    cat: "Platform",
    q: "Do I need to connect a broker?",
    a: "No. BlackOut is a pure intelligence and signal platform — you execute on your own broker. We surface the data, structure, and setups before price moves; you pull the trigger wherever you trade.",
  },
  {
    cat: "Platform",
    q: "Is any of this financial advice?",
    a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We make sure you're never trading blind.",
  },
  {
    cat: "Platform",
    q: "Can I use BlackOut on my phone?",
    a: "Yes. BlackOut installs as an app on your phone (PWA) — an alert-first, glanceable command center built for the way 0DTE traders actually live during market hours.",
  },

  // ── The Arsenal ───────────────────────────────────────────────────────────
  {
    cat: "The Arsenal",
    q: "What is the SPX Sniper desk?",
    a: "The 0DTE command center. Live SPX with VWAP, gamma exposure and market internals, plus a graded PLAY CARD: a letter grade (A–F), a numeric score and a confidence read, an 11-point confirmation checklist (MTF, trend, structure, VWAP, flow, dark pool, tide, internals, catalyst, dealer GEX, vol regime), a suggested strike with entry / target / stop — and, critically, the invalidation: the one thing that kills the trade. It answers “what's the setup, and what's the risk” in a single glance.",
  },
  {
    cat: "The Arsenal",
    q: "What is Largo, the AI desk analyst?",
    a: "Largo is your AI analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English: “what's the SPX setup right now,” “is this flow real or noise,” “where are dealers trapped.” It answers grounded in the live tape and shows its work, rather than guessing like a generic chatbot.",
  },
  {
    cat: "The Arsenal",
    q: "What is the HELIX options-flow feed?",
    a: "Real-time options flow that surfaces institutional footprints instead of a firehose: repeated-hits strike stacks (same-strike accumulation), sweeps versus blocks, call/put pressure, premium and fill counts. You see where size is actually positioning — and our engine merges the live feed with the full session's flow so big prints aren't missed.",
  },
  {
    cat: "The Arsenal",
    q: "What is GEX / dealer positioning?",
    a: "Dealer gamma exposure, made actionable. The support and resistance gamma walls, the gamma flip level, and the regime read — positive gamma (dips get bought, range-bound) versus negative gamma (volatility expands). In short: what market makers are forced to do, and where liquidity is likely to pull price.",
  },
  {
    cat: "The Arsenal",
    q: "What does the dark-pool view show?",
    a: "Off-exchange institutional prints and levels, anchored to price — where big money is quietly accumulating or distributing away from the lit tape. It makes the invisible part of the market visible.",
  },
  {
    cat: "The Arsenal",
    q: "What is Night Hawk?",
    a: "Your AI-generated evening playbook. After the close, Night Hawk builds ranked swing and leap setups with a per-ticker dossier behind each one — so instead of starting tomorrow from a blank chart, you walk in with a plan.",
  },
  {
    cat: "The Arsenal",
    q: "Is there a market overview / heatmap?",
    a: "Yes. A market-intelligence layer gives you the regime at a glance: sector heatmaps, leaders and laggards, internals (TICK / TRIN / ADD), market tide, and the macro catalysts on the calendar — so you know the environment before you take a single trade.",
  },

  // ── Signals & Data ────────────────────────────────────────────────────────
  {
    cat: "Signals & Data",
    q: "How do alerts work?",
    a: "BlackOut surfaces live, in-app alerts the moment flow and desk state change — a setup moving to WATCH, a play promoting to ENTRY, unusual flow stacking into a level. The signal reaches you in real time, so you act on structure forming, not after it's gone.",
  },
  {
    cat: "Signals & Data",
    q: "Is the data really real-time?",
    a: "For members, yes — the desk, flow, gamma and dark-pool surfaces stream over live WebSocket feeds, not minute-delayed snapshots. Public and marketing previews may be shown on a delay; the live platform is built around immediacy.",
  },
  {
    cat: "Signals & Data",
    q: "Do you track your performance?",
    a: "Yes — transparently. BlackOut keeps a verified, append-only track record of closed setups (win rate, best- and worst-case excursion), not a cherry-picked highlight reel. You can judge the engine on its actual results, by grade.",
  },

  // ── Membership ────────────────────────────────────────────────────────────
  {
    cat: "Membership",
    q: "How do I get access?",
    a: "Create your free BlackOut account, then choose monthly, yearly, or lifetime access using the same email. One click unlocks the full platform — no separate logins, no friction.",
  },
  {
    cat: "Membership",
    q: "What's included in Premium?",
    a: "The entire arsenal, one membership: the SPX Sniper desk, the HELIX live flow feed, Largo AI, GEX / dealer positioning, dark-pool activity, Night Hawk, the market heatmap, and the verified track record. Nothing is held back behind a higher tier.",
  },
  {
    cat: "Membership",
    q: "Can I cancel anytime?",
    a: "Yes. Billing is handled securely through Whop, and you can manage or cancel your membership anytime from your account. Questions about a charge or your plan? Email us and we'll sort it out personally.",
  },

  // ── Getting Started ───────────────────────────────────────────────────────
  {
    cat: "Getting Started",
    q: "How do I get started in 5 minutes?",
    a: "Create your account, unlock Premium, and open the SPX Sniper desk — the live read is there immediately. Ask Largo your first question (“what's the SPX setup right now?”), and if you're newer to options, start with the in-app Learn layer. You'll be reading the tape like a desk by the end of your first session.",
  },
  {
    cat: "Getting Started",
    q: "How do I reach the team?",
    a: `Email us anytime at ${SUPPORT_EMAIL} — real humans, fast replies. Whether it's billing, access, a feature request, or a question about a setup, we've got you.`,
  },
];

export function FaqSection() {
  const [active, setActive] = useState<FaqCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((f) => {
      if (active !== "All" && f.cat !== active) return false;
      if (!q) return true;
      return f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q);
    });
  }, [active, query]);

  return (
    <section
      id="faq"
      className="landing-section landing-section-cut relative py-24 md:py-32 px-4 md:px-8 overflow-hidden"
    >
      {/* ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-[420px] w-[820px] rounded-full blur-[120px] opacity-[0.10]"
        style={{ background: "radial-gradient(closest-side, #00e676, transparent)" }}
      />

      <div className="max-w-3xl mx-auto relative z-10">
        {/* header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-3">
            &#9670; Frequently Asked
          </p>
          <h2 className="font-anton text-5xl md:text-6xl tracking-tight text-white leading-none">
            EVERYTHING<span className="text-bull">.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70 max-w-xl mx-auto">
            Every tool, every signal, every answer — what BlackOut is, how the arsenal works, and how
            to get the institutional edge running for you.
          </p>
        </motion.div>

        {/* search */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative mb-5"
        >
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-bull/70 font-mono text-sm">
            &#9906;
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the FAQ — flow, Largo, gamma, billing…"
            aria-label="Search frequently asked questions"
            className="w-full rounded-lg bg-[rgba(8,8,14,0.7)] border border-[rgba(0,230,118,0.18)] py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-bull/60"
            style={{ backdropFilter: "blur(10px)" }}
          />
        </motion.div>

        {/* category filter */}
        <div className="mb-7 flex flex-wrap gap-2">
          <CategoryPill
            label="All"
            active={active === "All"}
            onClick={() => setActive("All")}
          />
          {CATEGORIES.map((c) => (
            <CategoryPill
              key={c.key}
              label={c.label}
              active={active === c.key}
              onClick={() => setActive(c.key)}
            />
          ))}
        </div>

        {/* accordion */}
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false} mode="popLayout">
            {filtered.map((item, i) => {
              const isOpen = open === item.q;
              const answerId = `faq-answer-${i}`;
              return (
                <motion.div
                  key={item.q}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className="rounded-xl border bg-[rgba(8,8,14,0.7)] overflow-hidden transition-colors"
                  style={{
                    backdropFilter: "blur(10px)",
                    borderColor: isOpen ? "rgba(0,230,118,0.4)" : "rgba(0,230,118,0.14)",
                    boxShadow: isOpen ? "0 0 40px -16px rgba(0,230,118,0.45)" : "none",
                  }}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : item.q)}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left"
                  >
                    <span
                      className="font-mono text-[11px] tabular-nums shrink-0 transition-colors"
                      style={{ color: isOpen ? "#00e676" : "rgba(125,211,252,0.65)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 text-[15px] md:text-base font-semibold tracking-[0.01em] text-white">
                      {item.q}
                    </span>
                    <span
                      className="font-mono text-lg leading-none shrink-0 text-bull transition-transform duration-300"
                      style={{ transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" }}
                      aria-hidden
                    >
                      +
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={answerId}
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="px-5 pb-5 pl-[3.4rem]">
                          <p className="text-[14px] leading-[1.7] text-white/75 m-0">{item.a}</p>
                          <span className="mt-3 inline-block font-mono text-[10px] tracking-[0.18em] uppercase text-bull/60">
                            {item.cat}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {filtered.length === 0 && (
            <div className="rounded-xl border border-[rgba(0,230,118,0.14)] bg-[rgba(8,8,14,0.7)] px-5 py-8 text-center">
              <p className="text-sm text-white/70 m-0">
                No matches for &ldquo;{query}&rdquo;. Try another term — or just ask us directly.
              </p>
            </div>
          )}
        </div>

        {/* support CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 rounded-2xl border border-[rgba(0,230,118,0.22)] p-7 md:p-8 text-center relative overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,230,118,0.06), rgba(8,8,14,0.75))",
            backdropFilter: "blur(14px)",
          }}
        >
          <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-3">
            &#9670; Still have a question?
          </p>
          <h3 className="font-anton text-2xl md:text-3xl text-white tracking-tight leading-tight">
            TALK TO A HUMAN ON THE DESK
          </h3>
          <p className="mt-3 text-sm text-white/70 max-w-md mx-auto">
            Real people, fast replies — billing, access, feature requests, or a read on a setup.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="group mt-6 inline-flex items-center gap-3 rounded-xl px-6 py-3.5 font-semibold text-[15px] tracking-[0.02em] transition-transform duration-200 hover:scale-[1.02]"
            style={{
              background: "linear-gradient(180deg, #00e676, #0f9d58)",
              color: "#021c14",
              boxShadow: "0 0 36px -8px rgba(0,230,118,0.55)",
            }}
          >
            <span className="font-mono text-base" aria-hidden>
              &#9993;
            </span>
            {SUPPORT_EMAIL}
          </a>
        </motion.div>
      </div>
    </section>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-4 py-2 text-[12px] font-semibold tracking-[0.04em] transition-all duration-200"
      style={
        active
          ? {
              background: "rgba(0,230,118,0.14)",
              border: "1px solid rgba(0,230,118,0.5)",
              color: "#00e676",
              boxShadow: "0 0 22px -10px rgba(0,230,118,0.6)",
            }
          : {
              background: "rgba(8,8,14,0.6)",
              border: "1px solid rgba(125,211,252,0.12)",
              color: "rgba(255,255,255,0.62)",
            }
      }
    >
      {label}
    </button>
  );
}
