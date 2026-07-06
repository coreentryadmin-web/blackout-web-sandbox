export const dynamic = "force-static";

import type { Metadata } from "next";
import { FaqPageShell } from "@/components/faq/FaqPageShell";

export const metadata: Metadata = {
  title: "FAQ · BlackOut",
  description:
    "Everything explained — platform, instruments, signals, membership, and getting started with BlackOut.",
};

export default function FaqPage() {
  return <FaqPageShell />;
}
