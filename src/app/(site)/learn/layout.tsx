import { PageShell } from "@/components/ui";
import { LearnSidebar } from "@/components/learn/LearnSidebar";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell contentClassName="py-0">
      <div className="learn-shell">
        <div className="learn-shell-grid">
          <aside className="learn-shell-aside hidden lg:block">
            <LearnSidebar />
          </aside>
          <div className="learn-shell-main min-w-0 py-8 md:py-10">{children}</div>
        </div>
      </div>
    </PageShell>
  );
}
