import type { Config } from "tailwindcss";

/**
 * Tailwind is a thin layer over the tokens in globals.css. Every colour here
 * resolves to a CSS variable so there is exactly one place a value is defined,
 * and the palette is deliberately small enough to memorise.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        raised: "var(--bg-raised)",
        sunken: "var(--bg-sunken)",
        s1: "var(--s1)",
        s2: "var(--s2)",
        s3: "var(--s3)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        fg: "var(--fg)",
        "fg-2": "var(--fg-2)",
        "fg-3": "var(--fg-3)",
        "fg-4": "var(--fg-4)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      // Radii stop at 3px. Anything softer reads as a consumer app.
      borderRadius: {
        none: "0",
        sm: "1px",
        DEFAULT: "2px",
        md: "3px",
        full: "999px",
      },
      fontSize: {
        "2xs": ["9.5px", { lineHeight: "1.4" }],
        xs: ["11px", { lineHeight: "1.45" }],
        sm: ["12px", { lineHeight: "1.5" }],
        base: ["13px", { lineHeight: "1.5" }],
        md: ["14px", { lineHeight: "1.45" }],
        lg: ["15px", { lineHeight: "1.35" }],
        xl: ["18px", { lineHeight: "1.25" }],
        "2xl": ["22px", { lineHeight: "1.15" }],
        "3xl": ["28px", { lineHeight: "1.05" }],
        "4xl": ["40px", { lineHeight: "0.95" }],
        "5xl": ["56px", { lineHeight: "0.9" }],
      },
      spacing: {
        row: "var(--row)",
        sidebar: "var(--sidebar)",
        topbar: "var(--topbar)",
      },
      transitionTimingFunction: {
        ease: "var(--ease)",
      },
      transitionDuration: {
        fast: "150ms",
        DEFAULT: "200ms",
        slow: "250ms",
      },
      maxWidth: {
        // Desktop-first: the shell fills 1440–1920 without stretching text.
        work: "1680px",
        prose: "58ch",
      },
    },
  },
  plugins: [],
};

export default config;
