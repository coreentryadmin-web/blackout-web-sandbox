import { AppShellProviders } from "@/components/providers/AppShellProviders";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <AppShellProviders>{children}</AppShellProviders>;
}
