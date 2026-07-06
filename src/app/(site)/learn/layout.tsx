import { LearnSidebar } from "@/components/learn/LearnSidebar";
import { LearnMobileNav } from "@/components/learn/LearnMobileNav";
import { LearnPageShell } from "@/components/learn/LearnPageShell";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnPageShell>
      <LearnMobileNav />
      <div className="learn-shell">
        <div className="learn-shell-grid">
          <aside className="learn-shell-aside hidden lg:block">
            <LearnSidebar />
          </aside>
          <div className="learn-shell-main min-w-0 py-8 md:py-10">{children}</div>
        </div>
      </div>
    </LearnPageShell>
  );
}
