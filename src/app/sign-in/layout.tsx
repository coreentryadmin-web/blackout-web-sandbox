import { AppShellProviders } from "@/components/providers/AppShellProviders";
import { jetbrainsMono } from "@/lib/fonts-mono";
import "../globals.css";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={jetbrainsMono.variable}>
      <AppShellProviders>{children}</AppShellProviders>
    </div>
  );
}
