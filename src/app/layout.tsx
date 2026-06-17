import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlackOut Trading — Trade. Execute. Dominate.",
  description:
    "Institutional-grade options flow, AI market intelligence, live SPX analysis, and Night Hawk swing scanner.",
  openGraph: {
    title: "BlackOut Trading",
    description: "Trade. Execute. Dominate.",
    siteName: "BlackOut Trading",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
