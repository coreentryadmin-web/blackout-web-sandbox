import { AppShellProviders } from "@/components/providers/AppShellProviders";
import "../globals.css";

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <AppShellProviders>{children}</AppShellProviders>;
}
