import { Kicker } from "@/components/ui";

export type LearnSectionLink = { id: string; label: string };

type LearnDocProps = {
  title: string;
  description: string;
  /** In-page anchor nav (mobile + tablet; desktop uses LearnSidebar). */
  sections?: LearnSectionLink[];
  children: React.ReactNode;
};

export function LearnDoc({ title, description, sections, children }: LearnDocProps) {
  return (
    <article className="min-w-0">
      <header className="mb-10 border-b border-white/10 pb-8">
        <Kicker className="mb-2">Documentation</Kicker>
        <h1 className="font-syne text-3xl font-bold tracking-tight text-white md:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-secondary md:text-lg">{description}</p>
      </header>

      {sections != null && sections.length > 0 && (
        <nav
          aria-label="On this page"
          className="mb-10 lg:hidden"
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">On this page</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-secondary transition-colors hover:border-white/20 hover:text-white"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>
      )}

      <div className="learn-prose space-y-14">{children}</div>
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
      <h2 className="mb-6 border-b border-white/10 pb-3 font-syne text-xl font-bold text-white md:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}
