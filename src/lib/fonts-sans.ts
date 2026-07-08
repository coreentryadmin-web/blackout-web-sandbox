import { Inter } from "next/font/google";

/** Body sans — omit from root layout so marketing pages skip the ~20KB Inter payload. */
export const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
