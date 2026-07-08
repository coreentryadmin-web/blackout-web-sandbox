import { AppShellProviders } from "@/components/providers/AppShellProviders";

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <AppShellProviders>{children}</AppShellProviders>;
}
