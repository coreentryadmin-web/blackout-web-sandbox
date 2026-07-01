export const dynamic = "force-static";

import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { blackoutGridGuide } from "@/lib/learn/guides";

export const metadata: Metadata = {
  title: "BlackOut Grid | BlackOut Academy",
  description: blackoutGridGuide.description,
};

export default function Page() {
  return <LearnGuideView guide={blackoutGridGuide} />;
}
