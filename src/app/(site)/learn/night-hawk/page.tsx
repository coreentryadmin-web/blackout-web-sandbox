export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { nightHawkGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "Night Hawk | BlackOut Academy",
  description: nightHawkGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={nightHawkGuide} />;
}
