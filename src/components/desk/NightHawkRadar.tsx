"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { NightHawkPlay } from "@/lib/api";
import { Panel, Badge } from "@/components/ui";

/** Live / offline status pill — mirrors the legacy DeskPanel `live` indicator. */
function FeedBadge({ live }: { live?: boolean }) {
  return live ? (
    <Badge tone="bull" dot>
      Live
    </Badge>
  ) : (
    <Badge tone="neutral">Offline</Badge>
  );
}

const listVariants = {
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, x: -24 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

function scorePercent(score: number) {
  return Math.min(100, Math.max(0, score));
}

export function NightHawkRadar({ plays, live }: { plays: NightHawkPlay[]; live?: boolean }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel
        accent="accent"
        kicker="After-hours setups"
        title="Night Hawk Radar"
        actions={<FeedBadge live={live} />}
        // Preserve the legacy DeskPanel `glow` (cyan box-shadow) + 2-col span.
        className="lg:col-span-2 shadow-[0_0_30px_rgba(34,211,238,0.15),inset_0_0_40px_rgba(34,211,238,0.06)]"
      >
        <motion.div
          className="grid md:grid-cols-2 xl:grid-cols-3 gap-3"
          variants={listVariants}
          initial="hidden"
          animate="show"
          role="log"
          aria-live="polite"
          aria-label="Night Hawk after-hours setups"
        >
          {plays.length === 0 ? (
            <p className="col-span-full text-cyan-400 text-sm font-mono py-10 text-center">
              {live ? "Scanning for setups…" : "Scanner offline — re-arms after the close"}
            </p>
          ) : (
            plays.map((play) => {
              const isBull = play.direction?.toLowerCase().includes("bull");
              const pct = scorePercent(play.score);

              return (
                <motion.div
                  key={`${play.ticker}-${play.posted_at}`}
                  variants={cardVariants}
                  className={clsx(
                    "desk-nighthawk-card",
                    isBull ? "desk-nighthawk-bull" : "desk-nighthawk-bear"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-anton text-2xl text-white">{play.ticker}</span>
                    <span
                      className={clsx(
                        "desk-nh-direction",
                        isBull ? "desk-nh-bull" : "desk-nh-bear"
                      )}
                    >
                      {play.direction}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <MiniStat label="Score" value={String(play.score)} />
                    <MiniStat label="Streak" value={`${play.streak_days}d`} />
                    <MiniStat label="IV" value={String(play.iv_rank)} />
                  </div>
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">Conviction</span>
                      <span className="text-[10px] font-mono text-purple-light">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[#08080e] rounded-full overflow-hidden">
                      <motion.div
                        className={clsx("h-full rounded-full", isBull ? "bg-bull" : "bg-bear")}
                        initial={{ width: "0%" }}
                        whileInView={{ width: `${pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-sky-200 leading-relaxed line-clamp-3">{play.summary}</p>
                  <p className="text-[10px] font-mono text-cyan-400 mt-3 uppercase tracking-wider">
                    {play.dte_range} · {play.entry_premium ? `$${play.entry_premium}` : "—"}
                  </p>
                </motion.div>
              );
            })
          )}
        </motion.div>
      </Panel>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="desk-mini-stat">
      <p className="text-[10px] uppercase tracking-widest text-cyan-400">{label}</p>
      <p className="font-mono text-sm font-bold text-purple-light">{value}</p>
    </div>
  );
}
