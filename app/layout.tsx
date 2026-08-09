import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two families, and they do different jobs.
 *
 * Inter carries every word and every large figure — its tabular numerals are
 * what make a score read as a measurement rather than a headline. JetBrains
 * Mono is reserved for timecodes, IDs and unit counts: things an operator
 * compares column-to-column, where a fixed advance width is the point.
 */
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexus Clips",
  description:
    "Content intelligence workstation. Ingest a source, rank its moments, cut and caption vertical clips, publish within quota.",
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
