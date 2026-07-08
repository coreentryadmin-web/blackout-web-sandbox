import { AppShellProviders } from "@/components/providers/AppShellProviders";
import "../globals.css";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <AppShellProviders>{children}</AppShellProviders>;
}
