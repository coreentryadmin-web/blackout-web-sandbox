"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SUPPORT_EMAIL = "support@blackouttrades.com";

type FaqCategory = "Platform" | "The Arsenal" | "Signals & Data" | "Membership" | "Getting Started";

type Faq = { cat: FaqCategory; q: string; a: string };

const CATEGORY_ORDER: FaqCategory[] = [
  "Platform",
  "The Arsenal",
  "Signals & Data",
  "Membership",
  "Getting Started",
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
    a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We just make sure you're never trading blind.",
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
    a: "Yes. Billing is handled securely through Whop, and you can manage or cancel your membership anytime from your account. Questions about a charge, an invoice, or your plan? Email billing@blackouttrades.com and we'll sort it out personally.",
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return FAQS.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [q]);

  // global index for the mono number badges (stable across grouping)
  const indexOf = (qq: string) => FAQS.findIndex((f) => f.q === qq);

  return (
    <section
      id="faq"
      className="landing-section landing-section-cut relative py-24 md:py-32 px-4 md:px-8 overflow-hidden"
    >
      {/* ───────────── layered professional backdrop ───────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* base wash — lifts the void off pure black with a faint blue-green tint + vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(125% 90% at 50% -10%, rgba(8,20,17,0.85), transparent 55%), radial-gradient(100% 80% at 50% 115%, rgba(6,10,20,0.9), transparent 60%)",
          }}
        />
        {/* aurora orbs — slow drift, three hues for depth (reduced-motion auto-respected) */}
        <motion.div
          className="absolute rounded-full"
          style={{ top: "-16%", right: "-8%", height: 640, width: 640, filter: "blur(150px)", background: "radial-gradient(closest-side, #00e676, transparent)", opacity: 0.15 }}
          animate={{ x: [0, 34, -12, 0], y: [0, 22, -14, 0] }}
          transition={{ duration: 34, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{ bottom: "-20%", left: "-10%", height: 560, width: 560, filter: "blur(150px)", background: "radial-gradient(closest-side, #22d3ee, transparent)", opacity: 0.1 }}
          animate={{ x: [0, -26, 16, 0], y: [0, -18, 12, 0] }}
          transition={{ duration: 42, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{ bottom: "-26%", left: "42%", height: 520, width: 520, filter: "blur(160px)", background: "radial-gradient(closest-side, #7c5cff, transparent)", opacity: 0.08 }}
          animate={{ x: [0, 18, -20, 0], y: [0, -10, 8, 0] }}
          transition={{ duration: 50, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* institutional grid, masked to the center */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,230,118,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,230,118,0.6) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(ellipse 75% 65% at 50% 38%, #000 30%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 38%, #000 30%, transparent 78%)",
          }}
        />
        {/* on-brand market-chart silhouette along the bottom */}
        <svg
          className="absolute bottom-0 left-0 w-full h-[42%]"
          viewBox="0 0 1440 240"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="faqArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e676" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,205 L90,195 L180,200 L270,175 L360,188 L450,160 L540,178 L630,150 L720,168 L810,140 L900,162 L990,135 L1080,156 L1170,128 L1260,150 L1350,122 L1440,145"
            stroke="#1d9e75"
            strokeOpacity="0.16"
            strokeWidth="1.5"
          />
          <path
            d="M0,180 L80,160 L160,172 L240,128 L320,150 L400,104 L480,126 L560,88 L640,110 L720,70 L800,98 L880,58 L960,84 L1040,46 L1120,72 L1200,36 L1280,60 L1360,28 L1440,50 L1440,240 L0,240 Z"
            fill="url(#faqArea)"
          />
          <path
            d="M0,180 L80,160 L160,172 L240,128 L320,150 L400,104 L480,126 L560,88 L640,110 L720,70 L800,98 L880,58 L960,84 L1040,46 L1120,72 L1200,36 L1280,60 L1360,28 L1440,50"
            stroke="#00e676"
            strokeOpacity="0.28"
            strokeWidth="1.75"
          />
        </svg>
        {/* fine film grain — removes banding + adds premium matte texture */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            mixBlendMode: "soft-light",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        {/* crisp top hairline */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(0,230,118,0.4), transparent)" }}
        />
      </div>

      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-[0.82fr_1.18fr] gap-10 lg:gap-16 items-start">
        {/* ───────────────── LEFT: brand intro + support (sticky) ───────────────── */}
        <motion.aside
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="lg:sticky lg:top-28"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-4 flex items-center gap-2">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-bull" style={{ boxShadow: "0 0 10px #00e676" }} />
            The Briefing
          </p>
          <h2 className="font-anton text-5xl md:text-[4.25rem] leading-[0.92] tracking-tight text-white">
            EVERYTHING,
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #00e676, #34d399 60%, #7dd3fc)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              EXPLAINED.
            </span>
          </h2>
          <p className="mt-6 text-[15px] leading-relaxed text-white/65 max-w-sm">
            Every tool, every signal, every answer — what BlackOut is, how the arsenal works, and how
            to get the institutional edge running for you in minutes.
          </p>

          {/* support card */}
          <div
            className="mt-8 rounded-2xl border p-6 relative overflow-hidden"
            style={{
              borderColor: "rgba(0,230,118,0.22)",
              background: "linear-gradient(180deg, rgba(0,230,118,0.07), rgba(8,8,14,0.6))",
              backdropFilter: "blur(14px)",
            }}
          >
            <p className="font-mono text-[10px] tracking-[0.35em] text-bull uppercase mb-2">
              Still stuck?
            </p>
            <p className="text-white font-semibold text-[15px] leading-snug">
              Talk to a human on the desk.
            </p>
            <p className="mt-1.5 text-[13px] text-white/55 leading-relaxed">
              Real people, fast replies — billing, access, or a read on a setup.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-4 inline-flex items-center gap-2.5 rounded-xl px-5 py-3 font-semibold text-[14px] tracking-[0.01em] transition-transform duration-200 hover:scale-[1.02]"
              style={{
                background: "linear-gradient(180deg, #00e676, #0f9d58)",
                color: "#021c14",
                boxShadow: "0 0 34px -10px rgba(0,230,118,0.6)",
              }}
            >
              <span className="font-mono text-[15px]" aria-hidden>
                &#9993;
              </span>
              {SUPPORT_EMAIL}
            </a>
          </div>
        </motion.aside>

        {/* ───────────────── RIGHT: search + grouped accordion ───────────────── */}
        <div>
          {/* search */}
          <div className="relative mb-7">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-bull/70 font-mono text-sm" aria-hidden>
              &#9906;
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — flow, Largo, gamma, billing…"
              aria-label="Search frequently asked questions"
              className="w-full rounded-xl bg-[rgba(8,8,14,0.7)] border border-[rgba(0,230,118,0.16)] py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-bull/60"
              style={{ backdropFilter: "blur(10px)" }}
            />
          </div>

          {matches ? (
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-white/40 mb-1">
                {matches.length} result{matches.length === 1 ? "" : "s"}
              </p>
              <AnimatePresence initial={false} mode="popLayout">
                {matches.map((item) => (
                  <FaqItem
                    key={item.q}
                    item={item}
                    index={indexOf(item.q)}
                    isOpen={open === item.q}
                    onToggle={() => setOpen(open === item.q ? null : item.q)}
                  />
                ))}
              </AnimatePresence>
              {matches.length === 0 && (
                <div className="rounded-xl border border-[rgba(0,230,118,0.14)] bg-[rgba(8,8,14,0.7)] px-5 py-8 text-center">
                  <p className="text-sm text-white/65 m-0">
                    No matches for &ldquo;{query}&rdquo;. Try another term — or email us directly.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-9">
              {CATEGORY_ORDER.map((cat, ci) => {
                const items = FAQS.filter((f) => f.cat === cat);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-3 mb-3.5">
                      <span className="font-mono text-[11px] text-bull/70 tabular-nums">
                        {String(ci + 1).padStart(2, "0")}
                      </span>
                      <span className="font-mono text-[11px] tracking-[0.28em] uppercase text-white/55">
                        {cat}
                      </span>
                      <span className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(0,230,118,0.25), transparent)" }} />
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {items.map((item) => (
                        <FaqItem
                          key={item.q}
                          item={item}
                          index={indexOf(item.q)}
                          isOpen={open === item.q}
                          onToggle={() => setOpen(open === item.q ? null : item.q)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FaqItem({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: Faq;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const answerId = `faq-a-${index}`;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="group relative rounded-xl overflow-hidden"
      style={{
        background: isOpen ? "rgba(12,16,22,0.92)" : "rgba(8,9,14,0.66)",
        border: `1px solid ${isOpen ? "rgba(0,230,118,0.42)" : "rgba(125,211,252,0.08)"}`,
        backdropFilter: "blur(12px)",
        boxShadow: isOpen ? "0 18px 50px -22px rgba(0,230,118,0.5)" : "none",
        transition: "background .25s ease, border-color .25s ease, box-shadow .25s ease",
      }}
    >
      {/* left accent rail */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2px] transition-all duration-300"
        style={{
          background: isOpen ? "#00e676" : "rgba(0,230,118,0.25)",
          boxShadow: isOpen ? "0 0 16px #00e676" : "none",
        }}
      />
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={answerId}
        className="w-full flex items-center gap-4 pl-5 pr-5 py-[18px] text-left"
      >
        <span
          className="font-mono text-[11px] tabular-nums shrink-0 w-6 transition-colors"
          style={{ color: isOpen ? "#00e676" : "rgba(125,211,252,0.5)" }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className="flex-1 text-[15px] md:text-[15.5px] font-semibold tracking-[0.005em] transition-colors"
          style={{ color: isOpen ? "#fff" : "rgba(255,255,255,0.9)" }}
        >
          {item.q}
        </span>
        <span
          className="relative shrink-0 h-6 w-6 grid place-items-center rounded-md transition-all duration-300"
          style={{
            border: `1px solid ${isOpen ? "rgba(0,230,118,0.5)" : "rgba(255,255,255,0.12)"}`,
            background: isOpen ? "rgba(0,230,118,0.12)" : "transparent",
          }}
          aria-hidden
        >
          <span
            className="font-mono text-[15px] leading-none text-bull transition-transform duration-300"
            style={{ transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" }}
          >
            +
          </span>
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
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="pl-[3.4rem] pr-6 pb-5 -mt-1">
              <div
                className="mb-3 h-px w-full"
                style={{ background: "linear-gradient(90deg, rgba(0,230,118,0.22), transparent 70%)" }}
              />
              <p className="text-[14px] leading-[1.72] text-white/75 m-0">{item.a}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
