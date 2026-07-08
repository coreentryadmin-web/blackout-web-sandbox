import { JetBrains_Mono } from "next/font/google";

/** Desk/auth monospace — omit from root layout so marketing pages skip the ~30KB font payload. */
export const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});
