"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { LearnSection } from "@/lib/learn/types";
import { LEARN_NAV, learnHref, type LearnSlug } from "@/lib/learn/nav";
import { toolRoute } from "@/lib/learn/site-map";
import { ProductMark } from "@/components/marks/ProductMark";
import { LearnReveal, LearnStagger, LearnStaggerItem } from "@/components/learn/LearnMotion";

function navItem(slug: LearnSlug) {
  return LEARN_NAV.find((n) => n.slug === slug);
}

function accentClass(accent: "cyan" | "sky" | "indigo") {
  if (accent === "sky") return "border-sky-400/60";
  if (accent === "indigo") return "border-indigo-400/60";
  return "border-cyan-400/60";
}

export function LearnSectionBlock({ section }: { section: LearnSection }) {
  switch (section.type) {
    case "prose":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            <div className="learn-prose-body space-y-4">
              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </section>
        </LearnReveal>
      );

    case "stats":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            {section.title && <h2 className="learn-chapter-heading">{section.title}</h2>}
            <LearnStagger className="mt-6 grid gap-4 sm:grid-cols-3">
              {section.items.map((stat) => (
                <LearnStaggerItem key={stat.label}>
                  <div className="learn-stat-card">
                    <p className="learn-stat-label">{stat.label}</p>
                    <p className="learn-stat-value">{stat.value}</p>
                    {stat.sub && <p className="learn-stat-sub">{stat.sub}</p>}
                  </div>
                </LearnStaggerItem>
              ))}
            </LearnStagger>
          </section>
        </LearnReveal>
      );

    case "pipeline":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-6 max-w-3xl">{section.intro}</p>}
            <div className="learn-pipeline-card">
              {section.layers.map((layer) => (
                <div key={layer.layer} className="learn-pipeline-row">
                  <div className={clsx("learn-pipeline-layer", accentClass(layer.accent))}>
                    {layer.layer}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {layer.items.map((item) => (
                      <span key={item} className="learn-pipeline-chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </LearnReveal>
      );

    case "steps":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-6 max-w-3xl">{section.intro}</p>}
            <ol className="learn-steps">
              {section.steps.map((step, i) => (
                <li key={step.title} className="learn-step-item">
                  <span className="learn-step-num">{i + 1}</span>
                  <div>
                    <p className="learn-step-title">{step.title}</p>
                    <p className="learn-step-body">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </LearnReveal>
      );

    case "timeline":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-8 max-w-3xl">{section.intro}</p>}
            <div className="learn-timeline">
              {section.items.map((item) => {
                const href =
                  item.href ??
                  (item.toolSlug ? learnHref(item.toolSlug) : undefined);
                const label =
                  item.toolLabel ??
                  (item.toolSlug ? navItem(item.toolSlug)?.label : undefined);
                return (
                  <div key={item.phase} className="learn-timeline-row">
                    <div className="learn-timeline-meta">
                      <p className="learn-timeline-phase">{item.phase}</p>
                      <p className="learn-timeline-time">{item.time}</p>
                    </div>
                    <div className="learn-timeline-body">
                      {href && label ? (
                        <Link href={href} className="learn-inline-tool-link">
                          {label}
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Link>
                      ) : null}
                      <p className="learn-timeline-action">{item.action}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </LearnReveal>
      );

    case "features":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-6 max-w-3xl">{section.intro}</p>}
            <div className="space-y-6">
              {section.items.map((f) => (
                <div key={f.title} className="learn-feature-row">
                  <h3 className="learn-feature-title">{f.title}</h3>
                  <p className="learn-feature-body">{f.body}</p>
                </div>
              ))}
            </div>
          </section>
        </LearnReveal>
      );

    case "tool-map":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-8 max-w-3xl">{section.intro}</p>}
            <LearnStagger className="space-y-4">
              {section.slugs.map((slug) => {
                const item = navItem(slug);
                if (!item) return null;
                const live = toolRoute(slug);
                return (
                  <LearnStaggerItem key={slug}>
                    <div className="learn-tool-map-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <Link href={learnHref(slug)} className="learn-tool-map-title group">
                          {item.product !== "docs" && (
                            <ProductMark product={item.product} size={32} animated={false} />
                          )}
                          <span>{item.label}</span>
                        </Link>
                        {item.tag && <span className="learn-badge">{item.tag}</span>}
                      </div>
                      <p className="learn-tool-map-desc">{item.description}</p>
                      {live && (
                        <Link href={live} className="learn-open-desk-link">
                          Open live desk
                          <ExternalLink className="size-3.5" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </LearnStaggerItem>
                );
              })}
            </LearnStagger>
          </section>
        </LearnReveal>
      );

    case "dos-donts":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="learn-dos-card">
                <p className="learn-dos-label">Do</p>
                <ul className="learn-dos-list">
                  {section.dos.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
              <div className="learn-donts-card">
                <p className="learn-donts-label">Don&apos;t</p>
                <ul className="learn-donts-list">
                  {section.donts.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </LearnReveal>
      );

    case "cross-links":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-6 max-w-3xl">{section.intro}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {section.links.map((link) => {
                const item = navItem(link.slug);
                if (!item) return null;
                return (
                  <Link key={link.slug} href={learnHref(link.slug)} className="learn-cross-link-card group">
                    <div className="flex items-center gap-3">
                      {item.product !== "docs" && (
                        <ProductMark product={item.product} size={28} animated={false} />
                      )}
                      <span className="font-semibold text-white group-hover:text-cyan-200">{item.label}</span>
                    </div>
                    <p className="mt-2 text-sm text-secondary">{link.description}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        </LearnReveal>
      );

    case "faq":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            <div className="learn-faq-list">
              {section.items.map((item) => (
                <details key={item.q} className="learn-faq-item group">
                  <summary className="learn-faq-q">{item.q}</summary>
                  <p className="learn-faq-a">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </LearnReveal>
      );

    case "glossary":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            <div className="space-y-10">
              {section.categories.map((cat) => (
                <div key={cat.name}>
                  <p className="learn-glossary-cat">{cat.name}</p>
                  <dl className="learn-glossary-list">
                    {cat.terms.map((t) => (
                      <div key={t.term} className="learn-glossary-row">
                        <dt>{t.term}</dt>
                        <dd>{t.def}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </LearnReveal>
      );

    case "site-nav":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-chapter-section">
            <h2 className="learn-chapter-heading">{section.title}</h2>
            {section.intro && <p className="learn-prose-body mb-8 max-w-3xl">{section.intro}</p>}
            <LearnStagger className="grid gap-3 sm:grid-cols-2">
              {section.items.map((item) => (
                <LearnStaggerItem key={item.href}>
                  <Link href={item.href} className="learn-site-nav-card group">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white group-hover:text-cyan-200">{item.label}</span>
                      {item.badge && <span className="learn-badge">{item.badge}</span>}
                    </div>
                    <p className="mt-2 text-sm text-secondary">{item.description}</p>
                  </Link>
                </LearnStaggerItem>
              ))}
            </LearnStagger>
          </section>
        </LearnReveal>
      );

    case "callout":
      return (
        <LearnReveal>
          <aside
            id={section.id}
            className={clsx(
              "learn-callout",
              section.variant === "tip" && "learn-callout--tip",
              section.variant === "warning" && "learn-callout--warning"
            )}
          >
            <p className="learn-callout-title">{section.title}</p>
            <p className="learn-callout-body">{section.body}</p>
          </aside>
        </LearnReveal>
      );

    case "cta":
      return (
        <LearnReveal>
          <section id={section.id} className="learn-cta-card">
            <div>
              <p className="learn-cta-title">{section.title}</p>
              <p className="learn-cta-body">{section.body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {toolRoute(section.toolSlug) && (
                <Link href={toolRoute(section.toolSlug)!} className="learn-cta-btn learn-cta-btn--primary">
                  {section.ctaLabel ?? "Open desk"}
                </Link>
              )}
              <Link href={learnHref(section.toolSlug)} className="learn-cta-btn">
                Read full guide
              </Link>
            </div>
          </section>
        </LearnReveal>
      );

    default:
      return null;
  }
}
