"use client";

import { clsx } from "clsx";
import { PageShell } from "@/components/ui";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** Shared Learn layout frame — compact padding and no duplicate backdrop on native. */
export function LearnPageShell({ children }: { children: React.ReactNode }) {
  const native = useIosNativeShell();

  return (
    <PageShell
      backdrop={!native}
      className={clsx(native && "learn-page-shell-native ios-native-page-learn")}
      contentClassName={clsx("py-0", native && "learn-page-content-native")}
    >
      {children}
    </PageShell>
  );
}
