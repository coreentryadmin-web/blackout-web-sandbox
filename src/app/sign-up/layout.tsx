import { AppShellProviders } from "@/components/providers/AppShellProviders";
import { jetbrainsMono } from "@/lib/fonts-mono";
import { inter } from "@/lib/fonts-sans";
import "../globals.css";

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${jetbrainsMono.variable} ${inter.variable}`}>
      <AppShellProviders>{children}</AppShellProviders>
    </div>
  );
}
