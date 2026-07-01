"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LearnGuide } from "@/lib/learn/types";
import { sectionLinks } from "@/lib/learn/types";
import { curriculumFor } from "@/lib/learn/curriculum";
import { LearnDoc } from "@/components/learn/LearnDoc";
import { LearnSectionBlock } from "@/components/learn/LearnSectionBlocks";
import { LearnHeroGlow } from "@/components/learn/LearnMotion";
import { ProductMark } from "@/components/marks/ProductMark";
import { LEARN_NAV } from "@/lib/learn/nav";

type Props = { guide: LearnGuide };

export function LearnGuideView({ guide }: Props) {
  const navItem = LEARN_NAV.find((n) => n.slug === guide.slug);
  const { prev, next } = curriculumFor(guide.slug);
  const sections = sectionLinks(guide.sections);

  return (
    <div className="relative">
      <LearnHeroGlow />
      <LearnDoc
        title={guide.title}
        description={guide.description}
        kicker={guide.kicker ?? `Chapter ${guide.chapter}`}
        sections={sections}
        badge={
          navItem && navItem.product !== "docs" ? (
            <ProductMark product={navItem.product} size={48} animated />
          ) : undefined
        }
      >
        <div className="learn-chapter-body space-y-16">
          {guide.sections.map((section) => (
            <LearnSectionBlock key={section.id} section={section} />
          ))}
        </div>

        <nav
          aria-label="Chapter navigation"
          className="learn-chapter-nav mt-16 grid gap-4 border-t border-white/10 pt-10 sm:grid-cols-2"
        >
          {prev ? (
            <Link href={prev.href} className="learn-chapter-nav-link learn-chapter-nav-link--prev group">
              <span className="learn-chapter-nav-label">
                <ChevronLeft className="size-4" aria-hidden />
                Previous
              </span>
              <span className="learn-chapter-nav-title">
                Ch. {prev.chapter} · {prev.label}
              </span>
            </Link>
          ) : (
            <div />
          )}
          {next ? (
            <Link href={next.href} className="learn-chapter-nav-link learn-chapter-nav-link--next group">
              <span className="learn-chapter-nav-label">
                Next
                <ChevronRight className="size-4" aria-hidden />
              </span>
              <span className="learn-chapter-nav-title">
                Ch. {next.chapter} · {next.label}
              </span>
            </Link>
          ) : null}
        </nav>
      </LearnDoc>
    </div>
  );
}
