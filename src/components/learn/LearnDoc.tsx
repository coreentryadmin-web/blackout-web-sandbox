import { Kicker } from "@/components/ui";

export type LearnSectionLink = { id: string; label: string };

type LearnDocProps = {
  title: string;
  description: string;
  kicker?: string;
  sections?: LearnSectionLink[];
  badge?: React.ReactNode;
  children: React.ReactNode;
};

export function LearnDoc({
  title,
  description,
  kicker = "Documentation",
  sections,
  badge,
  children,
}: LearnDocProps) {
  return (
    <article className="min-w-0">
      <header className="learn-doc-header mb-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <Kicker className="mb-3">{kicker}</Kicker>
            <h1 className="learn-doc-title">{title}</h1>
            <p className="learn-doc-description">{description}</p>
          </div>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
      </header>

      {sections != null && sections.length > 0 && (
        <nav aria-label="On this page" className="learn-toc-mobile mb-10 lg:hidden">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">On this page</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="learn-toc-pill">
                {s.label}
              </a>
            ))}
          </div>
        </nav>
      )}

      {children}
    </article>
  );
}

export function LearnSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="learn-chapter-heading">{title}</h2>
      {children}
    </section>
  );
}
