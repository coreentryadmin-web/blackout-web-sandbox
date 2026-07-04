"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy homepage anchors → dedicated routes (/#faq, /#pricing). */
export function LandingHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === "faq") router.replace("/faq");
    else if (hash === "pricing") router.replace("/pricing");
  }, [router]);

  return null;
}
