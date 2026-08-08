import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        rule: "var(--rule)",
        text: "var(--text)",
        dim: "var(--dim)",
        lamp: "var(--lamp)",
        peak: "var(--peak)",
        synth: "var(--synth)",
        live: "var(--live)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-body)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};

export default config;
