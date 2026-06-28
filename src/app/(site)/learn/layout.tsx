import { PageShell } from "@/components/ui";
import { LearnSidebar } from "@/components/learn/LearnSidebar";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <div className="content-rail py-8 md:py-10">
        <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          <aside className="hidden lg:block">
            <LearnSidebar />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </PageShell>
  );
}
